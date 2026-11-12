// A drag from pick-up to drop, and what happens right after the drop.
//
// While dragging: a copy of the row follows the pointer, the real row is hidden in place, and the other rows
// are shifted (with transforms only) to open a gap where the row would land.
//
// After a drop: the rows stay shifted as a preview while the drop action runs. When Mendix re-renders the list,
// the list controller slides every row from where it was shown to where it really is: no movement when the
// server did what was shown, a slide back when it did not.
//
// The next drag does not wait for that. A press counts from the moment the pointer is released, and a row
// picked up while a drop within a list is still pending is dragged on top of the preview: the lists are measured
// as they are shown. Its own drop joins a queue. The drop actions run one at a time, each after the list has
// reloaded for the one before, so every action sees the sort values the previous one left behind.
// Only a row that went to another list makes the next drag wait: its copy stands in for a row that does not
// exist there yet, which cannot be measured.

import { autoScroll, resetAutoScroll } from "./autoscroll";
import { Box, boxContainer, containerOrigin, isContents, Point, screenRect } from "./geometry";
import { Ghost } from "./ghost";
import { ListController, lists, onListMutated } from "./list";
import { ListModel } from "./model";
import {
    clearOffset,
    clearShown,
    commit,
    dropPreview,
    duration,
    hideRow,
    isShifted,
    landingMs,
    previews,
    setOffset,
    shownBox,
    showRow,
    timingOf
} from "./motion";
import { DropInfo, ItemEntry, items, rowsIn, rowsUnder, Zone, zoneFromEntry, zoneOf, zones } from "./registry";
import { plan } from "./sequence";

const HANDLE_START_PX = 3;
const ROW_START_PX = 6;
const TOUCH_HOLD_MS = 220;
const TOUCH_SLOP_PX = 10;
const LAND_MIN_MS = 90;
const LAND_MS_PER_PX = 3;
const SETTLE_MS = 1500; // after the action finished: the refresh should follow quickly, or nothing changed
const TIMEOUT_MS = 8000; // safety net: undo the preview when nothing ever refreshes
const ACTIVE_CLASS = "dragdrop-active";
const LIFTED_ATTRIBUTE = "data-dragdrop-lifted";
const OVER_ATTRIBUTE = "data-dragdrop-over";
// Where the rows of a list live. An empty Gallery renders no `.widget-gallery-items`, only its content element.
const LIST_SELECTOR = ".widget-gallery-items, .widget-gallery-content, .mx-list, .widget-datagrid-grid-body";
// Real controls only. A container with a click action (role="button") stays draggable: a drag that ends on it
// does not click it, a plain click still does.
const NO_DRAG_SELECTOR =
    "input, textarea, select, button, a, label, [contenteditable=''], [contenteditable='true'], " +
    "[role='checkbox'], [role='switch'], [role='combobox'], [role='textbox'], [role='slider'], [data-dragdrop-nodrag]";

let session: DragSession | null = null;
/** The drop whose action is running, or has run and whose list has not reloaded yet. */
let held: HeldDrop | null = null;
/** Drops made since, in order. Each is on screen as a preview; its action runs when the one before is settled. */
const waiting: HeldDrop[] = [];
/** Rows that left their list because they were dropped in another one: they are not shown fading away. */
const movedAway = new WeakSet<HTMLElement>();

/** True while a row that was dropped in another list is not confirmed: the lists cannot be measured until it is. */
function mustWait(): boolean {
    return held !== null && held.crossList;
}

/** The rows in the order they are shown, which a pending drop may have made different from their order in the page. */
function asShown(rows: HTMLElement[], container: HTMLElement): HTMLElement[] {
    if (!rows.some(row => previews.has(row))) {
        return rows;
    }
    const boxes = new Map<HTMLElement, Box>();
    rows.forEach(row => boxes.set(row, shownBox(row, container)));
    return rows.slice().sort((a, b) => {
        const p = boxes.get(a) as Box;
        const q = boxes.get(b) as Box;
        // Rows on one line (a horizontal list, a line of a wrapping one) go left to right.
        return Math.abs(p.y - q.y) < Math.min(p.h, q.h) / 2 ? p.x - q.x : p.y - q.y;
    });
}

/** With nothing pending and nothing being dragged, rows that are still shown elsewhere go to their real place. */
function settleLeftovers(): void {
    if (held || session || previews.size === 0) {
        return;
    }
    lists.forEach(list => {
        if (list.rows().some(row => previews.has(row))) {
            list.reconcile("force");
        }
    });
    previews.clear();
}

/** Where the rows of a zone are laid out; for a zone without rows, the list element inside it. */
function containerOf(zone: Zone, rows: HTMLElement[]): HTMLElement {
    if (rows.length > 0) {
        return boxContainer(rows[0]) || zone.el;
    }
    const scope = zone.el.querySelector<HTMLElement>(".dragdrop-list") || zone.el;
    let found: HTMLElement | null = scope.matches(LIST_SELECTOR)
        ? scope
        : scope.querySelector<HTMLElement>(LIST_SELECTOR) || scope;
    while (found && isContents(found)) {
        found = found.parentElement;
    }
    return found || zone.el;
}

