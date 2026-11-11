// The geometry of one list during a drag: where every row is, where the dragged row could go, and how the other
// rows have to shift to make room. Built from layout measurements once, so the answers do not change while rows
// are being shifted around (no flip-flopping between two positions).
//
// "Where every row is" means where it is shown: its place in the layout, moved by the preview of a drop that the
// server has not confirmed yet. `rows` are given in that order, so a drag can start on top of a pending drop.

import { Box, contentStart, declaredGap, detectFlow, Flow, Point } from "./geometry";
import { shownBox } from "./motion";
import { Zone } from "./registry";

type Axis = "x" | "y";
type Extent = "w" | "h";

interface SavedStyle {
    padding: string;
    margin: string;
}

export class ListModel {
    readonly boxes: Box[];
    readonly flow: Flow;
    /** Index of the dragged row in `rows`, or -1 when it belongs to another list. */
    readonly sourceIndex: number;
    /** Indices into `rows` of every row except the dragged one. */
    readonly others: number[];
    readonly gap: number;
    private readonly axis: Axis;
    private readonly extent: Extent;
    private readonly cells: Box[];
    private saved: SavedStyle | null = null;

    constructor(
        readonly zone: Zone,
        readonly container: HTMLElement,
        readonly rows: HTMLElement[],
        source: HTMLElement,
        /** Size of the dragged row. */
        readonly size: { w: number; h: number }
    ) {
        this.boxes = rows.map(row => shownBox(row, container));
        this.flow = detectFlow(this.boxes, container);
        this.axis = this.flow === "horizontal" ? "x" : "y";
        this.extent = this.flow === "horizontal" ? "w" : "h";
        this.sourceIndex = rows.indexOf(source);
        this.others = rows.map((_, i) => i).filter(i => i !== this.sourceIndex);
        this.gap = this.measureGap();
        this.cells = this.flow === "grid" ? this.gridCells() : [];
    }

    /** True when the dragged row started in this list. */
    get isSource(): boolean {
        return this.sourceIndex >= 0;
    }

    /** The number of places the dragged row can take here: before each other row, or at the end. */
    get slotCount(): number {
        return this.others.length + 1;
    }

    /** Room the dragged row takes along the list: its size plus the gap to its neighbour. */
    private get step(): number {
        return this.size[this.extent] + this.gap;
    }

    private measureGap(): number {
        const { boxes, axis, extent, sourceIndex } = this;
        const between = (a: number, b: number): number => boxes[b][axis] - (boxes[a][axis] + boxes[a][extent]);
        let gap: number;
        if (this.flow === "grid") {
            gap = declaredGap(this.container, "vertical");
        } else if (sourceIndex >= 0 && sourceIndex + 1 < boxes.length) {
            gap = between(sourceIndex, sourceIndex + 1);
        } else if (sourceIndex > 0) {
            gap = between(sourceIndex - 1, sourceIndex);
        } else if (sourceIndex < 0 && boxes.length >= 2) {
            gap = between(0, 1);
        } else {
            gap = declaredGap(this.container, this.flow);
        }
        return Math.max(gap, 0);
    }

    /** Position along the list of the j-th other row once the dragged row has left its place. */
    private compact(j: number): number {
        const index = this.others[j];
        const closesUp = this.sourceIndex >= 0 && index > this.sourceIndex;
        return this.boxes[index][this.axis] - (closesUp ? this.step : 0);
    }

    private slotStart(t: number): number {
        const m = this.others.length;
        if (t < m) {
            return this.compact(t);
        }
        if (m > 0) {
            return this.compact(m - 1) + this.boxes[this.others[m - 1]][this.extent] + this.gap;
        }
        return contentStart(this.container)[this.axis];
    }

