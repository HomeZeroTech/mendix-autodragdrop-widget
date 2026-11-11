// A stand-in for a user's hand, for checking the harness from the browser's console or an automated driver:
//
//   const robot = await import("./robot.js");
//   await robot.chain("#status-list > .widget-gallery-item", [[0, 2], [3, 1]], 60);
//
// It presses the row the user means and releases where the user means, with real pointer events, and tells
// whether the list ended up in the order those moves describe. Positions are the places a list has on screen
// (0 = first), so a chain of moves is described the way a person would do it: "the row now at place 3 to place 1".

const wait = ms => new Promise(resolve => window.setTimeout(resolve, ms));

function pointer(type, x, y) {
    return new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId: 1,
        pointerType: "mouse",
        isPrimary: true,
        button: 0,
        buttons: type === "pointerup" ? 0 : 1,
        clientX: x,
        clientY: y
    });
}

/** The real rows matching `selector` (not the copies the engine shows while dragging or deleting). */
export function rows(selector) {
    return Array.from(document.querySelectorAll(selector)).filter(row => !row.hasAttribute("data-dragdrop-ghost"));
}

/** The element that carries a row's box: a data grid row has none of its own, so its second cell stands in. */
function boxOf(row) {
    return window.getComputedStyle(row).display === "contents" ? row.children[1] : row;
}

/** What a row is called; the copy of a row is called the same. */
export function nameOf(row) {
    const label = row.querySelector(".name") || (row.matches(".tr") ? row.children[1] : row);
    return label.textContent.trim().replace(/\s+/g, " ").slice(0, 30);
}

export function order(selector) {
    return rows(selector).map(nameOf);
}

/** Inline styles the engine left behind on rows, drag copies still in the page, and the dragging state. */
export function leftovers() {
    return {
        styles: Array.from(document.querySelectorAll(".widget-gallery-item, .td")).filter(
            el => el.style.transform || el.style.transition || el.style.opacity || el.style.pointerEvents
        ).length,
        copies: document.querySelectorAll("[data-dragdrop-ghost]").length,
        dragging: document.documentElement.classList.contains("dragdrop-active")
    };
}

/**
 * In a browser that is not on screen transitions never advance: a row that was told to glide somewhere is still
 * painted (and measured) where it came from. This puts the rows where they were going, as if the time had passed.
 */
export function arrive(selector) {
    for (const row of rows(selector)) {
        const boxes = boxOf(row) === row ? [row] : Array.from(row.children);
        boxes.forEach(el => {
            if (el.style.transition && el.style.transition !== "none") {
                el.style.transition = "none";
            }
            // An animation that never advances keeps its first frame on the row, over anything set since.
            el.getAnimations().forEach(animation => animation.finish());
        });
    }
}

/**
 * Presses `row` at (x1, y1), moves to (x2, y2) in a few steps and releases.
 *
 * The press goes to the row itself rather than to whatever is at that point, for the same reason as `arrive`.
 *
 * @param holdMs   how long the pointer stays down before it moves (a touch needs a hold to pick a row up)
 * @param release  false leaves the pointer down, for a check in the middle of a drag
 */
export async function drag(row, x1, y1, x2, y2, { steps = 3, stepMs = 8, type = "mouse", holdMs = 0, release = true } = {}) {
    const event = (name, x, y) => {
        const init = pointer(name, x, y);
        return new PointerEvent(name, {
            bubbles: true,
            cancelable: true,
            pointerId: 1,
            pointerType: type,
            isPrimary: true,
            button: 0,
            buttons: init.buttons,
            clientX: x,
            clientY: y
        });
    };
    boxOf(row).dispatchEvent(event("pointerdown", x1, y1));
    if (holdMs) {
        await wait(holdMs);
    }
    for (let i = 1; i <= steps; i++) {
        window.dispatchEvent(event("pointermove", x1 + ((x2 - x1) * i) / steps, y1 + ((y2 - y1) * i) / steps));
        await wait(stepMs);
    }
    if (release) {
        window.dispatchEvent(event("pointerup", x2, y2));
    }
}

/** The middle of a row (or of any element) on screen. */
export function middle(el) {
    const box = (el.matches && el.matches(".tr") ? boxOf(el) : el).getBoundingClientRect();
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
}

/**
 * Makes `moves` ([from place, to place] pairs) in a row, `gapMs` after each other, and compares the result.
 *
 * @param settle how long to wait at the end for the fake server to catch up
 */
export async function chain(selector, moves, gapMs, { steps = 3, stepMs = 8, settle = 4500, type = "mouse", holdMs = 0 } = {}) {
    const first = rows(selector);
    boxOf(first[Math.min(2, first.length - 1)]).scrollIntoView({ block: "center" });
    await wait(150);
    const places = first.map(row => {
        const box = boxOf(row).getBoundingClientRect();
        return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
    });
    const shown = order(selector);
    for (const [from, to] of moves) {
        const row = rows(selector).find(candidate => nameOf(candidate) === shown[from]);
        const a = places[from];
        const b = places[to];
        // A little past the middle of the place it should take, in the direction of travel.
        const nudge = to > from ? 6 : -6;
        const x2 = b.x + (Math.abs(b.x - a.x) > 1 ? nudge : 0);
        const y2 = b.y + (Math.abs(b.y - a.y) > 1 ? nudge : 0);
        arrive(selector);
        await drag(row, a.x, a.y, x2, y2, { steps, stepMs, type, holdMs });
        shown.splice(to, 0, shown.splice(from, 1)[0]);
        await wait(gapMs);
    }
    await wait(settle);
    const actual = order(selector);
    const match = shown.join("|") === actual.join("|");
    return match
        ? { match, ...leftovers() }
        : { match, expected: shown.join(" | "), actual: actual.join(" | "), ...leftovers() };
}