function listOf(row: HTMLElement): ListController | undefined {
    return row.parentElement ? lists.get(row.parentElement) : undefined;
}

class DragSession {
    readonly row: HTMLElement;
    readonly keyboard: boolean;
    readonly models = new Map<HTMLElement, ListModel>();
    readonly touched = new Set<HTMLElement>();
    readonly sourceZone: Zone;
    pointer: Point;
    private readonly group: string;
    private readonly size: { w: number; h: number };
    private readonly grab: Point;
    private ghost: Ghost | null = null;
    private targetZone: Zone;
    /** -1 until the lists could be measured (see `track`). */
    private targetIndex: number;
    private frame = 0;
    private finishing = false;
    private dirty = false;
    /** The pointer was released while the previous drop was still pending: the row lands once that is settled. */
    private released = false;
    /** Set while the row glides to its place after the drop. */
    private landing: (() => void) | null = null;

    /**
     * @param pointer where the pointer is now; null for a row picked up with the keyboard
     * @param pressed where the pointer went down. The row is held at that spot, however far the pointer has
     *                travelled before the drag started (a fast flick can cover a lot between two events).
     */
    constructor(readonly entry: ItemEntry, zone: Zone, pointer: Point | null, pressed?: Point) {
        this.row = entry.row;
        this.group = entry.options.group;
        this.keyboard = pointer === null;
        this.sourceZone = zone;
        this.targetZone = zone;
        const rect = screenRect(this.row);
        this.size = { w: rect.w, h: rect.h };
        this.pointer = pointer || { x: rect.x, y: rect.y };
        const origin = pressed || this.pointer;
        // The spot the row is held at lies on the row, also when the press was on its copy a little off its place.
        this.grab = {
            x: Math.min(Math.max(origin.x - rect.x, 0), rect.w),
            y: Math.min(Math.max(origin.y - rect.y, 0), rect.h)
        };
        this.targetIndex = mustWait() ? -1 : this.model(zone).sourceIndex;
        this.markOver(zone, true);
        if (this.keyboard) {
            this.row.setAttribute(LIFTED_ATTRIBUTE, "");
        } else {
            this.ghost = new Ghost(this.row);
            hideRow(this.row);
            document.documentElement.classList.add(ACTIVE_CLASS);
            const selection = window.getSelection();
            if (selection) {
                selection.removeAllRanges();
            }
            resetAutoScroll();
            this.frame = window.requestAnimationFrame(this.tick);
        }
    }

    private model(zone: Zone): ListModel {
        let model = this.models.get(zone.el);
        if (!model) {
            const rows = rowsIn(zone);
            if (rows.length > 0) {
                const list = listOf(rows[0]);
                if (list) {
                    list.refresh();
                }
            }
            const container = containerOf(zone, rows);
            model = new ListModel(zone, container, asShown(rows, container), this.row, this.size);
            this.models.set(zone.el, model);
        }
        return model;
    }

    private markOver(zone: Zone, over: boolean): void {
        if (!zone.entry) {
            return;
        }
        if (over) {
            zone.el.setAttribute(OVER_ATTRIBUTE, "");
        } else {
            zone.el.removeAttribute(OVER_ATTRIBUTE);
        }
    }

    /** The zone under the pointer that accepts this row, if any. */
    private zoneAt(point: Point): Zone | null {
        const hit = document.elementFromPoint(point.x, point.y);
        for (let el: Element | null = hit; el; el = el.parentElement) {
            if (el instanceof HTMLElement) {
                const entry = zones.get(el);
                if (entry && entry.options.group === this.group && !entry.options.disabled) {
                    return zoneFromEntry(entry);
                }
                if (!this.sourceZone.entry && el === this.sourceZone.el) {
                    return this.sourceZone;
                }
            }
        }
        return null;
    }

    /** Brings the copy, and the gap in the lists, to where the pointer is now. */
    private track(): void {
        if (!this.ghost) {
            return;
        }
        const left = this.pointer.x - this.grab.x;
        const top = this.pointer.y - this.grab.y;
        this.ghost.moveTo(left, top);
        if (mustWait()) {
            // A row dropped in another list just before this drag is still shown there as a copy. Until its list
            // has reloaded there is nothing to measure against: the row follows the pointer, and the other rows
            // make room as soon as the reload is in.
            return;
        }
        // Outside every zone the row keeps its last place, so a drag may wander off the list.
        const zone = this.zoneAt(this.pointer) || this.targetZone;
        const model = this.model(zone);
        const origin = containerOrigin(model.container);
        const index = model.targetIndex({
            x: left + this.size.w / 2 - origin.x,
            y: top + this.size.h / 2 - origin.y
        });
        this.setTarget(zone, index);
    }

