// Development harness for the drag engine. It builds lists that look like what Mendix renders (Gallery, Data
// grid 2) and re-renders them the way React does: keyed nodes are kept and moved, and a row that goes to
// another list is a new node there. A fake server applies each drop after a delay, or refuses it.

import { actionFinished, EASINGS, registerItem, registerZone } from "./build/engine/index.js";

// A page that is not on screen gets no animation frames, and the engine measures and follows the pointer in
// them. harness.html?timers runs it on timers instead, so the harness can be driven in a hidden browser too.
if (new URLSearchParams(window.location.search).has("timers")) {
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 16);
    window.cancelAnimationFrame = id => window.clearTimeout(id);
}

// Every animation the engine starts is noted, so a check can tell what a list change set in motion.
const animations = [];
const nativeAnimate = Element.prototype.animate;
Element.prototype.animate = function (keyframes, options) {
    const first = keyframes[0] || {};
    const kind = this.hasAttribute("data-dragdrop-ghost") ? "leave" : "opacity" in first ? "enter" : "slide";
    animations.push({
        kind,
        row: (this.textContent || "").trim().replace(/\s+/g, " ").slice(0, 24),
        from: kind === "slide" ? ` from ${first.transform.replace(/translate3d\((.*), 0(px)?\)/, "$1")}` : ""
    });
    return nativeAnimate.call(this, keyframes, options);
};

const $ = id => document.getElementById(id);
const settings = {
    get delay() {
        return Number($("delay").value) || 0;
    },
    get refuse() {
        return $("refuse").checked;
    },
    get silent() {
        return $("silent").checked;
    },
    get late() {
        return $("late").checked;
    },
    get duration() {
        const value = Number($("duration").value);
        return value >= 0 ? value : 200;
    },
    get easing() {
        return EASINGS[$("flow").value];
    }
};

/** Gives a row's options the widget's Timing settings, read from the toolbar each time the engine asks. */
function withTiming(options) {
    return Object.defineProperties(options, {
        duration: { get: () => settings.duration, enumerable: true },
        easing: { get: () => settings.easing, enumerable: true }
    });
}

function log(label, info) {
    const text = info ? `${label} ${JSON.stringify(info)}` : label;
    $("log").textContent = `${text}\n${$("log").textContent}`.slice(0, 4000);
}

function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) {
        node.className = className;
    }
    if (text !== undefined) {
        node.textContent = text;
    }
    return node;
}

function grip() {
    const span = el("span", "dragdrop-handle");
    span.setAttribute("role", "button");
    span.tabIndex = 0;
    span.innerHTML =
        '<svg class="dragdrop-grip" viewBox="0 0 10 16"><circle cx="2.5" cy="3" r="1.5"/><circle cx="7.5" cy="3" r="1.5"/>' +
        '<circle cx="2.5" cy="8" r="1.5"/><circle cx="7.5" cy="8" r="1.5"/><circle cx="2.5" cy="13" r="1.5"/><circle cx="7.5" cy="13" r="1.5"/></svg>';
    return span;
}

/** The fake server: applies `change` after the delay (unless it refuses), then the lists re-render. */
function server(change, rerender) {
    const refuse = settings.refuse;
    const silent = settings.silent;
    window.setTimeout(() => {
        if (!refuse) {
            change();
        }
        actionFinished();
        if (!silent) {
            window.setTimeout(rerender, 100);
        }
    }, settings.delay);
}

/** A sort value between the neighbours, as the widget computes it. */
function between(info) {
    const above = info.afterSortValue === undefined ? undefined : Number(info.afterSortValue);
    const below = info.beforeSortValue === undefined ? undefined : Number(info.beforeSortValue);
    if (above !== undefined && below !== undefined) {
        return (above + below) / 2;
    }
    if (below !== undefined) {
        return below - 1;
    }
    if (above !== undefined) {
        return above + 1;
    }
    return 0;
}

/** Renders data into a container the way React renders keyed children. */
class KeyedList {
    constructor(container, create, options, update) {
        this.container = container;
        this.create = create;
        this.options = options;
        this.update = update;
        this.records = new Map();
    }

