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

const LOCKED_LABELS: Record<string, string> = {
    nl: "Je hebt geen rechten om de volgorde te wijzigen",
    de: "Sie haben keine Berechtigung, die Reihenfolge zu ändern",
    en: "You don't have permission to change the order"
};

/** A built-in text in the language of the user's session. */
function builtIn(labels: Record<string, string>): string {
    const session = (window as any).mx && (window as any).mx.session;
    const locale = session && session.sessionData && session.sessionData.locale;
    const code: string = (locale && locale.code) || document.documentElement.lang || "en";
    return labels[code.slice(0, 2).toLowerCase()] || labels.en;
}

function classes(...names: Array<string | undefined>): string {
    return names.filter(Boolean).join(" ");
}

const warned = new Set<string>();

/** Tells the app's developer, once per page, why a list does not do what they expect. */
function warnOnce(message: string): void {
    if (!warned.has(message)) {
        warned.add(message);
        console.warn(`DragDrop: ${message}`);
    }
}

const NO_ACTION =
    "the new order is not saved. With automatic sequencing, set On drop (Events tab) to 'Save changes', or to a flow that commits the row.";
const NO_ATTRIBUTE = "pick a Sort attribute: without it the widget has no order to change.";
const READ_ONLY =
    "the sort attribute is read-only for this user (access rules, or a data view that is not editable), so the rows cannot be reordered. Give the role write access to it, or use manual sequencing with a microflow.";

/** How long a row's new sort value may take to show up, and its save to finish, before the drop moves on. */
const SAVE_TIMEOUT_MS = 4000;

interface PendingSave {
    value: Big;
    index: number;
    done: () => void;
    /** "set": waiting for the new value to show up; "saving": the action runs. */
    phase: "set" | "saving";
    seenRunning: boolean;
    timer: number;
}

/** Handle role: sits in a row, draws the grip and makes that row draggable. */
function RowHandle(props: DragDropContainerProps): ReactElement {
    const anchor = useRef<HTMLSpanElement>(null);
    const registration = useRef<ItemHandle | null>(null);
    const owner = useRef<HTMLElement | null>(null);
    const saving = useRef<PendingSave | null>(null);
    const latest = useRef(props);
    latest.current = props;

    const advanced = props.advanced === "yes";
    const automatic = !advanced || props.sequencing === "automatic";
    const sort = props.sortAttribute;
    const whole = props.dragBy === "row";
    // Without the whole row as a surface the grip is the only way to drag, so it is always shown then.
    const grip = props.showHandle || !whole;
    // Automatic sequencing writes the sort attribute, so a user who may not write it cannot reorder.
    const locked = automatic && !!sort && sort.status === "available" && sort.readOnly;
    const disabled = locked || (advanced && props.disabled ? props.disabled.value === true : false);
    const selector = (advanced && props.rowSelector && props.rowSelector.trim()) || DEFAULT_ROW_SELECTOR;
    const label = locked
        ? builtIn(LOCKED_LABELS)
        : advanced && props.handleLabel && props.handleLabel.value
        ? props.handleLabel.value
        : builtIn(DEFAULT_LABELS);
    if (locked) {
        warnOnce(READ_ONLY);
    }

    /** One row's save is over (done, refused or given up on): the engine can go on. */
    const finishSave = (): void => {
        const current = saving.current;
        if (current) {
            saving.current = null;
            window.clearTimeout(current.timer);
            current.done();
        }
    };

    /** Automatic sequencing: this row gets another sort value, and On drop saves it. */
    const assign = (value: string, index: number, done: () => void): boolean => {
        const attribute = latest.current.sortAttribute;
        const action = latest.current.onDrop;
        if (!attribute || attribute.readOnly || !action || !action.canExecute) {
            return false;
        }
        finishSave();
        saving.current = {
            value: new Big(value),
            index,
            done,
            phase: "set",
            seenRunning: false,
            timer: window.setTimeout(finishSave, SAVE_TIMEOUT_MS)
        };
        attribute.setValue(new Big(value));
        return true;
    };

    const canAssign = automatic && !!sort && !sort.readOnly && !!props.onDrop && props.onDrop.canExecute;

    const options = (): ItemOptions => ({
        group: advanced ? props.group : "default",
        key: advanced && props.itemKey && props.itemKey.value ? props.itemKey.value : "",
        sortValue: sort && sort.value !== undefined ? sort.value.toString() : undefined,
        disabled,
        handle: grip ? anchor.current : null,
        whole,
        optimistic: true,
        animate: props.animateChanges,
        duration: props.duration,
        easing: EASINGS[props.animationFlow],
        drop: automatic
            ? () => {
                  // Reached when the rows cannot be numbered: say why, and let the row slide back.
                  warnOnce(latest.current.sortAttribute ? NO_ACTION : NO_ATTRIBUTE);
                  return false;
              }
            : info => runRowDrop(latest.current.onDrop, info),
        assign: canAssign ? assign : null
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

    // A save in two steps: the new value has to show up in this row first, then the action stores it.
    useEffect(() => {
        const current = saving.current;
        if (!current) {
            return;
        }
        const action = props.onDrop;
        if (current.phase === "set") {
            if (sort && sort.value !== undefined && sort.value.eq(current.value) && action && !action.isExecuting) {
                if (!action.canExecute) {
                    finishSave();
                    return;
                }
                current.phase = "saving";
                action.execute({
                    newIndex: new Big(current.index),
                    newSortValue: current.value,
                    toZoneKey: undefined,
                    fromZoneKey: undefined,
                    afterKey: undefined,
                    beforeKey: undefined
                });
            }
            return;
        }
        if (action && action.isExecuting) {
            current.seenRunning = true;
        } else if (current.seenRunning || !action) {
            finishSave();
        }
    });

    useEffect(() => finishSave, []);

    useActionFinished(props.onDrop, owner);

    if (!grip) {
        return <span ref={anchor} className="dragdrop-anchor" aria-hidden="true" />;
    }
    return (
        <span
            ref={anchor}
            className={classes("dragdrop-handle", locked ? "dragdrop-handle--locked" : undefined, props.class)}
            style={props.style}
            role="button"
            tabIndex={disabled ? -1 : props.tabIndex ?? 0}
            aria-label={label}
            aria-disabled={disabled || undefined}
            title={label}
            onKeyDown={event => {
                if (registration.current) {
                    registration.current.keyDown(event.nativeEvent);
                    // A key the drag used is not also a key for the list around it: a Gallery or Data grid 2 moves
                    // the focus to the next row on an arrow key, which would end the drag.
                    if (event.nativeEvent.defaultPrevented) {
                        event.stopPropagation();
                    }
                }
            }}
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
    // Without the advanced settings the widget is a handle; the drop zone is an advanced role.
    return props.advanced === "yes" && props.role === "zone" ? <DropZone {...props} /> : <RowHandle {...props} />;
}
