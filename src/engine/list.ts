// One controller per list (per parent element that holds registered rows). It remembers where every row was laid
// out, and when Mendix re-renders the list it brings the list on screen from what it showed to what it is now:
// rows that are still there slide to their new place, a row that is new comes in, and a row that was taken out
// fades away where it was. That one step covers a row settling after a drop, a refused drop sliding back, and
// ordinary list changes (a row added, deleted or moved by something else).

import { Box, containerOrigin, isContents, relBox } from "./geometry";
import { fadeOutCopy, GHOST_ATTRIBUTE } from "./ghost";
import {
    clearShown,
    DEFAULT_TIMING,
    enterRow,
    isShifted,
    movePreview,
    shownOffset,
    slideIn,
    Timing,
    timingOf
} from "./motion";
import { items, rowsUnder } from "./registry";

/** What a re-render did to a list besides moving rows, and what to show of it. */
export interface ListChange {
    /** Bring in the rows that are new in the list. */
    enter: boolean;
    /** Rows that were just taken out of the list (and are no longer in the page). */
    exits: HTMLElement[];
}

const NO_CHANGE: ListChange = { enter: false, exits: [] };

export const lists = new Map<HTMLElement, ListController>();

let mutationHandler: (list: ListController, removed: HTMLElement[]) => void = (list, removed) =>
    list.reconcile("auto", { enter: true, exits: removed });

/** Lets the drag session decide what a re-render means while a drag or a drop preview is going on. */
export function onListMutated(handler: (list: ListController, removed: HTMLElement[]) => void): void {
    mutationHandler = handler;
}

function isGhost(node: Node): boolean {
    return node instanceof Element && node.hasAttribute(GHOST_ATTRIBUTE);
}

function isGhostChange(record: MutationRecord): boolean {
    const ghostsOnly = (nodes: NodeList): boolean => Array.from(nodes).every(isGhost);
    return ghostsOnly(record.addedNodes) && ghostsOnly(record.removedNodes);
}

export class ListController {
    private snapshot = new Map<HTMLElement, Box>();
    private readonly observer: MutationObserver;
    private readonly resizeObserver: ResizeObserver | null = null;
    private frame = 0;
    /** Rows that arrive as the result of a drop: they were on screen all along and are not brought in. */
    private readonly expected = new WeakSet<HTMLElement>();
    /** Whether this list animates its own changes, and how; remembered for when a row has just gone. */
    private animates = false;
    private timing: Timing = DEFAULT_TIMING;
    private admitting = false;

    constructor(readonly parent: HTMLElement) {
        this.observer = new MutationObserver(records => {
            if (records.every(isGhostChange)) {
                return;
            }
            // React moves a row by taking it out and putting it back in: only rows that stayed out are gone.
            const removed = new Set<HTMLElement>();
            for (const record of records) {
                record.removedNodes.forEach(node => {
                    if (node instanceof HTMLElement && !isGhost(node) && node.parentElement !== parent) {
                        removed.add(node);
                    }
                });
            }
            mutationHandler(this, Array.from(removed));
        });
        this.observer.observe(parent, { childList: true });
        if (typeof ResizeObserver !== "undefined") {
            this.resizeObserver = new ResizeObserver(() => this.scheduleRefresh());
            this.resizeObserver.observe(this.container || parent);
        }
        this.scheduleRefresh();
    }

    /** The element the rows are laid out in: the parent, or its first ancestor with a box. */
    get container(): HTMLElement | null {
        let el: HTMLElement | null = this.parent;
        while (el && isContents(el)) {
            el = el.parentElement;
        }
        return el;
    }

    rows(): HTMLElement[] {
        return rowsUnder(this.parent);
    }

    /** Records where every row is laid out now. Safe at any time: shifts do not change the layout. */
    refresh(): void {
        const container = this.container;
        const next = new Map<HTMLElement, Box>();
        if (container) {
            for (const row of this.rows()) {
                next.set(row, relBox(row, container));
            }
        }
        this.snapshot = next;
    }

    scheduleRefresh(): void {
        if (this.frame) {
            return;
        }
        this.frame = window.requestAnimationFrame(() => {
            this.frame = 0;
            this.refresh();
        });
    }

