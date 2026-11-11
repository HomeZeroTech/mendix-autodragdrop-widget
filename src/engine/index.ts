// The engine's public surface. It knows nothing about Mendix or React: it is handed DOM elements (rows, handles,
// drop zones) and callbacks, so the widget and the development harness drive it the same way.

import { actionFinished, focusLost, itemArrived, itemGone, keyDown, pointerDown } from "./session";
import { ensureList, lists, releaseList } from "./list";
import { ItemEntry, ItemOptions, items, ZoneEntry, ZoneOptions, zones } from "./registry";
import { forget, showRow } from "./motion";

export type { DropInfo, ItemOptions, ZoneOptions } from "./registry";
export { EASINGS } from "./motion";

const ROW_ATTRIBUTE = "data-dragdrop-row";
const ZONE_ATTRIBUTE = "data-dragdrop-zone";

/** Rows the widget finds when no selector is given: the list entry it sits in. */
export const DEFAULT_ROW_SELECTOR =
    ".widget-gallery-item, .mx-listview-item, .mx-templategrid-item, .widget-datagrid .tr[role='row'], [data-dragdrop-item]";

export interface ItemHandle {
    update(options: ItemOptions): void;
    keyDown(event: KeyboardEvent): void;
    focusLost(): void;
    unregister(): void;
}

export interface ZoneHandle {
    update(options: ZoneOptions): void;
    unregister(): void;
}

/** Makes `row` a draggable row of its list. */
export function registerItem(row: HTMLElement, options: ItemOptions): ItemHandle {
    const entry: ItemEntry = { row, options };
    const parent = row.parentElement;
    const onPointerDown = (event: PointerEvent): void => pointerDown(entry, event);
    let surface: HTMLElement | null = null;

    // A whole-row surface also receives the presses on the grip inside it.
    const bind = (): void => {
        const next = entry.options.whole ? row : entry.options.handle;
        if (next !== surface) {
            if (surface) {
                surface.removeEventListener("pointerdown", onPointerDown);
            }
            if (next) {
                next.addEventListener("pointerdown", onPointerDown);
            }
            surface = next;
        }
        row.setAttribute(ROW_ATTRIBUTE, entry.options.whole ? "whole" : "handle");
    };

    items.set(row, entry);
    bind();
    const dropped = itemArrived(entry);
    if (parent) {
        ensureList(parent).admit(row, !dropped);
    }

    return {
        update(next: ItemOptions): void {
            entry.options = next;
            bind();
        },
        keyDown(event: KeyboardEvent): void {
            keyDown(entry, event);
        },
        focusLost(): void {
            focusLost(entry);
        },
        unregister(): void {
            if (surface) {
                surface.removeEventListener("pointerdown", onPointerDown);
            }
            if (items.get(row) === entry) {
                items.delete(row);
                row.removeAttribute(ROW_ATTRIBUTE);
            }
            itemGone(row);
            forget(row);
            showRow(row);
            if (parent) {
                const list = lists.get(parent);
                if (list) {
                    list.scheduleRefresh();
                }
                releaseList(parent);
            }
        }
    };
}

/** Makes `el` a drop zone: rows of the same group can be dropped among the rows inside it. */
export function registerZone(el: HTMLElement, options: ZoneOptions): ZoneHandle {
    const entry: ZoneEntry = { el, options };
    zones.set(el, entry);
    el.setAttribute(ZONE_ATTRIBUTE, options.group);
    return {
        update(next: ZoneOptions): void {
            entry.options = next;
            el.setAttribute(ZONE_ATTRIBUTE, next.group);
        },
        unregister(): void {
            if (zones.get(el) === entry) {
                zones.delete(el);
                el.removeAttribute(ZONE_ATTRIBUTE);
                el.removeAttribute("data-dragdrop-over");
            }
        }
    };
}

/** Tell the engine a drop action finished running, so a preview that nothing confirms is undone soon. */
export { actionFinished };
