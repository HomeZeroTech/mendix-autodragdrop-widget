// While dragging, scroll whatever scrolls (a lane, the board, the page) when the pointer is near its edge, so
// rows can be dropped at places that are out of view.

import { Point } from "./geometry";

const EDGE_PX = 48;
const MAX_SPEED_PX = 18;

interface Scroller {
    el: Element;
    x: boolean;
    y: boolean;
}

let cache = new WeakMap<Element, Scroller[]>();

export function resetAutoScroll(): void {
    cache = new WeakMap();
}

function speed(distanceToEdge: number): number {
    return Math.ceil(MAX_SPEED_PX * (1 - Math.max(distanceToEdge, 0) / EDGE_PX));
}

/** The scrollable ancestors of `target`, innermost first; styles do not change during a drag. */
function scrollers(target: Element): Scroller[] {
    let result = cache.get(target);
    if (!result) {
        result = [];
        const root = document.scrollingElement;
        for (let el: Element | null = target; el && el !== document.body && el !== root; el = el.parentElement) {
            const style = window.getComputedStyle(el);
            const y = /(auto|scroll)/.test(style.overflowY);
            const x = /(auto|scroll)/.test(style.overflowX);
            if (x || y) {
                result.push({ el, x, y });
            }
        }
        if (root) {
            result.push({ el: root, x: true, y: true });
        }
        cache.set(target, result);
    }
    return result;
}

/** One step of scrolling for a pointer at `pointer`. Call it every animation frame during a drag. */
export function autoScroll(pointer: Point): void {
    const target = document.elementFromPoint(pointer.x, pointer.y);
    if (!target) {
        return;
    }
    const root = document.scrollingElement;
    let scrolledX = false;
    let scrolledY = false;
    for (const { el, x, y } of scrollers(target)) {
        if (scrolledX && scrolledY) {
            break;
        }
        const isRoot = el === root;
        const rect = isRoot
            ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
            : el.getBoundingClientRect();
        if (!scrolledY && y && el.scrollHeight > el.clientHeight) {
            if (pointer.y < rect.top + EDGE_PX && el.scrollTop > 0) {
                el.scrollTop -= speed(pointer.y - rect.top);
                scrolledY = true;
            } else if (pointer.y > rect.bottom - EDGE_PX && el.scrollTop + el.clientHeight < el.scrollHeight - 1) {
                el.scrollTop += speed(rect.bottom - pointer.y);
                scrolledY = true;
            }
        }
        if (!scrolledX && x && el.scrollWidth > el.clientWidth) {
            if (pointer.x < rect.left + EDGE_PX && el.scrollLeft > 0) {
                el.scrollLeft -= speed(pointer.x - rect.left);
                scrolledX = true;
            } else if (pointer.x > rect.right - EDGE_PX && el.scrollLeft + el.clientWidth < el.scrollWidth - 1) {
                el.scrollLeft += speed(rect.right - pointer.x);
                scrolledX = true;
            }
        }
    }
}