    render(data) {
        const wanted = new Set(data.map(item => item.id));
        for (const [id, record] of this.records) {
            if (!wanted.has(id)) {
                if (record.registration) {
                    record.registration.unregister();
                }
                record.node.remove();
                this.records.delete(id);
            }
        }
        data.forEach((item, index) => {
            let record = this.records.get(item.id);
            const isNew = !record;
            if (!record) {
                record = { node: this.create(item), registration: null };
                this.records.set(item.id, record);
            }
            const current = this.container.children[index];
            if (current !== record.node) {
                this.container.insertBefore(record.node, current || null);
            }
            if (isNew) {
                const register = () => {
                    if (this.records.get(item.id) !== record) {
                        return; // removed again before its widget rendered
                    }
                    record.registration = registerItem(record.node, withTiming(this.options(item, record.node)));
                    const handle = record.node.querySelector(":scope .dragdrop-handle");
                    if (handle && handle.closest("[data-dragdrop-row]") === record.node) {
                        handle.addEventListener("keydown", event => record.registration.keyDown(event));
                        handle.addEventListener("blur", () => record.registration.focusLost());
                    }
                };
                // The widget in a row normally renders together with the row; "late" renders it a moment after.
                if (settings.late) {
                    window.setTimeout(register, 30);
                } else {
                    register();
                }
            } else if (record.registration) {
                record.registration.update(withTiming(this.options(item, record.node)));
            }
            if (this.update) {
                this.update(item, record.node);
            }
        });
    }
}

const COLORS = ["#2e90fa", "#98a2b3", "#12b76a", "#f79009", "#ee46bc", "#7a5af8", "#f04438"];

// --- 1. Status list ---------------------------------------------------------------------------------------

let statuses = ["New", "Contacted", "Quote sent", "Approved", "Planned", "Done"].map(
    (name, i) => ({ id: `s${i}`, name, seq: i + 1, color: COLORS[i % COLORS.length] })
);
let statusCounter = statuses.length;

const statusList = new KeyedList(
    $("status-list"),
    item => {
        const node = el("div", "widget-gallery-item");
        const row = el("div", "row");
        const dot = el("span", "dot");
        dot.style.background = item.color;
        const edit = el("button", "", "Edit");
        edit.addEventListener("click", () => log(`edit ${item.name}`));
        row.append(grip(), el("span", "name", item.name), dot, el("span", "muted seq"), el("span", "fill"), edit);
        node.append(row);
        return node;
    },
    (item, node) => ({
        group: "status",
        key: item.id,
        sortValue: String(item.seq),
        disabled: false,
        handle: node.querySelector(".dragdrop-handle"),
        whole: true,
        optimistic: true,
        animate: true,
        drop: info => {
            log("status", info);
            server(() => {
                item.seq = between(info);
                statuses.sort((a, b) => a.seq - b.seq);
                statuses.forEach((status, i) => (status.seq = i + 1));
            }, renderStatuses);
            return true;
        }
    }),
    (item, node) => {
        node.querySelector(".seq").textContent = `Sequence ${item.seq}`;
    }
);

function renderStatuses() {
    statusList.render(statuses);
}

function newStatus() {
    statusCounter += 1;
    return {
        id: `s${statusCounter}`,
        name: `Status ${statusCounter}`,
        seq: 0,
        color: COLORS[statusCounter % COLORS.length]
    };
}

function renumberStatuses() {
    statuses.forEach((status, i) => (status.seq = i + 1));
    renderStatuses();
}

