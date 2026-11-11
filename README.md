# Drag and Drop

A Mendix pluggable widget (`homezero.dragdrop.DragDrop`, shown in Studio Pro as "Drag & drop") that adds
drag-and-drop to a list that already exists. You place it in a row; it draws a six-dot grip there and makes that row
draggable among the rows of its list. The list itself (a Gallery, a Data grid 2, a list view) keeps loading and
showing its own data, so it looks exactly as before.

It works with mouse, touch and keyboard, in vertical lists, horizontal lists, wrapping grids, grouped lists and
boards with lanes. It has no dependencies besides Mendix itself.

- Live demo: https://autodraganddrop-sandbox.mxapps.io/ (no login needed; a free app, so the first visit can take a
  while to wake it up).
- Mendix Studio Pro 11.12 or later, web (React client).
- Licence: Apache 2.0.
- Questions and bugs: [GitHub issues](https://github.com/HomeZeroTech/mendix-dragdrop-widget/issues). Support is
  best effort.

![A card being dragged to an empty lane, next to a grouped list](docs/media/06-board-dragging.png)

## Use it in a list

1. Put the widget in the row template, where the six dots should appear.
2. Set **Sort value** to the row's sort attribute, e.g. `$currentObject/Sequence` (a Decimal).
3. Set **On drop** to a microflow or nanoflow. It runs with the dragged row's object as context and gets these
   variables:

   | Variable | Meaning |
   |---|---|
   | `newSortValue` | A value between the new neighbours: the average of both, the row below − 1, the row above + 1, or 0 in an empty list |
   | `newIndex` | 0-based position among the rows shown, without the dragged row |
   | `afterKey`, `beforeKey` | Item keys of the new neighbours (empty at the start or end) |
   | `toZoneKey`, `fromZoneKey` | Zone keys, when drop zones are used |

4. In the flow: set the sort attribute to `newSortValue`, retrieve the siblings in order, renumber them 1..n in a
   loop, commit, and refresh one object so the list reloads.

The widget shows the row at its new place at once and keeps that preview until the list reloads. When the list does
not change (the flow refused the move), the row slides back.

An Integer sort attribute cannot hold a value between two neighbours. Use `newIndex` instead: move the row to that
position in the retrieved list and renumber.

### Rows that move between lists

Add a second widget with **Role** = Drop zone to each lane or group, give it a **Zone key**, and give the rows an
**Item key**. Rows and zones only meet when their **Group** is the same. Either side can handle the drop: the row's
On drop gets `toZoneKey`; the zone's On drop in zone gets `draggedKey`.

A drop zone is one of two things (**Drop zone is**):

- **An element around this widget** (default): place the widget anywhere inside the lane or group and name that
  element with a CSS selector, e.g. `.board-lane`. The widget itself shows nothing. It must sit *inside* the element;
  next to it does not count.
- **The content of this widget**: place the list inside the widget. The widget draws a box around it and that box is
  the drop zone.

An empty list needs a drop zone around it. If the zone holds more than one list, give the target list the class
`dragdrop-list`.

## Properties

| Role | Property | Purpose |
|---|---|---|
| Both | Group | Rows only drop among rows and zones of the same group |
| Both | Disabled | An expression: the row cannot be dragged / the zone accepts no drops. A disabled row still makes room for others |
| Handle | Drag by | Whole row (default) or six dots only |
| Handle | Show six dots | Draw the grip where the widget sits (default on) |
| Handle | Sort value, Item key | See above |
| Handle | Row (CSS selector) | The element that moves, when it is not the list item the widget sits in |
| Handle | Handle label | Screen reader text and tooltip; empty = a built-in Dutch, German or English text |
| Drop zone | Zone key | Passed to the drop actions |
| Drop zone | Drop zone is | "An element around this widget" shows **Element (CSS selector)**; "The content of this widget" shows **Content**. An empty selector is an error in Studio Pro |
| Both | Animate list changes | Animate the list whenever it changes, not only after a drag (default on); see below |
| Both | Duration | How long a row takes to move to another place, in milliseconds (default 200; 0 = no animation) |
| Both | Animation flow | Ease in-out, Ease in, Ease out (default) or Linear |
| Handle | On drop | Action with the row as context |
| Drop zone | On drop in zone | Action with the zone as context |

Behaviour worth knowing:

- **Whole row**: buttons, links and inputs in the row keep working, and a drag does not click the row. On touch a
  press on the dots picks the row up at once; elsewhere it needs a short hold, so a swipe still scrolls.
- **Keyboard**: focus the dots, Space or Enter picks up, arrow keys move, Space or Enter drops, Escape cancels.
- **Escape** during a mouse or touch drag puts the row back.
- **Duration and Animation flow** also set the speed of the drag itself, so they stay in use when Animate list
  changes is off. The pair applies to everything that moves in the list: rows making room during a drag, the dropped
  row landing (a little quicker), rows sliding after a list change, a new row coming in (a little longer, after a
  short pause) and a deleted row fading away.
- **Moves in quick succession** do not wait for the server. A row picked up while an earlier move in the list is
  still on its way to the server is dragged on top of what the list shows. The drop actions then run one at a time,
  each after the list reloaded for the one before, so every action gets the sort values the previous one left
  behind. If one is refused, it and the moves made on top of it slide back. Only after a move to another list does
  the next drag wait until that move is confirmed.
- **Animate list changes** does what an auto-animate wrapper around the list would do; do not use both, they would
  each move the rows. A row that is added fades in, a row that is deleted fades away where it was, and the rows in
  between slide to their new place. A list that is loaded anew (no row stayed: another page, another filter) just
  appears, as does the first row of an empty list. A deleted Data grid 2 row disappears at once while the others
  slide. Users who ask their system for reduced motion get none of this.

## Styling

The widget's CSS is structural. Colours come from custom properties your theme can set:
`--dragdrop-handle-color`, `--dragdrop-handle-hover-color`, `--dragdrop-handle-hover-background`,
`--dragdrop-focus-color`, `--dragdrop-lift-shadow`, `--dragdrop-zone-over-outline`.

Hooks for app styles: `.dragdrop-handle`, `.dragdrop-ghost` (the copy that follows the pointer),
`.dragdrop-leaving` (the copy of a deleted row while it fades away), `[data-dragdrop-row]`, `[data-dragdrop-zone]`,
`[data-dragdrop-over]` (the zone under the pointer) and `html.dragdrop-active` (while dragging).

## Limits

- **Accessibility.** There is keyboard support, but this widget alone does not make a list meet WCAG:
  the keyboard moves a row within its own list only (not to another lane or group), a screen reader hears the handle
  label but no position while the row moves, and there is no click-only alternative to dragging (WCAG 2.5.7). Keep
  or add move buttons where you need that. Planned for a later version.
- A row needs the six dots to be reachable by keyboard.
- Rows without the widget in a list with the widget are not shifted during a drag.
- Not built: dragging several rows at once, trees (dropping onto a row), dragging from a palette, and "nothing may be
  dropped above this row" (let the drop action refuse instead).
- In a wrapping grid the gap animation assumes cells of equal size.
- After a move to another list the next drag waits until that move is confirmed. Moves within a list do not wait.
- Moves in a queue rely on the list reloading after each drop action. A flow that changes the order without
  refreshing anything leaves the queue waiting until the move counts as refused (about 1.5 s after the action).

## How it works

- `src/engine` has no Mendix or React dependency. It is given DOM elements (rows, grips, zones) and callbacks. It
  uses pointer events, no drag library and not the browser's built-in drag-and-drop (which has no touch).
- Rows are rendered by Mendix, so the engine never moves them in the DOM and never touches their class names. During
  a drag it hides the real row in place, moves a copy with the pointer and shifts the other rows with inline
  transforms. A see-through row gets a solid copy (the first background behind it), unless the row is only a
  holder for one painted element that fills it (a gallery item around a pill or a card): then the copy takes that
  element's corners, so its shadow follows the pill and no box shows around it.
- Positions are read from the layout (`offsetTop`), not from `getBoundingClientRect()`, so shifts and running
  transitions do not disturb the measurements. Data grid 2 rows have no box of their own (`display: contents`); the
  engine works on their cells.
- After a drop the shifts stay as a preview. One controller per list watches for Mendix re-rendering it and then
  slides every row from where it was shown to where it really is. That one step covers a confirmed drop (nothing
  moves), a refused drop (slides back) and ordinary list changes.
- A row can be shown away from its place in the layout for two reasons that add up: a preview (a drop the server
  has not confirmed) and a shift (a drag going on). A drag measures the rows where the previews show them, so it can
  start on top of a pending drop.
- `src/DragDrop.editorConfig.ts` hides the settings that do not apply to the chosen role. A value in a hidden
  property is error CE0463 in Studio Pro, so keep those rules and the XML in step.

## Develop

```bash
npm install
npm run build      # development build with source maps -> dist/<version>/homezero.DragDrop.mpk
npm run release    # minified build, the one that is published
```

`@mendix/pluggable-widgets-tools` is pinned to 11.12.0 (Studio Pro 11.12, Node 20 or later). If the build fails
on `@napi-rs/lzma` on Windows, install its platform package by hand:
`npm install --no-save @napi-rs/lzma-win32-x64-msvc@<version of node_modules/@napi-rs/lzma>`.

To develop against a Mendix app, put the app in `tests/testProject` (ignored by git): `npm run build` and
`npm start` copy the widget into that app's `widgets` folder. Changing a property in `src/DragDrop.xml` makes every
placed widget out of date; update them in Studio Pro with "Update all widgets".

### Harness

A page with hand-made lists that mimic what Mendix renders, driven by a fake server with a delay and a "refuse"
switch. It runs the engine without Mendix.

```bash
npm run harness        # builds dev/build/engine
node dev/serve.mjs     # http://localhost:4173/dev/harness.html
```

The buttons above the status list and the data grid add and delete rows, "Load anew" replaces every row, and
"Widget renders after its row" registers each new row a moment late. `window.harness.animations()` returns what the
engine set in motion since the last call (`enter:`, `leave:`, `slide:` with the row's text), which is how the list
animations are checked without watching them. The toolbar's Duration and Animation flow apply to every list on the
page.

`npm run drive` checks the harness the way a person in a hurry would use it: a real (headless) Chrome with a real
mouse and touch screen makes chains of moves 0 to 600 ms apart against a server of 350 and 900 ms, in every kind of
list, picks the same row up again right after dropping it, and reports where a list did not end up as those moves
describe; then it goes through list changes, timing, refused moves, cancel, keyboard, clicks, moves between lists
and touch. It needs the harness server running, Chrome, and Playwright, which is not a dependency of this project:

```bash
NODE_PATH="<a folder with playwright>/node_modules" npm run drive            # everything, about 8 minutes
NODE_PATH="<a folder with playwright>/node_modules" npm run drive -- lists   # or: chains
```

Run it on a quiet machine: the chains with 0 ms between moves are sensitive to load.

`dev/robot.js` is the same hand for a check from the page itself (`await import("./robot.js")`). A browser that is
not on screen gives a page no animation frames; open `harness.html?timers` there (the engine then runs on timers),
or better, use `npm run drive`.

### Release

Set the new version in `package.json` and `src/package.xml`, commit, and push a tag `v<version>`. The GitHub Action
in `.github/workflows/release.yml` builds the `.mpk` and attaches it to a GitHub release, which is what the Mendix
Marketplace imports.

## Licence

Copyright 2026 HomeZero B.V. Licensed under the [Apache License, Version 2.0](LICENSE.txt).
