// Layout measurements that do not depend on transforms.
//
// During a drag the engine shifts rows with CSS transforms, and transitions may be running. So row positions are
// read from the layout (offsetLeft/offsetTop), never from getBoundingClientRect(), and are expressed relative to
// the row's container. Only the container itself (which the engine never transforms) is measured on screen.

export interface Point {
    x: number;
    y: number;
}

export interface Box {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type Flow = "vertical" | "horizontal" | "grid";

const contentsCache = new WeakMap<Element, boolean>();

/** True for elements without a box of their own (`display: contents`), such as Data grid 2 rows. */
export function isContents(el: Element): boolean {
    let known = contentsCache.get(el);
    if (known === undefined) {
        known = window.getComputedStyle(el).display === "contents";
        contentsCache.set(el, known);
    }
    return known;
}

/** The elements that carry the boxes of `row`: the row itself, or its cells when the row has no box. */
export function boxElements(row: HTMLElement): HTMLElement[] {
    if (!isContents(row)) {
        return [row];
    }
    const result: HTMLElement[] = [];
    for (const child of Array.from(row.children)) {
        if (child instanceof HTMLElement) {
            result.push(...boxElements(child));
        }
    }
    return result;
}

/** The closest ancestor of `row` that has a box: the element its boxes are laid out in. */
export function boxContainer(row: HTMLElement): HTMLElement | null {
    let el = row.parentElement;
    while (el && isContents(el)) {
        el = el.parentElement;
    }
    return el;
}

/** Top-left of `el`'s border box relative to `container`'s border box, in layout coordinates (scroll at 0). */
function offsetWithin(el: HTMLElement, container: HTMLElement): Point {
    let x = 0;
    let y = 0;
    let node: HTMLElement | null = el;
    while (node && node !== container) {
        x += node.offsetLeft;
        y += node.offsetTop;
        const parent = node.offsetParent as HTMLElement | null;
        if (!parent) {
            break;
        }
        if (parent === container) {
            return { x: x + container.clientLeft, y: y + container.clientTop };
        }
        if (!container.contains(parent)) {
            // The container is not positioned: both are measured from the same offset parent.
            return { x: x - container.offsetLeft, y: y - container.offsetTop };
        }
        x += parent.clientLeft;
        y += parent.clientTop;
        node = parent;
    }
    return { x, y };
}

/** The layout box of `row` relative to `container`: the union of its box elements. */
export function relBox(row: HTMLElement, container: HTMLElement): Box {
    const elements = boxElements(row);
    if (elements.length === 0) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const el of elements) {
        const p = offsetWithin(el, container);
        left = Math.min(left, p.x);
        top = Math.min(top, p.y);
        right = Math.max(right, p.x + el.offsetWidth);
        bottom = Math.max(bottom, p.y + el.offsetHeight);
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** Where the container's layout origin (its border-box corner at scroll 0) is on screen right now. */
export function containerOrigin(container: HTMLElement): Point {
    const rect = container.getBoundingClientRect();
    return { x: rect.left - container.scrollLeft, y: rect.top - container.scrollTop };
}

/** The on-screen rectangle of `row` as currently painted (transforms included). */
export function screenRect(row: HTMLElement): Box {
    let left = Infinity;
    let top = Infinity;
    let right = -Infinity;
    let bottom = -Infinity;
    for (const el of boxElements(row)) {
        const rect = el.getBoundingClientRect();
        left = Math.min(left, rect.left);
        top = Math.min(top, rect.top);
        right = Math.max(right, rect.right);
        bottom = Math.max(bottom, rect.bottom);
    }
    if (left === Infinity) {
        return { x: 0, y: 0, w: 0, h: 0 };
    }
    return { x: left, y: top, w: right - left, h: bottom - top };
}

/** How the rows of a list follow each other: stacked, side by side, or wrapping. */
export function detectFlow(boxes: Box[], container: HTMLElement): Flow {
    if (boxes.length >= 2) {
        let stacked = true;
        let sideBySide = true;
        for (let i = 1; i < boxes.length; i++) {
            if (boxes[i].y < boxes[i - 1].y + boxes[i - 1].h - 1) {
                stacked = false;
            }
            if (boxes[i].x < boxes[i - 1].x + boxes[i - 1].w - 1) {
                sideBySide = false;
            }
        }
        if (stacked) {
            return "vertical";
        }
        if (sideBySide) {
            return "horizontal";
        }
        return "grid";
    }
    const style = window.getComputedStyle(container);
    if (style.display.includes("flex")) {
        return style.flexDirection.startsWith("row") ? "horizontal" : "vertical";
    }
    if (style.display.includes("grid") && style.gridAutoFlow.startsWith("column")) {
        return "horizontal";
    }
    return "vertical";
}

/** The start of the container's content area (border plus padding), for placing a row in an empty list. */
export function contentStart(container: HTMLElement): Point {
    const style = window.getComputedStyle(container);
    return {
        x: container.clientLeft + (parseFloat(style.paddingLeft) || 0),
        y: container.clientTop + (parseFloat(style.paddingTop) || 0)
    };
}

/** The gap the container puts between its rows, used when it cannot be measured from two rows. */
export function declaredGap(container: HTMLElement, flow: Flow): number {
    const style = window.getComputedStyle(container);
    const value = flow === "horizontal" ? style.columnGap : style.rowGap;
    return parseFloat(value) || 0;
}

export function byDocumentOrder(a: Node, b: Node): number {
    if (a === b) {
        return 0;
    }
    return a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}
