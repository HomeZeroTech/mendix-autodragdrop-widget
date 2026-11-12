// Drives the harness in a real browser with a real mouse, the way a person in a hurry would, and reports where
// the lists did not end up as that person meant.
//
//   npm run harness && node dev/serve.mjs          (in another terminal)
//   NODE_PATH=<folder with playwright>/node_modules node dev/drive.mjs [chains|lists|all]
//
// Unlike a check from the page itself this has animation frames and real hit testing: a press lands on whatever
// is painted under the pointer at that moment, also when rows are still gliding.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const URL = "http://localhost:4173/dev/harness.html";
const what = process.argv[2] || "all";
const failures = [];
let checks = 0;

function report(name, ok, detail) {
    checks += 1;
    console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n       ${detail}`}`);
    if (!ok) {
        failures.push(name);
    }
}

const browser = await chromium.launch({ channel: "chrome", headless: true });
const context = await browser.newContext({ viewport: { width: 1300, height: 1000 } });
// The page the helpers below work on (the touch checks switch to one with a touch screen).
let page = await context.newPage();
context.on("weberror", error => {
    console.log(`page error: ${error.error().message}`);
    failures.push(`page error: ${error.error().message}`);
});

async function open(settings = {}) {
    await page.goto(URL);
    await page.evaluate(async values => {
        window.robot = await import("./robot.js");
        for (const [id, value] of Object.entries(values)) {
            const input = document.getElementById(id);
            if (input.type === "checkbox") {
                input.checked = value;
            } else {
                input.value = String(value);
            }
        }
    }, settings);
    await page.waitForTimeout(300);
}

/** The middles of the places of a list, measured while nothing moves. */
async function places(selector) {
    return page.evaluate(sel => {
        const rows = window.robot.rows(sel);
        const target = rows[Math.min(2, rows.length - 1)];
        (window.getComputedStyle(target).display === "contents" ? target.children[1] : target).scrollIntoView({
            block: "center"
        });
        return rows.map(row => window.robot.middle(row));
    }, selector);
}

const order = selector => page.evaluate(sel => window.robot.order(sel), selector);

/** Waits until nothing is moving or pending any more and the order has stopped changing. */
async function settled(selector, timeout = 15000) {
    const end = Date.now() + timeout;
    let last = "";
    let stable = 0;
    while (Date.now() < end) {
        await page.waitForTimeout(250);
        const state = await page.evaluate(sel => {
            const left = window.robot.leftovers();
            return { order: window.robot.order(sel).join("|"), busy: left.copies > 0 || left.dragging, styles: left.styles };
        }, selector);
        stable = state.order === last && !state.busy ? stable + 1 : 0;
        last = state.order;
        if (stable >= 6) {
            return { order: last.split("|"), styles: state.styles };
        }
    }
    return { order: last.split("|"), styles: -1 };
}

/**
 * Presses what is at place `from`, releases at place `to`, as fast as a mouse goes.
 * Returns what a person would expect of it: which row they grabbed and at which place it should land.
 *
 * @param shown the rows as the moves so far leave them, by name
 */
