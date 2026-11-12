# Marketplace listing

The texts and settings for the Mendix Marketplace upload form (Add Content). Paste each block into the field named
above it. Keep this file in step with the listing when a new version is published.

## Upload Component

| Field | Value |
|---|---|
| Component Name | Auto Drag and Drop |
| Component Type | Widget |
| Visibility | Public |
| Component Source | GitHub Link: the release `v1.0.0` of https://github.com/HomeZeroTech/mendix-dragdrop-widget |
| Studio Pro Version | 11.12.6 |
| Compatible with Mendix React Client | Yes |
| Release Version | 1.0.0 |

**Release Notes**

> First release. Drag-and-drop reordering for Gallery, List view and Data grid 2 rows, with mouse, touch and
> keyboard. No microflow needed: pick the sort attribute and set On drop to Save changes.

## General Information

**Component Tagline**

> Drag to reorder the rows of a list you already have. No microflow: pick the sort attribute and you are done.

**About**

> Auto Drag and Drop adds reordering to a list that already exists in your app. You do not rebuild the list or hand
> its data to the widget: you place the widget in the row of a Gallery, List view or Data grid 2. It draws a
> six-dot grip there and makes that row draggable among the rows of its list.
>
> Three steps, no microflow:
>
> 1. Place the widget in the row.
> 2. Pick the attribute that holds the order.
> 3. Set On drop to Save changes.
>
> When a row is dropped, the widget gives the rows that changed place each other's numbers and saves them. The row
> shows at its new place at once.
>
> What it handles:
>
> - Vertical lists, horizontal lists (tabs, chips) and wrapping grids.
> - Data grid 2 rows.
> - Mouse, touch (a swipe still scrolls) and keyboard (Space to pick up, arrow keys to move, Space to drop).
> - Several moves in quick succession without waiting for the server.
> - Animation when the list changes for any other reason: a new row fades in, a deleted row fades away.
>
> With the advanced settings switched on:
>
> - Your own drop logic: a microflow or nanoflow that gets the new position.
> - Grouped lists: a group moves as a block, rows move within and between groups.
> - Boards with lanes, including dropping into an empty lane.
>
> It has no dependencies and does not use the browser's built-in drag-and-drop, so it behaves the same on a phone
> as on a desktop.

Industry: (none specific). Category: User Interface.

## Support & Licensing

| Field | Value |
|---|---|
| License Type | Apache 2.0 |
| Website | https://homezero.nl |
| Contact Email | emiel@homezero.nl |
| Development Team | emiel@homezero.nl |

## Media & Documentation

In `docs/media/`, taken from the demo app and from Studio Pro:

- `cover-600x240.png`: the cover image.
- `01-three-steps.png`: how to set it up in a Gallery, in three steps. Upload this one first.
- `02-data-grid-and-more.png`: the widget in a Data grid 2, and what the advanced settings add.
- `03-list-dragging.png`, `04-groups-and-board.png`, `05-board-dragging.png`: the demo app, a row or card in
  the air.
- `demo.webm`: a recording of all demos (upload it to YouTube if you want to fill the YouTube Video field).

**Documentation**

> ### Typical usage scenario
>
> You have a list with an order that users set themselves: statuses, steps of a process, lines of a quote, cards on
> a board. Today they use up and down buttons, or cannot reorder at all. Place this widget in the row and they drag
> the rows instead.
>
> ### Features and limitations
>
> Features
>
> - Works inside the list widgets you already use: Gallery, List view, Data grid 2.
> - No microflow needed: the widget swaps the numbers of the rows that changed place, and Save changes stores them.
> - Works with Integer, Long and Decimal sort attributes, with paged lists and with numbers that have gaps.
> - Whole row or six dots only as the grip; buttons, links and inputs in the row keep working.
> - Mouse, touch and keyboard.
> - The row shows at its new place at once; a move that cannot be saved slides back.
> - Animates list changes (add, delete, move) and respects the "reduce motion" setting of the user's system.
> - Advanced: your own drop logic, grouped lists, boards with lanes and empty lanes.
> - Colours through CSS custom properties.
>
> Limitations
>
> - The user needs write access to the sort attribute. Without it the rows cannot be dragged (the dots are greyed
>   out and a tooltip says why). Use your own drop logic with a microflow when users may reorder but not write.
> - Rows that move between lists (lanes, groups) need your own drop logic.
> - Keyboard moves a row within its own list only, not to another lane or group.
> - A screen reader hears the handle's label, but no position while the row moves, and there is no click-only
>   alternative to dragging. The widget alone does not make a list meet WCAG; keep move buttons where you need that.
> - No dragging of several rows at once, no trees (dropping onto a row), no dragging from a palette.
> - Rows in the same list that do not have the widget do not make room during a drag.
> - Web only (React client), Studio Pro 11.12 or later.
>
> ### Dependencies
>
> None. Studio Pro 11.12 or later.
>
> ### Installation
>
> Download the widget from the Marketplace into your app.
>
> ### Configuration
>
> Your rows need an Integer, Long or Decimal attribute that holds their order, and the list is sorted by it.
>
> 1. Put the widget in the row: the template of a Gallery or List view, or a custom-content column of a
>    Data grid 2.
> 2. Set **Sort attribute** to that attribute.
> 3. On the Events tab, set **On drop** to **Save changes** (Close page: No).
>
> In a List view, also set the List view's own Editable setting to Yes. A Gallery and a Data grid 2 need
> nothing more.
>
> The user's role needs write access to the sort attribute. If On drop is left empty nothing is saved: the row
> slides back and the browser's console says why.
>
> For your own drop logic, groups and boards, set **Show advanced settings** to Yes. All settings, the action
> variables and the styling hooks are described in the README on GitHub.
>
> ### Known bugs
>
> None known. Please report issues on GitHub.

**Resources**

- GitHub: https://github.com/HomeZeroTech/mendix-dragdrop-widget
- Issues: https://github.com/HomeZeroTech/mendix-dragdrop-widget/issues
- Demo app: https://autodraganddrop-sandbox.mxapps.io/
