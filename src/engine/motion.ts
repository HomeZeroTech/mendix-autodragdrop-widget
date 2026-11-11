// How rows are moved on screen. Rows are rendered by Mendix (React), so the engine never changes their place in
// the DOM and never touches their class names. It only sets inline transforms, which React leaves alone, and
// plays short animations.
//
// A row can be shown away from its place in the layout for two reasons, which add up:
//   - a preview: a drop was made and the server has not confirmed it yet, so the rows stay where the drop put them;
//   - a shift: a drag is going on and the row makes room for the dragged one.
// A drag that starts while a preview is on screen works on top of it: it measures the rows where they are shown.

import { Box, boxElements, isContents, Point, relBox } from "./geometry";
import { items } from "./registry";

/** How long rows take to move and how they speed up and slow down. */
export interface Timing {
    ms: number;
    easing: string;
}

/**
 * The CSS easing behind each "Animation flow" of the widget (the same four AutoAnimate offers). "Ease out" is a
 * pronounced one: a row that makes room should start moving at once and settle softly.
 */
export const EASINGS = {
    easeOut: "cubic-bezier(0.2, 0, 0, 1)",
    easeInOut: "ease-in-out",
    easeIn: "ease-in",
    linear: "linear"
} as const;

/** For a row the engine knows nothing about (any more). */
export const DEFAULT_TIMING: Timing = { ms: 200, easing: EASINGS.easeOut };

// Everything is derived from the one duration that is set on the widget, which is how long a row takes to slide
// to another place: the copy of a dropped row lands a little quicker, and a row that is new in its list stays
// out of sight for a moment (while its neighbours make room, or the popup it was made in closes) and then takes
// a little longer to come in.
const LAND = 0.9;
const ENTER_DELAY = 0.55;
const ENTER = 1.3;

/** The timing set on the widget of `row`. */
export function timingOf(row: HTMLElement): Timing {
    const entry = items.get(row);
    if (!entry) {
        return DEFAULT_TIMING;
    }
    const ms = Number(entry.options.duration);
    return { ms: ms >= 0 ? ms : DEFAULT_TIMING.ms, easing: entry.options.easing || DEFAULT_TIMING.easing };
}

/** How long the copy of a dropped row takes to land. */
export function landingMs(timing: Timing): number {
    return Math.round(timing.ms * LAND);
}

function transition(row: HTMLElement): string {
    const timing = timingOf(row);
    return duration(timing.ms) > 0 ? `transform ${timing.ms}ms ${timing.easing}` : "none";
}

/** The shift the current drag gives each row, on top of its preview. */
export const offsets = new Map<HTMLElement, Point>();

/** Where rows are shown because of drops that are not confirmed yet, relative to their place in the layout. */
export const previews = new Map<HTMLElement, Point>();