$("status-add").addEventListener("click", () => {
    statuses.push(newStatus());
    renumberStatuses();
});
$("status-insert").addEventListener("click", () => {
    statuses.splice(1, 0, newStatus());
    renumberStatuses();
});
$("status-remove").addEventListener("click", () => {
    statuses.pop();
    renumberStatuses();
});
$("status-remove-second").addEventListener("click", () => {
    statuses.splice(1, 1);
    renumberStatuses();
});
// Every row is another object afterwards, as after a reset or another page of the list.
$("status-reset").addEventListener("click", () => {
    statuses = statuses.map(status => ({ ...status, id: newStatus().id }));
    renumberStatuses();
});
$("status-shuffle").addEventListener("click", () => {
    statuses.unshift(statuses.pop());
    statuses.forEach((status, i) => (status.seq = i + 1));
    renderStatuses();
});

// --- 2. Tabs and 3. Tiles (whole row) ------------------------------------------------------------------------

function simpleList(containerId, group, names, className) {
    let data = names.map((name, i) => ({ id: `${group}${i}`, name, seq: i + 1 }));
    const list = new KeyedList(
        $(containerId),
        item => {
            let node;
            if (className) {
                node = el("div", "widget-gallery-item", item.name);
                node.classList.add(className);
            } else {
                node = el("div", "widget-gallery-item");
                node.appendChild(el("div", "pill", item.name));
            }
            return node;
        },
        item => ({
            group,
            key: item.id,
            sortValue: String(item.seq),
            disabled: false,
            handle: null,
            whole: true,
            optimistic: true,
            animate: true,
            drop: info => {
                log(group, info);
                server(
                    () => {
                        data = data.filter(other => other !== item);
                        data.splice(info.newIndex, 0, item);
                        data.forEach((other, i) => (other.seq = i + 1));
                    },
                    () => list.render(data)
                );
                return true;
            }
        })
    );
    list.render(data);
    return list;
}

simpleList("tab-list", "tabs", ["All items", "My items", "This week", "Quote sent", "Lost"]);
$("tab-list").addEventListener("click", event => {
    if (event.target.closest(".widget-gallery-item")) {
        $("tab-clicks").textContent = String(Number($("tab-clicks").textContent) + 1);
    }
});
simpleList(
    "tile-list",
    "tiles",
    Array.from({ length: 10 }, (_, i) => `Tile ${i + 1}`)
);

// --- 4. Packages with lines -------------------------------------------------------------------------------

let packages = [
    { id: "p1", name: "Heat pump package", lines: ["Outdoor unit", "Indoor unit", "Boiler 200L", "Installation"] },
    { id: "p2", name: "Solar package", lines: ["12 panels", "Inverter", "Cabling"] },
    { id: "p3", name: "Empty package", lines: [] }
].map(pack => ({ ...pack, lines: pack.lines.map((name, i) => ({ id: `${pack.id}-l${i}`, name })) }));

const lineLists = new Map();

function renderLines(pack) {
    const list = lineLists.get(pack.id);
    if (list) {
        list.render(pack.lines);
    }
}

const packageList = new KeyedList(
    $("package-list"),
    pack => {
        const node = el("div", "widget-gallery-item package");
        const header = el("div", "row");
        header.append(grip(), el("strong", "", pack.name));
        const lines = el("div", "widget-gallery-items lines");
        node.append(header, lines);
        // The package is a drop zone for lines; a line reports the zone it went to.
        registerZone(node, {
            group: "lines",
            key: pack.id,
            disabled: false,
            optimistic: true,
            animate: true,
            drop: null
        });
        lineLists.set(
            pack.id,
            new KeyedList(
                lines,
                line => {
                    const lineNode = el("div", "widget-gallery-item");
                    const row = el("div", "row");
                    row.append(grip(), el("span", "", line.name));
                    lineNode.append(row);
                    return lineNode;
                },
                (line, lineNode) => ({
                    group: "lines",
                    key: line.id,
                    sortValue: undefined,
                    disabled: false,
                    handle: lineNode.querySelector(".dragdrop-handle"),
                    whole: true,
                    optimistic: true,
                    animate: true,
                    drop: info => {
                        log("line", info);
                        const from = packages.find(other => other.id === info.fromZoneKey);
                        const to = packages.find(other => other.id === info.toZoneKey);
                        server(
                            () => {
                                from.lines = from.lines.filter(other => other !== line);
                                to.lines.splice(info.newIndex, 0, line);
                            },
                            () => {
                                renderLines(from);
                                if (to !== from) {
                                    renderLines(to);
                                }
                            }
                        );
                        return true;
                    }
                })
            )
        );
        return node;
    },
    (pack, node) => ({
        group: "packages",
        key: pack.id,
        sortValue: undefined,
        disabled: false,
        handle: node.querySelector(":scope > .row > .dragdrop-handle"),
        whole: false,
        optimistic: true,
        animate: true,
        drop: info => {
            log("package", info);
            server(
                () => {
                    packages = packages.filter(other => other !== pack);
                    packages.splice(info.newIndex, 0, pack);
                },
                () => packageList.render(packages)
            );
            return true;
        }
    })
);
packageList.render(packages);
packages.forEach(renderLines);

