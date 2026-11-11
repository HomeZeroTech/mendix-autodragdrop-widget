import { ReactElement, RefObject, useEffect, useLayoutEffect, useRef } from "react";
import Big from "big.js";
import { ActionValue } from "mendix";
import { DragDropContainerProps } from "../typings/DragDropProps";
import {
    actionFinished,
    DEFAULT_ROW_SELECTOR,
    DropInfo,
    EASINGS,
    ItemHandle,
    ItemOptions,
    registerItem,
    registerZone,
    ZoneHandle,
    ZoneOptions
} from "./engine";
import { Grip } from "./components/Grip";
import "./ui/DragDrop.css";

/**
 * A sort value between the neighbours at the drop position: the average of both, one less than the row below,
 * one more than the row above, or 0 in an empty list. Undefined when the rows carry no sort value.
 */
function sortValueBetween(info: DropInfo): Big | undefined {
    const above = info.afterSortValue !== undefined ? new Big(info.afterSortValue) : undefined;
    const below = info.beforeSortValue !== undefined ? new Big(info.beforeSortValue) : undefined;
    if (above && below) {
        return above.plus(below).div(2);
    }
    if (below) {
        return below.minus(1);
    }
    if (above) {
        return above.plus(1);
    }
    return info.emptyTarget ? new Big(0) : undefined;
}

function runRowDrop(action: DragDropContainerProps["onDrop"], info: DropInfo): boolean {
    if (!action || !action.canExecute || action.isExecuting) {
        return false;
    }
    action.execute({
        newIndex: new Big(info.newIndex),
        newSortValue: sortValueBetween(info),
        toZoneKey: info.toZoneKey,
        fromZoneKey: info.fromZoneKey,
        afterKey: info.afterKey,
        beforeKey: info.beforeKey
    });
    return true;
}

function runZoneDrop(action: DragDropContainerProps["onZoneDrop"], info: DropInfo): boolean {
    if (!action || !action.canExecute || action.isExecuting) {
        return false;
    }
    action.execute({
        draggedKey: info.draggedKey,
        fromZoneKey: info.fromZoneKey,
        afterKey: info.afterKey,
        beforeKey: info.beforeKey,
        newIndex: new Big(info.newIndex),
        newSortValue: sortValueBetween(info)
    });
    return true;
}

/**
 * Tells the engine when a drop action stops running, so a preview nothing confirms is undone soon.
 *
 * @param owner the row or drop zone the action belongs to, so the engine knows which drop it was
 */
function useActionFinished(action: ActionValue<any> | undefined, owner: RefObject<HTMLElement | null>): void {
    const executing = !!action && action.isExecuting;
    const wasExecuting = useRef(false);
    useEffect(() => {
        if (wasExecuting.current && !executing) {
            actionFinished(owner.current || undefined);
        }
        wasExecuting.current = executing;
    }, [executing]);
}

const DEFAULT_LABELS: Record<string, string> = {
    nl: "Sleep om de volgorde te wijzigen",
    de: "Ziehen, um die Reihenfolge zu ändern",
    en: "Drag to reorder"
};

/** The handle's label when none is configured, in the language of the user's session. */
function defaultLabel(): string {
    const session = (window as any).mx && (window as any).mx.session;
    const locale = session && session.sessionData && session.sessionData.locale;
    const code: string = (locale && locale.code) || document.documentElement.lang || "en";
    return DEFAULT_LABELS[code.slice(0, 2).toLowerCase()] || DEFAULT_LABELS.en;
}

function classes(...names: Array<string | undefined>): string {
    return names.filter(Boolean).join(" ");
}