    private tick = (): void => {
        this.frame = 0;
        if (this.finishing || !this.ghost) {
            return;
        }
        if (!this.row.isConnected) {
            this.abort();
            return;
        }
        if (!this.released) {
            autoScroll(this.pointer);
            this.track();
        } else if (!held) {
            this.track();
            this.land();
            return;
        }
        this.frame = window.requestAnimationFrame(this.tick);
    };

    private setTarget(zone: Zone, index: number): void {
        if (zone.el === this.targetZone.el && index === this.targetIndex && !this.dirty) {
            return;
        }
        if (zone.el !== this.targetZone.el) {
            this.markOver(this.targetZone, false);
            this.markOver(zone, true);
        }
        this.targetZone = zone;
        this.targetIndex = index;
        this.dirty = false;
        this.apply();
    }

    /** Shifts the rows of every list touched so far to fit the current target. */
    private apply(): void {
        const source = this.model(this.sourceZone);
        const target = this.model(this.targetZone);
        const covered = new Set<HTMLElement>();
        this.models.forEach(model => {
            const shifts = model.shifts(model === target ? this.targetIndex : null);
            model.others.forEach((index, j) => {
                const row = model.rows[index];
                setOffset(row, shifts[j].x, shifts[j].y, true);
                covered.add(row);
            });
            if (model === target) {
                model.resize(model.isSource ? "none" : "grow");
            } else {
                model.resize(model.isSource ? "shrink" : "none");
            }
        });
        if (this.keyboard && source.isSource) {
            const slot = target.slotBox(this.targetIndex);
            const box = source.boxes[source.sourceIndex];
            setOffset(this.row, slot.x - box.x, slot.y - box.y, true);
            covered.add(this.row);
        }
        // Rows that dropped out of the models (the list re-rendered during the drag) go back to their place.
        this.touched.forEach(row => {
            if (!covered.has(row)) {
                setOffset(row, 0, 0, true);
            }
        });
        covered.forEach(row => this.touched.add(row));
    }

    /**
     * Keyboard: an arrow key moves the row within its own list, in the direction the list runs. Up and Down in a
     * stacked list, Left and Right in a list that runs sideways; in a wrapping list all four, Up and Down by a
     * whole line. Arrows across the list's direction do nothing.
     */
    arrow(key: string): void {
        if (this.finishing) {
            return;
        }
        const model = this.model(this.sourceZone);
        const back = key === "ArrowUp" || key === "ArrowLeft";
        const sideways = key === "ArrowLeft" || key === "ArrowRight";
        let places = 1;
        if (model.flow === "vertical" ? sideways : model.flow === "horizontal" ? !sideways : false) {
            return;
        }
        if (model.flow === "grid" && !sideways) {
            // A line up or down: as many places as fit next to each other.
            const first = model.slotBox(0);
            places = 1;
            while (places < model.slotCount && Math.abs(model.slotBox(places).y - first.y) < 1) {
                places += 1;
            }
        }
        const index = Math.max(0, Math.min(model.slotCount - 1, this.targetIndex + (back ? -places : places)));
        this.setTarget(this.sourceZone, index);
    }

    /** The lists re-rendered during the drag: measure again on the next frame. */
    invalidate(): void {
        if (this.finishing) {
            return;
        }
        this.models.forEach(model => model.resize("none"));
        this.models.clear();
        this.dirty = true;
        if (this.keyboard) {
            const model = this.model(this.sourceZone);
            if (!model.isSource) {
                this.abort();
                return;
            }
            this.setTarget(this.sourceZone, Math.min(this.targetIndex, model.slotCount - 1));
        }
    }

    drop(): void {
        if (this.finishing || this.released) {
            return;
        }
        if (!this.row.isConnected) {
            this.abort();
            return;
        }
        // The pointer may have moved since the last frame.
        this.track();
        if (this.ghost && held && (held.crossList || this.targetZone.el !== this.sourceZone.el)) {
            // A move between lists does not go on top of a pending drop (in either order): the row stays at
            // the pointer until everything before it is settled, and `tick` lands it then.
            this.released = true;
            return;
        }
        this.land();
    }

    /** Lets the row settle at the current target. */
    private land(): void {
        this.finishing = true;
        window.cancelAnimationFrame(this.frame);
        const source = this.model(this.sourceZone);
        const target = this.model(this.targetZone);
        const unchanged = source === target && this.targetIndex === source.sourceIndex;
        const slot = target.slotBox(this.targetIndex);
        const complete = (): void => {
            if (this.landing === complete) {
                this.landing = null;
                this.complete(unchanged, target, slot);
            }
        };
        this.landing = complete;
        if (this.ghost) {
            const origin = containerOrigin(target.container);
            const timing = timingOf(this.row);
            const x = origin.x + slot.x;
            const y = origin.y + slot.y;
            // A row is mostly released right above its place: the last few pixels take a moment, not the full time.
            const distance = this.ghost.distanceTo(x, y);
            const ms = distance < 1 ? 0 : Math.min(landingMs(timing), Math.max(LAND_MIN_MS, distance * LAND_MS_PER_PX));
            if (target.isSource) {
                // For as long as it glides the copy is the row to whoever looks at it: a press on it counts.
                const entry = this.entry;
                this.ghost.catchPresses(event => pressOnCopy(entry, event));
            }
            this.ghost.animateTo(x, y, ms, timing.easing, complete);
        } else {
            complete();
        }
    }