// --- 5. Board ---------------------------------------------------------------------------------------------

const lanes = [
    { id: "new", name: "New", count: 3 },
    { id: "contact", name: "Contacted", count: 14 },
    { id: "quote", name: "Quote sent", count: 2 },
    { id: "empty", name: "Approved (empty)", count: 0 },
    { id: "lost", name: "Verloren", count: 4 }
].map(lane => ({
    ...lane,
    cards: Array.from({ length: lane.count }, (_, i) => ({
        id: `${lane.id}-c${i}`,
        name: `Card ${lane.name} ${i + 1}`,
        sort: i + 1
    }))
}));
const laneLists = new Map();

lanes.forEach(lane => {
    const node = el("div", "lane kbn-lane");
    const cards = el("div", "lane-cards");
    const items = el("div", "widget-gallery-items");
    cards.append(items);
    node.append(el("div", "lane-header", lane.name), cards);
    $("board").append(node);
    registerZone(node, {
        group: "cards",
        key: lane.id,
        disabled: false,
        optimistic: true,
        animate: true,
        drop: info => {
            log("board", info);
            const from = lanes.find(other => other.id === info.fromZoneKey);
            const card = from.cards.find(other => other.id === info.draggedKey);
            server(
                () => {
                    from.cards = from.cards.filter(other => other !== card);
                    lane.cards.splice(info.newIndex, 0, card);
                    lane.cards.forEach((other, i) => (other.sort = i + 1));
                },
                () => {
                    // The source lane refreshes first, as two separate data sources would.
                    laneLists.get(from.id).render(from.cards);
                    if (from !== lane) {
                        window.setTimeout(() => laneLists.get(lane.id).render(lane.cards), 60);
                    }
                }
            );
            return true;
        }
    });
    const list = new KeyedList(
        items,
        card => {
            const cardNode = el("div", "widget-gallery-item");
            cardNode.append(el("div", "kbn-card", card.name));
            return cardNode;
        },
        card => ({
            group: "cards",
            key: card.id,
            sortValue: String(card.sort),
            disabled: false,
            handle: null,
            whole: true,
            optimistic: true,
            animate: true,
            drop: null
        })
    );
    laneLists.set(lane.id, list);
    list.render(lane.cards);
});

// --- 6. Data grid rows ------------------------------------------------------------------------------------

let questions = [
    ["Type woning", "Keuzelijst"],
    ["Bouwjaar", "Getal"],
    ["Huidige verwarming", "Keuzelijst"],
    ["Dakoppervlak", "Getal"],
    ["Opmerkingen", "Tekst"]
].map(([name, type], i) => ({ id: `q${i}`, name, type, seq: i + 1 }));

const gridList = new KeyedList(
    $("grid-body"),
    question => {
        const row = el("div", "tr");
        row.setAttribute("role", "row");
        const first = el("div", "td");
        first.append(grip());
        row.append(first, el("div", "td", question.name), el("div", "td", question.type), el("div", "td seq"));
        return row;
    },
    (question, row) => ({
        group: "grid",
        key: question.id,
        sortValue: String(question.seq),
        disabled: false,
        handle: row.querySelector(".dragdrop-handle"),
        whole: true,
        optimistic: true,
        animate: true,
        drop: info => {
            log("grid", info);
            server(
                () => {
                    questions = questions.filter(other => other !== question);
                    questions.splice(info.newIndex, 0, question);
                    questions.forEach((other, i) => (other.seq = i + 1));
                },
                () => gridList.render(questions)
            );
            return true;
        }
    }),
    (question, row) => {
        row.querySelector(".seq").textContent = String(question.seq);
    }
);
gridList.render(questions);
renderStatuses();