async function move(selector, spots, from, to, shown = []) {
    const a = spots[from];
    const b = spots[to];
    const nudge = to > from ? 6 : to < from ? -6 : 0;
    const x2 = b.x + (Math.abs(b.x - a.x) > 1 ? nudge : 0);
    const y2 = b.y + (Math.abs(b.y - a.y) > 1 ? nudge : 0);
    await page.mouse.move(a.x, a.y);
    const grabbed = await page.evaluate(
        ([sel, x, y, tx, ty, list, names]) => {
            const hit = document.elementFromPoint(x, y);
            const rows = window.robot.rows(sel);
            let row = rows.find(candidate => candidate.contains(hit));
            let mid;
            let half;
            const copy = hit ? hit.closest(".dragdrop-ghost") : null;
            if (row) {
                mid = window.robot.middle(row);
            } else if (copy) {
                // The copy of a row that was just dropped is that row to whoever looks at it. By the time it is
                // dragged again the row is at the place it was dropped at.
                const name = window.robot.nameOf(copy);
                row = rows.find(candidate => window.robot.nameOf(candidate) === name);
                mid = list[names.indexOf(name)];
                const box = copy.getBoundingClientRect();
                half = { x: box.width / 2, y: box.height / 2 };
            }
            if (!row || !mid) {
                return null;
            }
            // The row keeps the spot it was grabbed at under the pointer (a spot on the row), so its middle
            // lands this far from where the pointer is released.
            const clamp = (value, limit) => (limit === undefined ? value : Math.min(Math.max(value, -limit), limit));
            const landing = { x: tx - clamp(x - mid.x, half && half.x), y: ty - clamp(y - mid.y, half && half.y) };
            let place = 0;
            let best = Infinity;
            list.forEach((spot, i) => {
                const distance = Math.hypot(spot.x - landing.x, spot.y - landing.y);
                if (distance < best) {
                    best = distance;
                    place = i;
                }
            });
            return { name: window.robot.nameOf(row), place };
        },
        [selector, a.x, a.y, x2, y2, spots, shown]
    );
    await page.mouse.down();
    await page.mouse.move(x2, y2, { steps: 4 });
    const lifted = await page.evaluate(() => document.querySelectorAll(".dragdrop-ghost").length > 0);
    await page.mouse.up();
    return { grabbed, lifted };
}

/** A chain of moves `gap` ms after each other; the list must end up as the moves describe. */
async function chain(label, selector, moves, gap) {
    const spots = await places(selector);
    const shown = await order(selector);
    let ignored = 0;
    for (const [from, to] of moves) {
        const { grabbed, lifted } = await move(selector, spots, from, to, shown);
        if (grabbed) {
            if (!lifted) {
                ignored += 1;
            }
            const at = shown.indexOf(grabbed.name);
            shown.splice(grabbed.place, 0, shown.splice(at, 1)[0]);
        }
        await page.waitForTimeout(gap);
    }
    const end = await settled(selector);
    const ok = end.order.join("|") === shown.join("|") && end.styles === 0 && ignored === 0;
    report(
        `${label}, ${moves.length} moves ${gap} ms apart`,
        ok,
        `meant:  ${shown.join(" | ")}\n       got:    ${end.order.join(" | ")}\n       presses that picked nothing up: ${ignored}, styles left on rows: ${end.styles}`
    );
}

/**
 * One row, picked up again right after it was dropped (also while its copy is still gliding to its place).
 * `by` is where it is pressed: on its text or on its six dots.
 */
async function sameRow(label, selector, gap, by = "text") {
    const spots = await page.evaluate(sel => {
        const rows = window.robot.rows(sel);
        const target = rows[Math.min(2, rows.length - 1)];
        (window.getComputedStyle(target).display === "contents" ? target.children[1] : target).scrollIntoView({
            block: "center"
        });
        return rows.map(row => {
            const handle = row.querySelector(".dragdrop-handle");
            return { ...window.robot.middle(row), dotsX: handle ? window.robot.middle(handle).x : 0 };
        });
    }, selector);
    const shown = await order(selector);
    const name = shown[0];
    let ignored = 0;
    for (const to of [2, 0, 3, 1, 4, 2, 0, 4]) {
        const from = shown.indexOf(name);
        if (from === to) {
            continue;
        }
        const x = by === "dots" ? spots[from].dotsX : spots[from].x - 80;
        await page.mouse.move(x, spots[from].y);
        await page.mouse.down();
        await page.mouse.move(x, spots[to].y + (to > from ? 6 : -6), { steps: 4 });
        if (!(await page.evaluate(() => document.querySelectorAll(".dragdrop-ghost").length > 0))) {
            ignored += 1;
        }
        await page.mouse.up();
        shown.splice(to, 0, shown.splice(from, 1)[0]);
        await page.waitForTimeout(gap);
    }
    const end = await settled(selector);
    report(
        `${label}: the same row picked up again ${gap} ms after each drop, by its ${by}`,
        end.order.join("|") === shown.join("|") && end.styles === 0 && ignored === 0,
        `meant:  ${shown.join(" | ")}\n       got:    ${end.order.join(" | ")}\n       presses that picked nothing up: ${ignored}, styles left on rows: ${end.styles}`
    );
}