    /** True while the row glides to its place after the drop. */
    get isLanding(): boolean {
        return this.landing !== null;
    }

    /** Puts the row at its place at once instead of gliding there, so the next press does not have to wait. */
    hurry(): void {
        if (this.landing) {
            this.landing();
        }
    }

    /** Puts the row back where it came from; a drop at its own place changes nothing. */
    cancel(): void {
        if (this.finishing || this.released) {
            return;
        }
        if (!this.row.isConnected || (mustWait() && this.ghost)) {
            // Nothing was measured or shifted yet while it waits for the previous drop: the row just shows again.
            this.abort();
            return;
        }
        this.setTarget(this.sourceZone, this.model(this.sourceZone).sourceIndex);
        this.land();
    }

    /** What the drop action is told, for a row dropped between `after` and `before` (the rows as shown). */
    private dropInfo(target: ListModel, after: HTMLElement | undefined, before: HTMLElement | undefined): DropInfo {
        const afterOptions = after ? items.get(after)?.options : undefined;
        const beforeOptions = before ? items.get(before)?.options : undefined;
        return {
            draggedKey: this.entry.options.key,
            fromZoneKey: this.sourceZone.entry ? this.sourceZone.entry.options.key : "",
            toZoneKey: this.targetZone.entry ? this.targetZone.entry.options.key : "",
            afterKey: afterOptions ? afterOptions.key : "",
            beforeKey: beforeOptions ? beforeOptions.key : "",
            newIndex: this.targetIndex,
            afterSortValue: afterOptions ? afterOptions.sortValue : undefined,
            beforeSortValue: beforeOptions ? beforeOptions.sortValue : undefined,
            emptyTarget: target.others.length === 0
        };
    }

    private endDragging(): void {
        if (session === this) {
            session = null;
        }
        window.cancelAnimationFrame(this.frame);
        this.row.removeAttribute(LIFTED_ATTRIBUTE);
        document.documentElement.classList.remove(ACTIVE_CLASS);
        this.markOver(this.targetZone, false);
    }

    private complete(unchanged: boolean, target: ListModel, slot: Box): void {
        this.endDragging();
        if (unchanged) {
            this.release();
            settleLeftovers();
            return;
        }
        const others = target.others.map(index => target.rows[index]);
        const after = others[this.targetIndex - 1];
        const before = others[this.targetIndex];
        const info = this.dropInfo(target, after, before);
        const zoneEntry = this.targetZone.entry;
        const run = (): boolean => {
            // The neighbours' sort values are read when the action runs, not when the row was dropped: the drop
            // before this one may have renumbered the rows in the meantime.
            const afterEntry = after ? items.get(after) : undefined;
            const beforeEntry = before ? items.get(before) : undefined;
            if (afterEntry) {
                info.afterSortValue = afterEntry.options.sortValue;
            }
            if (beforeEntry) {
                info.beforeSortValue = beforeEntry.options.sortValue;
            }
            let ran = false;
            if (this.entry.options.drop) {
                ran = this.entry.options.drop(info) || ran;
            }
            if (zoneEntry && zoneEntry.options.drop) {
                ran = zoneEntry.options.drop(info) || ran;
            }
            return ran;
        };
        const optimistic = this.entry.options.optimistic && (!zoneEntry || zoneEntry.options.optimistic);
        if (!optimistic) {
            run();
            this.slideBack();
            return;
        }
        if (target.isSource) {
            // The real row takes over from the copy, shown at its new place.
            const box = target.boxes[target.sourceIndex];
            setOffset(this.row, slot.x - box.x, slot.y - box.y, false);
            this.touched.add(this.row);
            showRow(this.row);
            this.removeGhost();
        }
        // What the drag shifted is what the lists show from here on, until the server has answered.
        commit(this.touched);
        // Automatic sequencing: the order this list gets, the dragged row at its new place.
        const order = target.isSource && this.entry.options.assign ? others.slice() : null;
        if (order) {
            order.splice(this.targetIndex, 0, this.row);
        }
        const drop = new HeldDrop(this, target, slot, this.ghost, run, order);
        this.ghost = null;
        if (held) {
            waiting.push(drop);
        } else {
            held = drop;
            drop.start(false);
        }
    }

    private removeGhost(): void {
        if (this.ghost) {
            this.ghost.remove();
            this.ghost = null;
        }
    }

    /** Ends the drag with every row back where it was shown before it. */
    private release(): void {
        this.models.forEach(model => model.resize("none"));
        this.touched.forEach(clearOffset);
        this.removeGhost();
        showRow(this.row);
    }