    /**
     * For a wrapping list: the cell every position has. In its own list the dragged row's cell is one of them;
     * in another list one more cell is needed, which is estimated from the last one.
     */
    private gridCells(): Box[] {
        const cells = this.boxes.slice();
        if (this.sourceIndex >= 0) {
            return cells;
        }
        const last = cells[cells.length - 1];
        if (!last) {
            const start = contentStart(this.container);
            return [{ x: start.x, y: start.y, w: this.size.w, h: this.size.h }];
        }
        const columnGap = declaredGap(this.container, "horizontal");
        const rowGap = declaredGap(this.container, "vertical");
        const right = last.x + last.w + columnGap;
        if (right + last.w <= this.container.clientWidth + 1) {
            cells.push({ x: right, y: last.y, w: last.w, h: last.h });
        } else {
            cells.push({ x: cells[0].x, y: last.y + last.h + rowGap, w: last.w, h: last.h });
        }
        return cells;
    }

    /** The box (relative to the container) the dragged row gets at position `t`. */
    slotBox(t: number): Box {
        if (this.flow === "grid") {
            const cell = this.cells[Math.min(t, this.cells.length - 1)];
            return { x: cell.x, y: cell.y, w: this.size.w, h: this.size.h };
        }
        const cross: Axis = this.axis === "y" ? "x" : "y";
        let crossStart: number;
        if (this.sourceIndex >= 0) {
            crossStart = this.boxes[this.sourceIndex][cross];
        } else if (this.others.length > 0) {
            crossStart = this.boxes[this.others[0]][cross];
        } else {
            crossStart = contentStart(this.container)[cross];
        }
        const box: Box = { x: 0, y: 0, w: this.size.w, h: this.size.h };
        box[this.axis] = this.slotStart(t);
        box[cross] = crossStart;
        return box;
    }

    /** The position whose slot centre is closest to `center` (the centre of the dragged row, container-relative). */
    targetIndex(center: Point): number {
        let best = 0;
        let bestDistance = Infinity;
        for (let t = 0; t < this.slotCount; t++) {
            let distance: number;
            if (this.flow === "grid") {
                const cell = this.cells[t];
                distance = Math.hypot(center.x - (cell.x + cell.w / 2), center.y - (cell.y + cell.h / 2));
            } else {
                distance = Math.abs(center[this.axis] - (this.slotStart(t) + this.size[this.extent] / 2));
            }
            if (distance < bestDistance) {
                bestDistance = distance;
                best = t;
            }
        }
        return best;
    }

    /**
     * How far each other row has to be shown from its place in the layout when the dragged row sits at position
     * `t` of this list, or — with `t` null — is in another list.
     */
    shifts(t: number | null): Point[] {
        return this.others.map((index, j) => {
            const box = this.boxes[index];
            if (this.flow === "grid") {
                const cell = this.cells[t === null || j < t ? j : j + 1];
                return { x: cell.x - box.x, y: cell.y - box.y };
            }
            const along = this.compact(j) - box[this.axis] + (t !== null && j >= t ? this.step : 0);
            return this.axis === "y" ? { x: 0, y: along } : { x: along, y: 0 };
        });
    }

    /**
     * Rows are shifted with transforms, which do not resize their container. So the container is told separately:
     * "grow" when a row from another list is about to land here, "shrink" when this list's row is over another
     * list, "none" otherwise.
     */
    resize(mode: "grow" | "shrink" | "none"): void {
        if (this.flow === "grid") {
            return;
        }
        const style = this.container.style;
        const padding = this.axis === "y" ? "paddingBottom" : "paddingRight";
        const margin = this.axis === "y" ? "marginBottom" : "marginRight";
        if (mode === "none") {
            if (this.saved) {
                style[padding] = this.saved.padding;
                style[margin] = this.saved.margin;
                this.saved = null;
            }
            return;
        }
        if (!this.saved) {
            this.saved = { padding: style[padding], margin: style[margin] };
        } else {
            style[padding] = this.saved.padding;
            style[margin] = this.saved.margin;
        }
        const computed = window.getComputedStyle(this.container);
        if (mode === "grow") {
            style[padding] = `${(parseFloat(computed[padding]) || 0) + this.step}px`;
        } else {
            style[margin] = `${(parseFloat(computed[margin]) || 0) - this.step}px`;
        }
    }
}