const MOVES = [
    [0, 2],
    [3, 1],
    [4, 0],
    [1, 3],
    [2, 4],
    [4, 1],
    [0, 4],
    [3, 0]
];
const TILE_MOVES = [
    [0, 5],
    [9, 2],
    [3, 7],
    [7, 0],
    [1, 8],
    [6, 4]
];

if (what === "chains" || what === "all") {
    for (const delay of [350, 900]) {
        await open({ delay });
        for (const gap of [0, 80, 200, 350, 600]) {
            await chain(`grid rows (server ${delay} ms)`, "#grid-body > .tr", MOVES, gap);
        }
        for (const gap of [0, 80, 250, 500]) {
            await chain(`status list (server ${delay} ms)`, "#status-list > .widget-gallery-item", MOVES, gap);
        }
    }
    await open();
    for (const gap of [0, 150]) {
        await chain("tabs", "#tab-list > .widget-gallery-item", MOVES, gap);
        await chain("tiles", "#tile-list > .widget-gallery-item", TILE_MOVES, gap);
    }
    for (const gap of [0, 60, 150, 300, 600]) {
        await open();
        await sameRow("grid rows", "#grid-body > .tr", gap);
        await sameRow("status list", "#status-list > .widget-gallery-item", gap);
    }
    await open();
    await sameRow("grid rows", "#grid-body > .tr", 60, "dots");
    await sameRow("status list", "#status-list > .widget-gallery-item", 150, "dots");
    await open({ delay: 900 });
    await sameRow("grid rows (server 900 ms)", "#grid-body > .tr", 100);
    await open({ duration: 0 });
    await chain("grid rows, duration 0", "#grid-body > .tr", MOVES, 0);
    await open({ duration: 600, flow: "easeInOut" });
    await chain("grid rows, duration 600 ease in-out", "#grid-body > .tr", MOVES, 100);
}