    /** No preview wanted: everything glides back, and the list's own refresh shows the result. */
    private slideBack(): void {
        this.models.forEach(model => model.resize("none"));
        this.touched.forEach(row => setOffset(row, 0, 0, true));
        const source = this.models.get(this.sourceZone.el);
        const finish = (): void => {
            this.touched.forEach(clearOffset);
            this.removeGhost();
            showRow(this.row);
        };
        const timing = timingOf(this.row);
        if (this.ghost && source && source.isSource) {
            const origin = containerOrigin(source.container);
            const box = source.boxes[source.sourceIndex];
            this.ghost.animateTo(origin.x + box.x, origin.y + box.y, landingMs(timing), timing.easing, finish);
        } else {
            window.setTimeout(finish, duration(landingMs(timing)));
        }
    }

    /** The dragged row is gone (its list re-rendered without it): drop everything at once. */
    abort(): void {
        this.finishing = true;
        this.landing = null;
        this.endDragging();
        this.release();
        settleLeftovers();
    }
}

/** A drop that the server has not confirmed yet: its preview stays on screen until the list has reloaded. */
class HeldDrop {
    private timer = 0;
    private frame = 0;
    private tries = 0;
    /** Automatic sequencing: the rows whose new sort value is still being saved. */
    saving = 0;
    private readonly sourceParent: HTMLElement | null;
    private readonly targetParent: HTMLElement | null;

    /** @param run runs the drop action(s); false when there is none or it cannot run now */
    constructor(
        private readonly drag: DragSession,
        private readonly target: ListModel,
        private readonly slot: Box,
        private ghost: Ghost | null,
        private readonly run: () => boolean,
        private readonly order: HTMLElement[] | null = null
    ) {
        this.sourceParent = drag.row.parentElement;
        const first = target.rows[0];
        this.targetParent = first ? first.parentElement : null;
        if (ghost) {
            this.follow();
        }
    }

