// Everything the widget instances on the page have registered. The widget module is loaded once, so rows and
// drop zones in different lists (and different list items) all meet here.

import { byDocumentOrder } from "./geometry";

/** What the engine reports when a row is dropped at a new place. */
export interface DropInfo {
    draggedKey: string;
    fromZoneKey: string;
    toZoneKey: string;
    /** Item key of the row it now follows ("" = it is first). */
    afterKey: string;
    /** Item key of the row it now precedes ("" = it is last). */
    beforeKey: string;
    /** 0-based position among the rows of the target list, without the dragged row. */
    newIndex: number;
    /** Sort values of the new neighbours, when the rows carry one. */
    afterSortValue: string | undefined;
    beforeSortValue: string | undefined;
    /** True when the target list has no other rows. */
    emptyTarget: boolean;
}

export interface ItemOptions {
    group: string;
    key: string;
    sortValue: string | undefined;
    disabled: boolean;
    /** The grip, when one is shown. A press on it picks the row up at once, also on touch. */
    handle: HTMLElement | null;
    /** True when the row can be picked up anywhere, not only by its grip. */
    whole: boolean;
    optimistic: boolean;
    animate: boolean;
    /** How long this row takes to move, in milliseconds (0 = no animation). */
    duration: number;
    /** How it speeds up and slows down while it moves: a CSS easing ("ease-out", "linear", ...). */
    easing: string;
    /** Runs the row's own drop action. Returns false when there is none or it cannot run now. */
    drop: ((info: DropInfo) => boolean) | null;
}

export interface ZoneOptions {
    group: string;
    key: string;
    disabled: boolean;
    optimistic: boolean;
    animate: boolean;
    /** Runs the zone's drop action. Returns false when there is none or it cannot run now. */
    drop: ((info: DropInfo) => boolean) | null;
}

export interface ItemEntry {
    row: HTMLElement;
    options: ItemOptions;
}

export interface ZoneEntry {
    el: HTMLElement;
    options: ZoneOptions;
}

/**
 * A place rows can be dropped in. Explicit: an element registered by a drop zone widget. Implicit: the parent
 * element of the rows of a plain list, which only accepts its own rows.
 */
export interface Zone {
    el: HTMLElement;
    entry: ZoneEntry | null;
    group: string;
}

export const items = new Map<HTMLElement, ItemEntry>();
export const zones = new Map<HTMLElement, ZoneEntry>();

/** The explicit drop zone `row` lies in (for its group), or null. */
export function explicitZoneOf(row: HTMLElement, group: string): ZoneEntry | null {
    for (let el = row.parentElement; el; el = el.parentElement) {
        const entry = zones.get(el);
        if (entry && entry.options.group === group) {
            return entry;
        }
    }
    return null;
}

/** The zone a row belongs to: its drop zone, or else the list it sits in. */
export function zoneOf(row: HTMLElement, group: string): Zone | null {
    const entry = explicitZoneOf(row, group);
    if (entry) {
        return { el: entry.el, entry, group };
    }
    return row.parentElement ? { el: row.parentElement, entry: null, group } : null;
}

export function zoneFromEntry(entry: ZoneEntry): Zone {
    return { el: entry.el, entry, group: entry.options.group };
}

/** The registered rows of a zone, in document order. */
export function rowsIn(zone: Zone): HTMLElement[] {
    const rows: HTMLElement[] = [];
    items.forEach(entry => {
        if (entry.options.group !== zone.group || !entry.row.isConnected) {
            return;
        }
        const own = zoneOf(entry.row, zone.group);
        if (own && own.el === zone.el) {
            rows.push(entry.row);
        }
    });
    return rows.sort(byDocumentOrder);
}

/** The registered rows directly under `parent`, whatever their group, in document order. */
export function rowsUnder(parent: HTMLElement): HTMLElement[] {
    const rows: HTMLElement[] = [];
    items.forEach(entry => {
        if (entry.row.parentElement === parent) {
            rows.push(entry.row);
        }
    });
    return rows.sort(byDocumentOrder);
}