/** Handle role: sits in a row, draws the grip and makes that row draggable. */
function RowHandle(props: DragDropContainerProps): ReactElement {
    const anchor = useRef<HTMLSpanElement>(null);
    const registration = useRef<ItemHandle | null>(null);
    const owner = useRef<HTMLElement | null>(null);
    const latest = useRef(props);
    latest.current = props;

    const whole = props.dragBy === "row";
    // Without the whole row as a surface the grip is the only way to drag, so it is always shown then.
    const grip = props.showHandle || !whole;
    const disabled = props.disabled ? props.disabled.value === true : false;
    const selector = (props.rowSelector && props.rowSelector.trim()) || DEFAULT_ROW_SELECTOR;
    const label = props.handleLabel && props.handleLabel.value ? props.handleLabel.value : defaultLabel();

    const options = (): ItemOptions => ({
        group: props.group,
        key: props.itemKey && props.itemKey.value ? props.itemKey.value : "",
        sortValue: props.sortValue && props.sortValue.value ? props.sortValue.value.toString() : undefined,
        disabled,
        handle: grip ? anchor.current : null,
        whole,
        optimistic: true,
        animate: props.animateChanges,
        duration: props.duration,
        easing: EASINGS[props.animationFlow],
        drop: info => runRowDrop(latest.current.onDrop, info)
    });

    // The row is rendered by the list around this widget, so it is found in the DOM, not passed in.
    useLayoutEffect(() => {
        const row = anchor.current ? anchor.current.closest<HTMLElement>(selector) : null;
        if (!row) {
            console.warn(`DragDrop: the handle is not inside a row matching "${selector}".`);
            return undefined;
        }
        const handle = registerItem(row, options());
        registration.current = handle;
        owner.current = row;
        return () => {
            handle.unregister();
            registration.current = null;
            owner.current = null;
        };
    }, [selector]);

    useLayoutEffect(() => {
        if (registration.current) {
            registration.current.update(options());
        }
    });

    useActionFinished(props.onDrop, owner);

    if (!grip) {
        return <span ref={anchor} className="dragdrop-anchor" aria-hidden="true" />;
    }
    return (
        <span
            ref={anchor}
            className={classes("dragdrop-handle", props.class)}
            style={props.style}
            role="button"
            tabIndex={disabled ? -1 : props.tabIndex ?? 0}
            aria-label={label}
            aria-disabled={disabled || undefined}
            title={label}
            onKeyDown={event => registration.current && registration.current.keyDown(event.nativeEvent)}
            onBlur={() => registration.current && registration.current.focusLost()}
            onClick={event => event.stopPropagation()}
        >
            <Grip />
        </span>
    );
}

/** Drop zone role: an area rows of the same group can be dropped in (a lane, a group, an empty list). */
function DropZone(props: DragDropContainerProps): ReactElement {
    const wrapper = useRef<HTMLDivElement>(null);
    const anchor = useRef<HTMLSpanElement>(null);
    const registration = useRef<ZoneHandle | null>(null);
    const owner = useRef<HTMLElement | null>(null);
    const latest = useRef(props);
    latest.current = props;

    const attached = props.zoneTarget === "selector";
    const selector = attached && props.targetSelector ? props.targetSelector.trim() : "";

    const options = (): ZoneOptions => ({
        group: props.group,
        key: props.zoneKey && props.zoneKey.value ? props.zoneKey.value : "",
        disabled: props.disabled ? props.disabled.value === true : false,
        optimistic: true,
        animate: props.animateChanges,
        drop: info => runZoneDrop(latest.current.onZoneDrop, info)
    });

    useLayoutEffect(() => {
        let el: HTMLElement | null = null;
        if (!attached) {
            el = wrapper.current;
        } else if (selector && anchor.current) {
            try {
                el = anchor.current.closest<HTMLElement>(selector);
            } catch {
                el = null; // not a valid selector
            }
        }
        if (!el) {
            console.warn(`DragDrop: no element around the drop zone matches "${selector}".`);
            return undefined;
        }
        const handle = registerZone(el, options());
        registration.current = handle;
        owner.current = el;
        return () => {
            handle.unregister();
            registration.current = null;
            owner.current = null;
        };
    }, [attached, selector]);

    useLayoutEffect(() => {
        if (registration.current) {
            registration.current.update(options());
        }
    });

    useActionFinished(props.onZoneDrop, owner);

    if (attached) {
        return <span ref={anchor} className="dragdrop-anchor" aria-hidden="true" />;
    }
    return (
        <div ref={wrapper} className={classes("dragdrop-zone", props.class)} style={props.style}>
            {props.content}
        </div>
    );
}

export function DragDrop(props: DragDropContainerProps): ReactElement {
    return props.role === "zone" ? <DropZone {...props} /> : <RowHandle {...props} />;
}