    /**
     * Runs the drop action; from here on the list's reload is awaited.
     *
     * @param queued true for a drop that waited for the one before it. Its row's own action can still be busy
     *               with that one for a moment, so it is tried a few times.
     */
    start(queued: boolean): void {
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => settleHeld(true), TIMEOUT_MS);
        if (this.order ? this.sequence(this.order) : this.run()) {
            return;
        }
        if (queued && this.tries < 10) {
            this.tries += 1;
            window.clearTimeout(this.timer);
            this.timer = window.setTimeout(() => {
                if (held === this) {
                    this.start(true);
                }
            }, 100);
            return;
        }
        settleHeld(true);
    }

    /**
     * Automatic sequencing: every row that gets another place is given the sort value of that place and saved.
     * The list reloads once for every row that is saved, with an order that is only right after the last one, so
     * until then the rows stay where they are shown (see `onListMutated`).
     *
     * @returns false when nothing could be changed: the rows slide back
     */
    private sequence(order: HTMLElement[]): boolean {
        const parent = this.sourceParent;
        if (!parent) {
            return false;
        }
        const group = this.drag.entry.options.group;
        const current = rowsUnder(parent).filter(row => items.get(row)?.options.group === group);
        const changes = plan(current, order);
        if (!changes || changes.length === 0) {
            return false;
        }
        this.saving = changes.length;
        changes.forEach(change => {
            let reported = false;
            const done = (): void => {
                if (!reported) {
                    reported = true;
                    this.saved();
                }
            };
            const assign = change.entry.options.assign;
            if (!assign || !assign(change.value, change.index, done)) {
                done();
            }
        });
        return true;
    }

    /** One row's save has finished. After the last one the list is what the server made of it. */
    private saved(): void {
        this.saving -= 1;
        if (this.saving > 0 || held !== this) {
            return;
        }
        const parent = this.sourceParent;
        const list = parent ? lists.get(parent) : undefined;
        const group = this.drag.entry.options.group;
        const now = parent ? rowsUnder(parent).filter(row => items.get(row)?.options.group === group) : [];
        const arrived = !!this.order && now.length === this.order.length && now.every((row, i) => row === (this.order as HTMLElement[])[i]);
        if (!arrived || !list) {
            // The last reload is still on its way (or a save was refused): it settles this drop, or the timer does.
            this.hurry();
            return;
        }
        if (waiting.length === 0 && !session) {
            list.reconcile("auto", { enter: true, exits: [] });
            this.finish("none");
        } else {
            list.rebase();
            this.release();
            startNext();
        }
    }

    /** True when `el` is the row or the drop zone whose action this drop runs. */
    owns(el: HTMLElement): boolean {
        return el === this.row || el === this.target.zone.el;
    }

    /** True when `list` is the list the row was dragged from. */
    isSource(list: ListController): boolean {
        return list.parent === this.sourceParent;
    }

    /** A row moved to another list is shown by its copy, which must stay put when things scroll. */
    private follow = (): void => {
        if (!this.ghost) {
            return;
        }
        const origin = containerOrigin(this.target.container);
        this.ghost.moveTo(origin.x + this.slot.x, origin.y + this.slot.y);
        this.frame = window.requestAnimationFrame(this.follow);
    };

    get key(): string {
        return this.drag.entry.options.key;
    }

    get row(): HTMLElement {
        return this.drag.row;
    }

    get crossList(): boolean {
        return !this.target.isSource;
    }

    /** True when `el` lies in the zone the row was dropped in. */
    inTargetZone(el: HTMLElement): boolean {
        return this.target.zone.el.contains(el);
    }

    isTarget(list: ListController): boolean {
        if (!this.crossList) {
            return false;
        }
        return this.targetParent ? list.parent === this.targetParent : this.inTargetZone(list.parent);
    }

    /** The action finished: its refresh follows within moments, or nothing changed. */
    hurry(): void {
        if (this.saving > 0) {
            // Rows are still being saved; the last one to finish settles it.
            return;
        }
        window.clearTimeout(this.timer);
        this.timer = window.setTimeout(() => settleHeld(true), SETTLE_MS);
    }

    private removeGhost(): void {
        if (this.ghost) {
            this.ghost.remove();
            this.ghost = null;
        }
    }

    /** The dropped row has been rendered in its new list: the copy and the room made for it can go. */
    arrived(): void {
        this.removeGhost();
        this.target.resize("none");
        if (!this.row.isConnected) {
            this.finish("none");
        }
    }

    /** A list was re-rendered and its rows have been brought to their real places. */
    reconciled(list: ListController): void {
        if (!this.crossList) {
            if (this.isSource(list)) {
                this.finish("none");
            }
            return;
        }
        if (this.isSource(list)) {
            const source = this.drag.models.get(this.drag.sourceZone.el);
            if (source) {
                source.resize("none");
            }
        }
        if (this.isTarget(list)) {
            this.arrived();
        } else if (!this.ghost && !this.row.isConnected) {
            this.finish("none");
        }
    }

    private stop(): void {
        held = null;
        if (!this.row.isConnected) {
            // The row went to its new list as another element; its old list may only now get to see it go.
            movedAway.add(this.row);
        }
        window.clearTimeout(this.timer);
        window.cancelAnimationFrame(this.frame);
        this.drag.models.forEach(model => model.resize("none"));
        this.removeGhost();
        if (!session || session.row !== this.row) {
            // Unless the same row has been picked up again in the meantime.
            showRow(this.row);
        }
    }

    /**
     * The server confirmed this drop while later moves are shown on top of it (rows dropped since, or a row
     * being dragged). It is done; what is on screen stays as it is.
     */
    release(): void {
        if (held !== this) {
            return;
        }
        this.stop();
        // Rows that are back at their place may still carry a transition.
        this.drag.touched.forEach(row => {
            if (!isShifted(row)) {
                clearShown(row);
            }
        });
    }

    /**
     * Ends the preview. Whatever is still shown elsewhere goes to its real place: at once ("none", after the
     * list reloaded) or sliding ("force", when the drop was refused or never answered).
     */
    finish(animate: "force" | "none"): void {
        if (held !== this) {
            return;
        }
        this.stop();
        const involved = new Set<ListController>();
        this.drag.touched.forEach(row => {
            const list = listOf(row);
            if (list && isShifted(row)) {
                involved.add(list);
            }
        });
        if (animate === "force") {
            // The drops made since, and a drag that is going on, were made on top of this one: they go as well,
            // and everything slides back to what the lists really are.
            waiting.length = 0;
            lists.forEach(list => {
                if (list.rows().some(isShifted)) {
                    involved.add(list);
                }
            });
        }
        involved.forEach(list => list.reconcile(animate));
        // Also rows that were only passed over on the way: they are back in place but still carry the transition.
        this.drag.touched.forEach(clearShown);
        if (animate === "force" && session && !this.crossList) {
            session.abort();
        }
        startNext();
    }
}

function settleHeld(animate: boolean): void {
    if (held) {
        held.finish(animate ? "force" : "none");
    }
}

/** Runs the action of the next drop in the queue, if the one before it is settled. */
function startNext(): void {
    if (held) {
        return;
    }
    const next = waiting.shift();
    if (next) {
        held = next;
        next.start(true);
    } else {
        settleLeftovers();
    }
}

onListMutated((list, removed) => {
    const pendingDrop = held;
    if (!pendingDrop) {
        if (session) {
            // Nothing is pending, so the lists are what the layout says they are.
            list.rows().forEach(row => dropPreview(row));
            list.refresh();
            session.invalidate();
        } else {
            list.reconcile("auto", { enter: true, exits: removed.filter(row => !movedAway.has(row)) });
        }
        return;
    }
    if (pendingDrop.saving > 0 && pendingDrop.isSource(list)) {
        // Automatic sequencing saves row by row, and the list reloads after each with an order that is not the
        // final one yet: every row stays where it is shown until the last save.
        list.rebase();
        if (session) {
            session.invalidate();
        }
        return;
    }
    if (pendingDrop.crossList) {
        // Nothing is shown on top of a row that changed lists (see `mustWait`), so its preview is settled as
        // usual. The dropped row arriving in its new list is no news, and neither is it leaving its old one.
        list.reconcile("auto", { enter: !pendingDrop.isTarget(list), exits: [] });
        pendingDrop.reconciled(list);
        if (session) {
            session.invalidate();
        }
        return;
    }
    if (waiting.length === 0 && !session) {
        // The only move on screen: the list goes to what it really is, which is no movement at all when the
        // server did what was shown. Rows are not where the layout has them, so nothing is shown leaving.
        list.reconcile("auto", { enter: true, exits: [] });
        pendingDrop.reconciled(list);
        return;
    }
    // More is on screen than this drop: rows dropped since, or a row being dragged. Every row stays where it is
    // shown, and the next drop in the queue gets its turn.
    list.rebase();
    if (pendingDrop.isSource(list)) {
        pendingDrop.release();
        startNext();
    }
    if (session) {
        session.invalidate();
    }
});