    /**
     * A row was registered in this list. In a list that is already on screen that is a new row, which is brought
     * in. Usually the re-render that added it is noticed anyway (the list's children changed), but the widget in
     * a row may also be rendered a moment after its row, when that has already been dealt with.
     *
     * @param announce false for a row that arrives as the result of a drop
     */
    admit(row: HTMLElement, announce: boolean): void {
        if (!announce) {
            this.expected.add(row);
        }
        if (this.snapshot.size === 0) {
            // The list's first rows: nothing is on screen yet to compare with.
            this.scheduleRefresh();
            return;
        }
        if (this.admitting) {
            return;
        }
        this.admitting = true;
        Promise.resolve().then(() => {
            this.admitting = false;
            if (lists.get(this.parent) === this && this.rows().some(other => !this.snapshot.has(other))) {
                mutationHandler(this, []);
            }
        });
    }

    /**
     * Brings the list from what it showed to what it is now, and drops the shifts and previews: every row goes
     * from where it was last shown (its recorded place plus what it was moved by) to where the layout puts it.
     *
     * @param animate "auto": slide when rows were shifted or the list animates its changes; "force": always
     *                slide; "none": jump.
     * @param change  which new rows to bring in and which removed rows to show leaving; only done when the list
     *                animates its changes
     */
    reconcile(animate: "auto" | "force" | "none", change: ListChange = NO_CHANGE): void {
        const container = this.container;
        if (!container) {
            return;
        }
        const rows = this.rows();
        const previous = this.snapshot;
        const shifted = rows.some(isShifted);
        if (rows.length > 0) {
            this.animates = rows.some(row => items.get(row)?.options.animate === true);
            this.timing = timingOf(rows[0]);
        }
        const play = animate === "force" || (animate === "auto" && (shifted || this.animates));
        const announce = animate !== "none" && this.animates;

        const next = new Map<HTMLElement, Box>();
        const slides: Array<[HTMLElement, number, number]> = [];
        const entering: HTMLElement[] = [];
        let stayed = 0;
        for (const row of rows) {
            const now = relBox(row, container);
            next.set(row, now);
            const before = previous.get(row);
            const offset = shownOffset(row);
            if (before) {
                stayed += 1;
                const dx = before.x + (offset ? offset.x : 0) - now.x;
                const dy = before.y + (offset ? offset.y : 0) - now.y;
                if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
                    slides.push([row, dx, dy]);
                }
            } else if (!this.expected.has(row)) {
                entering.push(row);
            }
        }
        for (const row of rows) {
            clearShown(row);
        }
        this.snapshot = next;
        if (play) {
            slides.forEach(([row, dx, dy]) => slideIn(row, dx, dy));
        }
        if (!announce) {
            return;
        }
        // A list in which no row stayed was loaded anew (another page, another filter, a reset): that is not a
        // row being added or deleted, so nothing comes in or fades away. Deleting the only row still shows.
        if (change.enter && stayed > 0) {
            entering.forEach(enterRow);
        }
        if (change.exits.length > 0 && (stayed > 0 || change.exits.length === 1)) {
            const origin = containerOrigin(container);
            for (const row of change.exits) {
                const before = previous.get(row);
                if (before) {
                    const rect = { x: origin.x + before.x, y: origin.y + before.y, w: before.w, h: before.h };
                    fadeOutCopy(row, this.parent, rect, this.timing);
                }
            }
        }
    }

    /**
     * The list was re-rendered while more moves are shown than the server has confirmed (rows dropped since, or
     * a row being dragged). Every row stays exactly where it is shown: what the layout moved is taken up in the
     * row's preview. Once nothing is pending any more, `reconcile` brings the list to what it really is.
     */
    rebase(): void {
        const container = this.container;
        if (!container) {
            return;
        }
        const next = new Map<HTMLElement, Box>();
        for (const row of this.rows()) {
            const now = relBox(row, container);
            next.set(row, now);
            const before = this.snapshot.get(row);
            if (before) {
                movePreview(row, before.x - now.x, before.y - now.y);
            }
        }
        this.snapshot = next;
    }

    destroy(): void {
        this.observer.disconnect();
        if (this.resizeObserver) {
            this.resizeObserver.disconnect();
        }
        if (this.frame) {
            window.cancelAnimationFrame(this.frame);
        }
    }
}

export function ensureList(parent: HTMLElement): ListController {
    let list = lists.get(parent);
    if (!list) {
        list = new ListController(parent);
        lists.set(parent, list);
    }
    return list;
}

/**
 * Drops the controller of `parent` once no registered row is left in it. Not at once: a row unregisters just
 * before it is taken out of the page, and its list must still be there to see that happen.
 */
export function releaseList(parent: HTMLElement): void {
    window.setTimeout(() => {
        const list = lists.get(parent);
        if (list && list.rows().length === 0) {
            list.destroy();
            lists.delete(parent);
        }
    }, 0);
}
