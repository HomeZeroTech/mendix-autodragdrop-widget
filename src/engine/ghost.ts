// Copies of rows: the copy of the dragged row that follows the pointer, and the copy of a deleted row that fades
// away where the row was.
//
// A copy is a clone placed in the row's list (same parent), so every style rule that depends on the row's
// ancestors still applies, and it is `position: fixed`, so it takes no room and scrolling lists do not clip it.
// The dragged row itself stays where Mendix rendered it and is only hidden.

import { duration, Timing } from "./motion";
import { Box, isContents, Point, screenRect } from "./geometry";

export const GHOST_ATTRIBUTE = "data-dragdrop-ghost";

function isTransparent(color: string): boolean {
    return !color || color === "transparent" || /^rgba\(.*,\s*0\)$/.test(color);
}

/** The first non-transparent background behind `el`, so a see-through row still gets a solid copy. */
function backdropColor(el: Element): string {
    for (let node: Element | null = el; node; node = node.parentElement) {
        const color = window.getComputedStyle(node).backgroundColor;
        if (!isTransparent(color)) {
            return color;
        }
    }
    return "#fff";
}

/**
 * The element that paints a see-through row: its only child with a box, when that child has a background of its
 * own and fills the row (a gallery item around a pill or a card).
 */
function paintedShape(row: HTMLElement): HTMLElement | null {
    const boxed = Array.from(row.children).filter(
        (child): child is HTMLElement => child instanceof HTMLElement && child.getClientRects().length > 0
    );
    if (boxed.length !== 1 || isTransparent(window.getComputedStyle(boxed[0]).backgroundColor)) {
        return null;
    }
    const outer = row.getBoundingClientRect();
    const inner = boxed[0].getBoundingClientRect();
    const fills =
        Math.abs(inner.left - outer.left) <= 1 &&
        Math.abs(inner.top - outer.top) <= 1 &&
        Math.abs(inner.right - outer.right) <= 1 &&
        Math.abs(inner.bottom - outer.bottom) <= 1;
    return fills ? boxed[0] : null;
}

function sanitize(source: HTMLElement, clone: HTMLElement): void {
    clone.removeAttribute("id");
    clone.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));
    Array.from(clone.attributes)
        .filter(attribute => attribute.name.startsWith("data-dragdrop"))
        .forEach(attribute => clone.removeAttribute(attribute.name));

    // A clone copies attributes, not what the user typed or ticked.
    const originals = source.querySelectorAll("input, textarea, select");
    const copies = clone.querySelectorAll("input, textarea, select");
    originals.forEach((original, i) => {
        const copy = copies[i];
        if (original instanceof HTMLInputElement && copy instanceof HTMLInputElement) {
            copy.removeAttribute("name"); // a copied radio button must not untick the real one
            copy.checked = original.checked;
            copy.value = original.value;
        } else if (original instanceof HTMLTextAreaElement && copy instanceof HTMLTextAreaElement) {
            copy.value = original.value;
        } else if (original instanceof HTMLSelectElement && copy instanceof HTMLSelectElement) {
            copy.value = original.value;
        }
    });
    clone.querySelectorAll("iframe, script").forEach(el => el.remove());
    clone.setAttribute("aria-hidden", "true");
    clone.setAttribute("inert", "");
}