// --- Pick-up -----------------------------------------------------------------------------------------------

interface PendingPress {
    entry: ItemEntry;
    pointerId: number;
    touch: boolean;
    whole: boolean;
    start: Point;
    point: Point;
    timer: number;
    /** False while a touch on a whole row may still turn out to be a scroll. */
    armed: boolean;
}

let press: PendingPress | null = null;
let activePointer = -1;
let listening = false;

function begin(): void {
    const current = press;
    press = null;
    if (!current) {
        return;
    }
    window.clearTimeout(current.timer);
    const zone = zoneOf(current.entry.row, current.entry.options.group);
    if (!zone || current.entry.options.disabled || !current.entry.row.isConnected || session) {
        return;
    }
    // A drop that is still pending keeps its preview: the new drag goes on top of it (or, after a move between
    // lists, waits for it; see `track`). Nothing is thrown back to where it was.
    activePointer = current.pointerId;
    session = new DragSession(current.entry, zone, current.point, current.start);
}

function cancelPress(): void {
    if (press) {
        window.clearTimeout(press.timer);
        press = null;
    }
}

function onPointerMove(event: PointerEvent): void {
    if (session && !session.keyboard) {
        if (event.pointerId === activePointer) {
            session.pointer = { x: event.clientX, y: event.clientY };
        }
        return;
    }
    if (!press || event.pointerId !== press.pointerId) {
        return;
    }
    press.point = { x: event.clientX, y: event.clientY };
    const distance = Math.hypot(press.point.x - press.start.x, press.point.y - press.start.y);
    if (!press.armed) {
        if (distance > TOUCH_SLOP_PX) {
            cancelPress(); // the finger is scrolling
            stopListening();
        }
        return;
    }
    if (distance >= (press.whole ? ROW_START_PX : HANDLE_START_PX)) {
        begin();
    }
}

/** A drag ends with a click on whatever is under the pointer; it must not reach the row's click action. */
function suppressClick(): void {
    const stop = (event: MouseEvent): void => {
        event.stopPropagation();
        event.preventDefault();
        window.removeEventListener("click", stop, true);
    };
    window.addEventListener("click", stop, true);
    window.setTimeout(() => window.removeEventListener("click", stop, true), 100);
}

function onPointerUp(event: PointerEvent): void {
    if (session && !session.keyboard) {
        if (event.pointerId !== activePointer) {
            return;
        }
        session.pointer = { x: event.clientX, y: event.clientY };
        session.drop();
        suppressClick();
    } else if (!press || event.pointerId !== press.pointerId) {
        return;
    }
    cancelPress();
    stopListening();
}

function onPointerCancel(event: PointerEvent): void {
    if (session && !session.keyboard && event.pointerId === activePointer) {
        session.cancel();
    } else if (!press || event.pointerId !== press.pointerId) {
        return;
    }
    cancelPress();
    stopListening();
}

function onKeyDown(event: KeyboardEvent): void {
    if (event.key === "Escape" && session && !session.keyboard) {
        event.preventDefault();
        event.stopPropagation();
        session.cancel();
    }
}

function onBlur(): void {
    if (session && !session.keyboard) {
        session.cancel();
    }
    cancelPress();
    stopListening();
}

function onTouchMove(event: TouchEvent): void {
    // Once a row is being dragged the page must not scroll under the finger.
    if (session && event.cancelable) {
        event.preventDefault();
    }
}

function onContextMenu(event: Event): void {
    // A long press on a touch screen opens the context menu; not while picking up a row.
    if (session || (press && press.touch)) {
        event.preventDefault();
    }
}

function onNativeDrag(event: Event): void {
    // Images and links in a row would start the browser's own drag, which cancels the pointer.
    if (session || press) {
        event.preventDefault();
    }
}

function onSelectStart(event: Event): void {
    if (session || (press && press.whole)) {
        event.preventDefault();
    }
}

function startListening(): void {
    if (listening) {
        return;
    }
    listening = true;
    window.addEventListener("pointermove", onPointerMove, true);
    window.addEventListener("pointerup", onPointerUp, true);
    window.addEventListener("pointercancel", onPointerCancel, true);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("blur", onBlur);
    window.addEventListener("touchmove", onTouchMove, { capture: true, passive: false });
    window.addEventListener("contextmenu", onContextMenu, true);
    window.addEventListener("dragstart", onNativeDrag, true);
    window.addEventListener("selectstart", onSelectStart, true);
}