if (what === "lists" || what === "all") {
    const STATUS = "#status-list > .widget-gallery-item";
    const animations = () => page.evaluate(() => window.harness.animations().map(entry => entry.split(":")[0]));
    const click = async id => {
        await page.click(`#${id}`);
        await page.waitForTimeout(700);
        return animations();
    };
    const count = (list, kind) => list.filter(entry => entry === kind).length;

    // --- List changes ---------------------------------------------------------------------------------------
    await open();
    report("nothing animates when the page loads", (await animations()).length === 0);
    let seen = await click("status-add");
    report("a new last row comes in", count(seen, "enter") === 1 && count(seen, "slide") === 0, seen.join(" "));
    seen = await click("status-insert");
    report("a new 2nd row comes in and the rows below slide", count(seen, "enter") === 1 && count(seen, "slide") === 6, seen.join(" "));
    seen = await click("status-remove-second");
    report("a deleted row fades away and the rows below slide", count(seen, "leave") === 1 && count(seen, "slide") === 6, seen.join(" "));
    seen = await click("status-reset");
    report("a list that is loaded anew just appears", seen.length === 0, seen.join(" "));
    await page.check("#late");
    seen = await click("status-add");
    report("a new row whose widget renders late comes in", count(seen, "enter") === 1, seen.join(" "));
    await page.uncheck("#late");
    seen = await click("grid-add");
    report("a new data grid row fades in, cell by cell", count(seen, "enter") === 4 && count(seen, "slide") > 0, seen.join(" "));
    let left = await page.evaluate(() => window.robot.leftovers());
    report("nothing is left on the rows afterwards", left.styles === 0 && left.copies === 0, JSON.stringify(left));

    // --- Timing ---------------------------------------------------------------------------------------------
    await open({ duration: 600, flow: "linear" });
    let spots = await places(STATUS);
    await page.mouse.move(spots[0].x, spots[0].y);
    await page.mouse.down();
    await page.mouse.move(spots[3].x, spots[3].y + 6, { steps: 4 });
    await page.waitForTimeout(80);
    let style = await page.evaluate(sel => window.robot.rows(sel)[1].style.transition, STATUS);
    report("Duration and Animation flow set how rows make room", /600ms/.test(style) && /linear/.test(style), style);
    await page.mouse.up();
    await settled(STATUS);
    seen = await click("status-add");
    let timing = await page.evaluate(() => {
        const rows = window.robot.rows("#status-list > .widget-gallery-item");
        const effect = rows[rows.length - 1].getAnimations()[0];
        return effect ? effect.effect.getTiming() : null;
    });
    report(
        "and how long a new row takes to come in",
        !!timing && timing.duration === 780 && timing.delay === 330 && timing.easing === "linear",
        JSON.stringify(timing)
    );
    await open({ duration: 0 });
    seen = await click("status-insert");
    report("Duration 0 animates nothing", seen.length === 0, seen.join(" "));

    // --- A drop the server refuses, or never answers --------------------------------------------------------
    await open({ refuse: true });
    let before = await order(STATUS);
    spots = await places(STATUS);
    await move(STATUS, spots, 0, 3);
    await page.waitForTimeout(150);
    await move(STATUS, spots, 4, 1);
    // The engine gives the list a moment to reload after the action before it takes the move for refused.
    await page.waitForTimeout(2600);
    let end = await settled(STATUS);
    report(
        "refused moves (two on top of each other) slide back",
        end.order.join("|") === before.join("|") && end.styles === 0,
        `${end.order.join(" | ")} (styles ${end.styles})`
    );
    await open({ silent: true });
    before = await order(STATUS);
    spots = await places(STATUS);
    await move(STATUS, spots, 1, 4);
    await page.waitForTimeout(2600);
    end = await settled(STATUS);
    report("a move the list never reloads for slides back", end.order.join("|") === before.join("|") && end.styles === 0, end.order.join(" | "));

    // --- Cancel, clicks, keyboard ---------------------------------------------------------------------------
    await open();
    before = await order(STATUS);
    spots = await places(STATUS);
    await page.mouse.move(spots[1].x, spots[1].y);
    await page.mouse.down();
    await page.mouse.move(spots[4].x, spots[4].y, { steps: 4 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    end = await settled(STATUS);
    report("Escape puts the row back", end.order.join("|") === before.join("|") && end.styles === 0, end.order.join(" | "));

    const TABS = "#tab-list > .widget-gallery-item";
    spots = await places(TABS);
    await page.mouse.click(spots[1].x, spots[1].y);
    let clicks = await page.textContent("#tab-clicks");
    report("a click on a row is still a click", clicks === "1", clicks);
    await move(TABS, spots, 0, 2);
    await settled(TABS);
    clicks = await page.textContent("#tab-clicks");
    report("a drag is not a click", clicks === "1", clicks);

    before = await order(STATUS);
    await page.focus(`${STATUS}:nth-child(2) .dragdrop-handle`);
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Space");
    end = await settled(STATUS);
    const byKeys = before.slice();
    byKeys.splice(3, 0, byKeys.splice(1, 1)[0]);
    report("Space, arrow, arrow, Space moves a row two places", end.order.join("|") === byKeys.join("|") && end.styles === 0, end.order.join(" | "));

    before = await order(STATUS);
    await page.focus(`${STATUS}:nth-child(2) .dragdrop-handle`);
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    end = await settled(STATUS);
    report("Left and Right do nothing in a list that runs down", end.order.join("|") === before.join("|") && end.styles === 0, end.order.join(" | "));

    // --- Between lists --------------------------------------------------------------------------------------
    const cards = lane => `#board .lane:nth-child(${lane}) .widget-gallery-item`;
    const lanes = () => page.evaluate(() => window.harness.lanes().join(" "));
    await page.evaluate(() => document.querySelector("#board").scrollIntoView({ block: "center" }));
    const centre = async selector => page.evaluate(sel => window.robot.middle(document.querySelector(sel)), selector);
    const card = await page.evaluate(sel => window.robot.nameOf(document.querySelector(sel)), cards(1));
    let a = await centre(cards(1));
    let b = await centre(cards(3));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y - 6, { steps: 5 });
    await page.mouse.up();
    // At once another card of the first lane, to the empty lane: it has to wait for the first to be confirmed.
    await page.waitForTimeout(120);
    a = await centre(cards(1));
    // The board scrolls sideways and the empty lane is only partly in view: aim at the part that is.
    b = await page.evaluate(() => {
        const box = document.querySelector("#board .lane:nth-child(4) .lane-cards").getBoundingClientRect();
        return { x: box.left + 30, y: box.top + box.height / 2 };
    });
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    await page.mouse.up();
    await page.waitForTimeout(1500);
    await settled(cards(3));
    const third = await order(cards(3));
    left = await page.evaluate(() => window.robot.leftovers());
    report(
        "two cards to other lanes right after each other (one to the empty lane)",
        (await lanes()) === "new:1 contact:14 quote:3 empty:1 lost:4" && third[0] === card && left.styles === 0 && left.copies === 0,
        `${await lanes()}; first card of lane 3: ${third[0]}; ${JSON.stringify(left)}`
    );
    seen = await animations();
    report("a card that changes lanes is not shown leaving or coming in", count(seen, "enter") === 0 && count(seen, "leave") === 0, seen.join(" "));

    const line = pack => `#package-list > .widget-gallery-item:nth-child(${pack}) .lines > .widget-gallery-item`;
    await page.evaluate(() => document.querySelector("#package-list").scrollIntoView({ block: "center" }));
    const lineName = await page.evaluate(sel => window.robot.nameOf(document.querySelector(sel)), line(1));
    a = await centre(line(1));
    b = await centre(line(2));
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 5 });
    // The package the line came from gets shorter, so the other one moves up: look again, as a person would.
    await page.waitForTimeout(350);
    b = await centre(line(2));
    await page.mouse.move(b.x, b.y - 6, { steps: 3 });
    await page.waitForTimeout(350);
    await page.mouse.up();
    await settled(line(2));
    report("a line to another package", (await order(line(2)))[0] === lineName, (await order(line(2))).join(" | "));
    const PACKAGES = "#package-list > .widget-gallery-item";
    const packs = async () => page.evaluate(sel => Array.from(document.querySelectorAll(sel)).map(el => el.querySelector("strong").textContent), PACKAGES);
    before = await packs();
    a = await centre(`${PACKAGES}:nth-child(1) > .row > .dragdrop-handle`);
    b = await centre(`${PACKAGES}:nth-child(3)`);
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y + 150, { steps: 6 });
    await page.mouse.up();
    await settled(PACKAGES);
    const after = await packs();
    report(
        "a package moves as a block by its six dots (to the end)",
        after.join("|") === [before[1], before[2], before[0]].join("|"),
        after.join(" | ")
    );
    left = await page.evaluate(() => window.robot.leftovers());
    report("nothing is left on the rows afterwards (lists)", left.styles === 0 && left.copies === 0 && !left.dragging, JSON.stringify(left));

    // --- Automatic sequencing -------------------------------------------------------------------------------
    // The rows swap the numbers that are there and are saved one by one; the list reloads after every save.
    const AUTO = "#auto-list > .widget-gallery-item";
    const saved = () => page.evaluate(() => window.harness.saved().join(" "));
    const names = async () => (await order(AUTO)).map(text => text.replace(/Sequence.*$/, "").trim());
    await open();
    await animations();
    spots = await places(AUTO);
    await move(AUTO, spots, 0, 3);
    end = await settled(AUTO);
    let stored = await saved();
    report(
        "automatic: the rows between the old and the new place swap their numbers",
        stored === "10:Saved 2 20:Saved 3 30:Saved 4 40:Saved 1 50:Saved 5 60:Saved 6" && end.styles === 0,
        stored
    );
    seen = await animations();
    report("automatic: no row is shown coming or going while the rows are saved", count(seen, "enter") === 0 && count(seen, "leave") === 0, seen.join(" "));

    spots = await places(AUTO);
    await move(AUTO, spots, 5, 0);
    await page.waitForTimeout(120);
    await move(AUTO, spots, 1, 4);
    end = await settled(AUTO);
    stored = await saved();
    report(
        "automatic: two moves right after each other",
        stored === "10:Saved 6 20:Saved 3 30:Saved 4 40:Saved 1 50:Saved 2 60:Saved 5" && end.styles === 0,
        stored
    );

    await page.click("#auto-same");
    await page.waitForTimeout(600);
    before = await names();
    spots = await places(AUTO);
    await move(AUTO, spots, 0, 2);
    end = await settled(AUTO);
    stored = await saved();
    const repaired = [before[1], before[2], before[0], before[3], before[4], before[5]].map((name, i) => `${i + 1}:${name}`).join(" ");
    report("automatic: rows with the same or no number are numbered 1..n once", stored === repaired && end.styles === 0, `${stored}  (expected ${repaired})`);

    await page.check("#refuse");
    before = await names();
    const kept = await saved();
    spots = await places(AUTO);
    await move(AUTO, spots, 0, 3);
    end = await settled(AUTO);
    report(
        "automatic: rows that cannot be saved slide back and keep their numbers",
        (await names()).join("|") === before.join("|") && (await saved()) === kept && end.styles === 0,
        `${(await names()).join(" | ")}; ${await saved()}`
    );
    await page.uncheck("#refuse");
    left = await page.evaluate(() => window.robot.leftovers());
    report("nothing is left on the rows afterwards (automatic)", left.styles === 0 && left.copies === 0 && !left.dragging, JSON.stringify(left));

    // --- Touch ----------------------------------------------------------------------------------------------
    const touchContext = await browser.newContext({ viewport: { width: 1300, height: 1000 }, hasTouch: true });
    page = await touchContext.newPage();
    const cdp = await touchContext.newCDPSession(page);
    const touch = (type, x, y) =>
        cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x, y }] });
    const finger = async (from, to, holdMs) => {
        await touch("touchStart", from.x, from.y);
        await page.waitForTimeout(holdMs);
        for (let i = 1; i <= 6; i++) {
            await touch("touchMove", from.x + ((to.x - from.x) * i) / 6, from.y + ((to.y - from.y) * i) / 6);
            await page.waitForTimeout(16);
        }
        await touch("touchEnd");
    };
    await open();
    before = await order(STATUS);
    spots = await places(STATUS);
    // On the row's text, not on the six dots.
    const onText = spot => ({ x: spot.x - 60, y: spot.y });
    await finger(onText(spots[1]), { x: spots[1].x - 60, y: spots[3].y + 6 }, 0);
    end = await settled(STATUS);
    report("a swipe over a row does not pick it up", end.order.join("|") === before.join("|") && end.styles === 0, end.order.join(" | "));
    spots = await places(STATUS);
    await finger(onText(spots[1]), { x: spots[1].x - 60, y: spots[3].y + 6 }, 320);
    end = await settled(STATUS);
    const byFinger = before.slice();
    byFinger.splice(3, 0, byFinger.splice(1, 1)[0]);
    report("holding a row, then moving, drags it", end.order.join("|") === byFinger.join("|") && end.styles === 0, end.order.join(" | "));
    spots = await places(STATUS);
    const dots = await page.evaluate(sel => window.robot.middle(window.robot.rows(sel)[0].querySelector(".dragdrop-handle")), STATUS);
    await finger(dots, { x: dots.x, y: spots[2].y + 6 }, 0);
    end = await settled(STATUS);
    byFinger.splice(2, 0, byFinger.splice(0, 1)[0]);
    report("the six dots pick a row up at once", end.order.join("|") === byFinger.join("|") && end.styles === 0, end.order.join(" | "));
    await touchContext.close();
}

await browser.close();
console.log(failures.length === 0 ? `\nAll ${checks} checks passed.` : `\n${failures.length} of ${checks} checks failed:\n  ${failures.join("\n  ")}`);
process.exit(failures.length === 0 ? 0 : 1);