/** True when the rectangle is in view: inside the window and inside every scrolling ancestor of `parent`. */
function inView(parent: HTMLElement, rect: Box): boolean {
    const inside = (left: number, top: number, right: number, bottom: number): boolean =>
        rect.x >= left - 1 && rect.y >= top - 1 && rect.x + rect.w <= right + 1 && rect.y + rect.h <= bottom + 1;
    if (!inside(0, 0, window.innerWidth, window.innerHeight)) {
        return false;
    }
    for (let el: HTMLElement | null = parent; el && el !== document.body; el = el.parentElement) {
        const style = window.getComputedStyle(el);
        if (style.overflowX !== "visible" || style.overflowY !== "visible") {
            const box = el.getBoundingClientRect();
            if (!inside(box.left, box.top, box.right, box.bottom)) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Shows a row that was just taken out of its list fading away at the place it had. The row itself is gone from
 * the page, so a copy of it is shown: in the row's old list (for the style rules that depend on its ancestors),
 * out of the layout, and removed again when the fade is done.
 *
 * @param row    the removed row (no longer in the page)
 * @param parent the list element it was in
 * @param rect   where it was on screen
 * @param timing the timing of its list (the row's own widget is gone)
 */
export function fadeOutCopy(row: HTMLElement, parent: HTMLElement, rect: Box, timing: Timing): void {
    const ms = duration(timing.ms);
    // A copy is not clipped by a scrolling list, so a row that was (partly) scrolled out of view gets none.
    if (ms === 0 || !parent.isConnected || rect.w <= 0 || rect.h <= 0 || !inView(parent, rect)) {
        return;
    }
    const clone = row.cloneNode(true) as HTMLElement;
    if (typeof clone.animate !== "function") {
        return;
    }
    sanitize(row, clone);
    const style = clone.style;
    style.position = "fixed";
    style.left = "0";
    style.top = "0";
    style.margin = "0";
    style.width = `${rect.w}px`;
    style.height = `${rect.h}px`;
    style.boxSizing = "border-box";
    style.pointerEvents = "none";
    style.transition = "none";
    style.transform = "none";
    style.opacity = "";
    clone.classList.add("dragdrop-leaving");
    clone.setAttribute(GHOST_ATTRIBUTE, "");
    parent.appendChild(clone);
    // A row without a box of its own (a data grid row) cannot be shown out of the layout: its cells would take
    // up room in the grid again.
    if (window.getComputedStyle(clone).display === "contents") {
        clone.remove();
        return;
    }
    const placed = clone.getBoundingClientRect();
    const at = `translate3d(${rect.x - placed.left}px, ${rect.y - placed.top}px, 0)`;
    const remove = (): void => clone.remove();
    const animation = clone.animate(
        [
            { opacity: 1, transform: at },
            { opacity: 0, transform: `${at} scale(0.96)` }
        ],
        { duration: ms, easing: timing.easing, fill: "forwards" }
    );
    animation.onfinish = remove;
    animation.oncancel = remove;
    window.setTimeout(remove, ms + 100);
}

export class Ghost {
    readonly el: HTMLElement;
    private readonly base: Point;
    private timer = 0;

    constructor(row: HTMLElement) {
        const rect = screenRect(row);
        const clone = row.cloneNode(true) as HTMLElement;
        sanitize(row, clone);

        const style = clone.style;
        if (isContents(row)) {
            // A data grid row has no box; its cells are laid out by the grid around it. Give the copy a box of
            // its own with the same columns.
            const cells = Array.from(row.children).filter((cell): cell is HTMLElement => cell instanceof HTMLElement);
            style.display = "grid";
            style.gridTemplateColumns = cells.map(cell => `${cell.getBoundingClientRect().width}px`).join(" ");
            style.backgroundColor = backdropColor(cells[0] || row);
        } else if (isTransparent(window.getComputedStyle(row).backgroundColor)) {
            const shape = paintedShape(row);
            if (shape) {
                // The row is only a holder for a pill or a card: the copy takes that shape, so its shadow
                // follows the pill and no backdrop shows around it.
                style.borderRadius = window.getComputedStyle(shape).borderRadius;
            } else {
                style.backgroundColor = backdropColor(row);
            }
        }
        style.position = "fixed";
        style.left = "0";
        style.top = "0";
        style.margin = "0";
        style.width = `${rect.w}px`;
        style.height = `${rect.h}px`;
        style.boxSizing = "border-box";
        style.zIndex = "2147483000";
        style.pointerEvents = "none";
        style.transition = "none";
        style.transform = "none";
        style.opacity = "";
        clone.classList.add("dragdrop-ghost");
        clone.setAttribute(GHOST_ATTRIBUTE, "");

        (row.parentElement as HTMLElement).appendChild(clone);
        // `fixed` is relative to the viewport unless an ancestor has a transform or filter (a popup, for
        // example). Measure where the copy really ended up and correct for it.
        const placed = clone.getBoundingClientRect();
        this.base = { x: -placed.left, y: -placed.top };
        this.el = clone;
        this.moveTo(rect.x, rect.y);
    }

    /** Puts the copy's top-left corner at (x, y) on screen. */
    moveTo(x: number, y: number): void {
        this.el.style.transform = `translate3d(${this.base.x + x}px, ${this.base.y + y}px, 0)`;
    }

    /** How far the copy's corner is from (x, y) on screen. */
    distanceTo(x: number, y: number): number {
        const rect = this.el.getBoundingClientRect();
        return Math.hypot(x - rect.left, y - rect.top);
    }

    /**
     * Lets the copy be pressed. Used while it glides to its place after a drop in its own list: for the person
     * looking at it the copy is the row, so a press on it must be able to pick the row up again.
     */
    catchPresses(handler: (event: PointerEvent) => void): void {
        this.el.removeAttribute("inert");
        this.el.style.pointerEvents = "auto";
        this.el.addEventListener("pointerdown", handler);
    }

    /** Glides the copy to (x, y) on screen in `ms` milliseconds, then calls `done`. */
    animateTo(x: number, y: number, ms: number, easing: string, done: () => void): void {
        const time = duration(ms);
        window.clearTimeout(this.timer);
        if (time === 0) {
            this.moveTo(x, y);
            done();
            return;
        }
        this.el.style.transition = `transform ${time}ms ${easing}`;
        this.moveTo(x, y);
        this.timer = window.setTimeout(() => {
            this.el.style.transition = "none";
            done();
        }, time + 20);
    }

    remove(): void {
        window.clearTimeout(this.timer);
        this.el.remove();
    }
}