let questionCounter = questions.length;
function renumberQuestions() {
    questions.forEach((question, i) => (question.seq = i + 1));
    gridList.render(questions);
}
$("grid-add").addEventListener("click", () => {
    questionCounter += 1;
    questions.splice(1, 0, { id: `q${questionCounter}`, name: `Question ${questionCounter}`, type: "Text", seq: 0 });
    renumberQuestions();
});
$("grid-remove").addEventListener("click", () => {
    questions.splice(1, 1);
    renumberQuestions();
});

// --- 7. Saved list (automatic sequencing) ---------------------------------------------------------------------
// The widget's basic settings: no drop action that numbers the rows. The engine hands each row that changes place
// the sort value of its new place (`assign`), and every row is saved on its own: the list reloads after each save,
// sorted by what the server has by then, which is only the final order after the last one.

const AUTO_START = [10, 20, 30, 40, 50, 60];
let autoItems = AUTO_START.map((seq, i) => ({ id: `a${i}`, name: `Saved ${i + 1}`, seq }));

const autoList = new KeyedList(
    $("auto-list"),
    item => {
        const node = el("div", "widget-gallery-item");
        const row = el("div", "row");
        row.append(grip(), el("span", "name", item.name), el("span", "muted seq"));
        node.append(row);
        return node;
    },
    (item, node) => ({
        group: "default",
        key: "",
        sortValue: item.seq === null ? undefined : String(item.seq),
        disabled: false,
        handle: node.querySelector(".dragdrop-handle"),
        whole: true,
        optimistic: true,
        animate: true,
        drop: null,
        assign: (value, index, done) => {
            if (settings.refuse) {
                return false;
            }
            log(`auto ${item.name} -> ${value}`);
            // Each row is saved by its own request; they come back one after the other.
            window.setTimeout(() => {
                item.seq = Number(value);
                renderAuto();
                done();
            }, settings.delay + index * 40);
            return true;
        }
    }),
    (item, node) => {
        node.querySelector(".seq").textContent = `Sequence ${item.seq === null ? "-" : item.seq}`;
    }
);

function renderAuto() {
    // As a database source sorted by the attribute does: rows without a value first, ties in the order they came.
    autoItems = autoItems
        .map((item, i) => ({ item, i }))
        .sort((a, b) => (a.item.seq === null ? -1 : a.item.seq) - (b.item.seq === null ? -1 : b.item.seq) || a.i - b.i)
        .map(entry => entry.item);
    autoList.render(autoItems);
}

$("auto-reset").addEventListener("click", () => {
    autoItems.forEach((item, i) => (item.seq = AUTO_START[i % AUTO_START.length]));
    renderAuto();
});
$("auto-same").addEventListener("click", () => {
    // New rows often all start with the same number, or none.
    autoItems.forEach((item, i) => (item.seq = i < 2 ? null : 0));
    autoList.render(autoItems);
});
renderAuto();

// For checks from the browser's console or an automated driver.
window.harness = {
    /** The animations started since the last call, as "kind:row" (a slide with the distance it comes from). */
    animations: () => animations.splice(0).map(entry => `${entry.kind}:${entry.row}${entry.from}`),
    order: id => Array.from($(id).children).map(node => node.textContent.trim().slice(0, 40)),
    statuses: () => statuses.map(status => `${status.seq}:${status.name}`),
    lanes: () => lanes.map(lane => `${lane.id}:${lane.cards.length}`),
    /** The saved list as the server has it: "sequence:name" in the order of the list. */
    saved: () => autoItems.map(item => `${item.seq}:${item.name}`)
};