function stopListening(): void {
    if (!listening) {
        return;
    }
    listening = false;
    window.removeEventListener("pointermove", onPointerMove, true);
    window.removeEventListener("pointerup", onPointerUp, true);
    window.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("keydown", onKeyDown, true);
    window.removeEventListener("blur", onBlur);
    window.removeEventListener("touchmove", onTouchMove, true);
    window.removeEventListener("contextmenu", onContextMenu, true);
    window.removeEventListener("dragstart", onNativeDrag, true);
    window.removeEventListener("selectstart", onSelectStart, true);
}

/** A pointer went down on the copy of a row that is gliding to its place: it is a press on that row. */
function pressOnCopy(entry: ItemEntry, event: PointerEvent): void {
    const target = event.target instanceof Element ? event.target : null;
    if (target && target.closest(NO_DRAG_SELECTOR)) {
        return;
    }
    pointerDown(entry, event, target && target.closest(".dragdrop-handle") ? "handle" : "row");
}

/**
 * A pointer went down on a row's handle (or, for whole-row dragging, anywhere on the row).
 *
 * @param onCopy set when the press was on the row's copy: on the copy of its handle, or elsewhere on it
 */
export function pointerDown(entry: ItemEntry, event: PointerEvent, onCopy?: "handle" | "row"): void {
    if (!event.isPrimary || entry.options.disabled) {
        return;
    }
    if (event.pointerType === "mouse" && event.button !== 0) {
        return;
    }
    if (session && session.isLanding) {
        // The previous row is still gliding to its place. A press that comes this soon counts all the same.
        session.hurry();
    }
    if (session || press) {
        return;
    }
    const handle = entry.options.handle;
    const whole = onCopy ? onCopy === "row" : !(handle && event.target instanceof Node && handle.contains(event.target));
    if (whole) {
        if (!entry.options.whole) {
            return;
        }
        // Buttons, links and inputs inside the row keep working.
        const control = event.target instanceof Element ? event.target.closest(NO_DRAG_SELECTOR) : null;
        if (control && control !== entry.row && entry.row.contains(control)) {
            return;
        }
    }
    const touch = event.pointerType === "touch";
    const point = { x: event.clientX, y: event.clientY };
    press = {
        entry,
        pointerId: event.pointerId,
        touch,
        whole,
        start: point,
        point,
        timer: 0,
        armed: !(whole && touch)
    };
    if (!press.armed) {
        // On touch a whole row is picked up by holding it, so a swipe still scrolls the page.
        press.timer = window.setTimeout(() => {
            if (press) {
                press.armed = true;
                begin();
            }
        }, TOUCH_HOLD_MS);
    }
    startListening();
}

/** A key was pressed while a row's handle has focus. */
export function keyDown(entry: ItemEntry, event: KeyboardEvent): void {
    if (entry.options.disabled) {
        return;
    }
    const toggle = event.key === " " || event.key === "Enter";
    if (!session) {
        // Not while a row that went to another list is still pending: the lists cannot be measured then.
        if (toggle && !press && !mustWait()) {
            const zone = zoneOf(entry.row, entry.options.group);
            if (zone) {
                event.preventDefault();
                session = new DragSession(entry, zone, null);
            }
        }
        return;
    }
    if (!session.keyboard || session.row !== entry.row) {
        return;
    }
    if (toggle) {
        session.drop();
    } else if (event.key === "Escape") {
        session.cancel();
    } else if (event.key === "ArrowUp" || event.key === "ArrowLeft" || event.key === "ArrowDown" || event.key === "ArrowRight") {
        session.arrow(event.key);
    } else {
        return;
    }
    event.preventDefault();
    event.stopPropagation();
}

/** The handle lost focus: a row picked up with the keyboard goes back. */
export function focusLost(entry: ItemEntry): void {
    if (session && session.keyboard && session.row === entry.row) {
        session.cancel();
    }
}

/**
 * A row was registered; it may be the row that was just dropped arriving in its new list.
 *
 * @returns true when it is: that row was on screen all along (as its copy), so it is not brought in as new
 */
export function itemArrived(entry: ItemEntry): boolean {
    if (!held || !held.crossList || entry.row === held.row) {
        return false;
    }
    // With item keys the arriving row is recognised by its key; without, any new row in the target zone counts.
    if (held.key !== "" ? entry.options.key === held.key : held.inTargetZone(entry.row)) {
        held.arrived();
        return true;
    }
    return false;
}

/** A row was unregistered; a drag of that row cannot go on. */
export function itemGone(row: HTMLElement): void {
    if (session && session.row === row) {
        session.abort();
    }
}

/**
 * A drop action finished running.
 *
 * @param owner the row or drop zone whose action it was, when known. With drops in a queue the news can come
 *              after the next drop's action has started, and must not be taken for that one.
 */
export function actionFinished(owner?: HTMLElement): void {
    if (held && (!owner || held.owns(owner))) {
        held.hurry();
    }
}