export function reducedMotion(): boolean {
    return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function duration(ms: number): number {
    return reducedMotion() ? 0 : ms;
}

function isZero(point: Point | undefined): boolean {
    return !point || (Math.abs(point.x) < 0.01 && Math.abs(point.y) < 0.01);
}

/** How far `row` is shown from its place in the layout: its preview plus its shift. */
export function shownOffset(row: HTMLElement): Point | undefined {
    const shift = offsets.get(row);
    const preview = previews.get(row);
    if (!shift && !preview) {
        return undefined;
    }
    return { x: (shift ? shift.x : 0) + (preview ? preview.x : 0), y: (shift ? shift.y : 0) + (preview ? preview.y : 0) };
}

/** True when `row` is shown away from its place in the layout. */
export function isShifted(row: HTMLElement): boolean {
    return offsets.has(row) || previews.has(row);
}

/** The box of `row` where a pending drop shows it (relative to `container`), leaving out the current drag. */
export function shownBox(row: HTMLElement, container: HTMLElement): Box {
    const box = relBox(row, container);
    const preview = previews.get(row);
    return preview ? { x: box.x + preview.x, y: box.y + preview.y, w: box.w, h: box.h } : box;
}

function paint(row: HTMLElement, transition: string): void {
    const total = shownOffset(row);
    for (const el of boxElements(row)) {
        el.style.transition = transition;
        el.style.transform = isZero(total) ? "" : `translate3d(${total!.x}px, ${total!.y}px, 0)`;
    }
}

/** Shifts `row` by (dx, dy) from where it is shown without the drag; (0, 0) puts it back there. */
export function setOffset(row: HTMLElement, dx: number, dy: number, animate: boolean): void {
    const zero = Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01;
    const current = offsets.get(row);
    if (current ? !zero && Math.abs(current.x - dx) < 0.01 && Math.abs(current.y - dy) < 0.01 : zero) {
        return;
    }
    if (zero) {
        offsets.delete(row);
    } else {
        offsets.set(row, { x: dx, y: dy });
    }
    paint(row, animate ? transition(row) : "none");
}

/** Takes the drag's shift off `row` at once; a preview stays. */
export function clearOffset(row: HTMLElement): void {
    offsets.delete(row);
    paint(row, "");
}

/** Removes every trace of a shift and a preview from `row` at once: it is shown where the layout has it. */
export function clearShown(row: HTMLElement): void {
    offsets.delete(row);
    previews.delete(row);
    paint(row, "");
}

/** Forgets a row that is gone, without touching it. */
export function forget(row: HTMLElement): void {
    offsets.delete(row);
    previews.delete(row);
}

/**
 * The drag ended in a drop: where its rows are shown now is the preview of that drop, until the server answers.
 * Nothing moves on screen.
 */
export function commit(rows: Iterable<HTMLElement>): void {
    for (const row of rows) {
        const shift = offsets.get(row);
        if (!shift) {
            continue;
        }
        const preview = previews.get(row);
        const next = { x: shift.x + (preview ? preview.x : 0), y: shift.y + (preview ? preview.y : 0) };
        offsets.delete(row);
        if (isZero(next)) {
            previews.delete(row);
        } else {
            previews.set(row, next);
        }
    }
}

/**
 * The layout moved `row` by (-dx, -dy) while a preview is on screen: the preview changes by (dx, dy), so the row
 * stays exactly where it is shown.
 */
export function movePreview(row: HTMLElement, dx: number, dy: number): void {
    if (Math.abs(dx) < 0.01 && Math.abs(dy) < 0.01) {
        return;
    }
    const preview = previews.get(row);
    const next = { x: dx + (preview ? preview.x : 0), y: dy + (preview ? preview.y : 0) };
    if (isZero(next)) {
        previews.delete(row);
    } else {
        previews.set(row, next);
    }
    paint(row, "none");
}

/** Nothing is pending for `row` any more: it glides from where its preview showed it to where it belongs. */
export function dropPreview(row: HTMLElement): void {
    if (previews.delete(row)) {
        paint(row, transition(row));
    }
}

/** Plays `row` from (dx, dy) away to its place in the layout. */
export function slideIn(row: HTMLElement, dx: number, dy: number): void {
    const timing = timingOf(row);
    const ms = duration(timing.ms);
    if (ms === 0) {
        return;
    }
    for (const el of boxElements(row)) {
        if (typeof el.animate === "function") {
            el.animate([{ transform: `translate3d(${dx}px, ${dy}px, 0)` }, { transform: "translate3d(0, 0, 0)" }], {
                duration: ms,
                easing: timing.easing
            });
        }
    }
}

/** Brings in a row that is new in its list: after a moment it fades in and grows the last bit to its size. */
export function enterRow(row: HTMLElement): void {
    const timing = timingOf(row);
    const ms = duration(timing.ms);
    if (ms === 0) {
        return;
    }
    // Cells of a row without a box would each grow from their own middle: those only fade.
    const from = isContents(row) ? { opacity: 0 } : { opacity: 0, transform: "scale(0.96)" };
    const to = isContents(row) ? { opacity: 1 } : { opacity: 1, transform: "none" };
    for (const el of boxElements(row)) {
        if (typeof el.animate === "function") {
            el.animate([from, to], {
                duration: Math.round(ms * ENTER),
                delay: Math.round(ms * ENTER_DELAY),
                easing: timing.easing,
                fill: "backwards"
            });
        }
    }
}

const hidden = new Map<HTMLElement, Array<[HTMLElement, string, string]>>();

/** Hides a row without taking it out of the layout (its place is where the gap opens). */
export function hideRow(row: HTMLElement): void {
    if (hidden.has(row)) {
        return;
    }
    const saved: Array<[HTMLElement, string, string]> = [];
    for (const el of boxElements(row)) {
        saved.push([el, el.style.opacity, el.style.pointerEvents]);
        el.style.opacity = "0";
        el.style.pointerEvents = "none";
    }
    hidden.set(row, saved);
}

export function showRow(row: HTMLElement): void {
    const saved = hidden.get(row);
    if (!saved) {
        return;
    }
    for (const [el, opacity, pointerEvents] of saved) {
        el.style.opacity = opacity;
        el.style.pointerEvents = pointerEvents;
    }
    hidden.delete(row);
}
