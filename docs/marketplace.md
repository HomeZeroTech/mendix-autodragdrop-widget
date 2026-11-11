# Marketplace listing

The texts and settings for the Mendix Marketplace upload form (Add Content). Paste each block into the field named
above it. Keep this file in step with the listing when a new version is published.

## Upload Component

| Field | Value |
|---|---|
| Component Name | Drag and Drop |
| Component Type | Widget |
| Visibility | Public |
| Component Source | GitHub Link: the release `v1.0.0` of https://github.com/HomeZeroTech/mendix-dragdrop-widget |
| Studio Pro Version | 11.12.6 |
| Compatible with Mendix React Client | Yes |
| Release Version | 1.0.0 |

**Release Notes**

> First release. Drag-and-drop reordering for Gallery, List view and Data grid 2 rows, with mouse, touch and
> keyboard. Vertical and horizontal lists, wrapping grids, grouped lists and boards with lanes.

## General Information

**Component Tagline**

> Reorder the rows of a list you already have by dragging: mouse, touch and keyboard.

**About**

> Drag and Drop adds reordering to a list that already exists in your app. You do not rebuild the list or hand its
> data to the widget: you place the widget in the row template of a Gallery, List view or Data grid 2. It draws a
> six-dot grip there and makes that row draggable among the rows of its list.
>
> When a row is dropped, the widget runs your microflow or nanoflow with the row as context and tells it where the
> row went: a sort value between the new neighbours, the new position, and the keys of the neighbours. Your flow
> stores the order; the widget shows the move at once and slides the row back if the flow refuses it.
>
> What it handles:
>
> - Vertical lists, horizontal lists (tabs, chips) and wrapping grids.
> - Data grid 2 rows.
> - Grouped lists: a group moves as a block, rows move within and between groups.
> - Boards with lanes, including dropping into an empty lane.
> - Mouse, touch (a swipe still scrolls) and keyboard (Space to pick up, arrow keys to move, Space to drop).
> - Several moves in quick succession without waiting for the server.
> - Animation when the list changes for any other reason: a new row fades in, a deleted row fades away.
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

In `docs/media/`, taken from the demo app: the cover image `cover-600x240.png`, six screenshots of 1600x900
(`01-overview.png` to `06-board-dragging.png`) and a recording `demo.webm` (upload it to YouTube if you want to fill
the YouTube Video field).

**Documentation**

> ### Typical usage scenario
>
> You have a list with a sort order that users set themselves: statuses, steps of a process, lines of a quote,
> cards on a board. Today they use up and down buttons, or cannot reorder at all. Place this widget in the row and
> they drag the rows instead.
>
> ### Features and limitations
>
> Features
>
> - Works inside the list widgets you already use: Gallery, List view, Data grid 2.
> - Whole row or six dots only as the grip; buttons, links and inputs in the row keep working.
> - Mouse, touch and keyboard.
> - Vertical, horizontal, wrapping grid, grouped lists, boards with lanes and empty lanes.
> - The drop action gets a sort value between the neighbours (for a Decimal sort attribute) and the new position
>   (for an Integer one).
> - The row shows at its new place at once; a refused move slides back.
> - Animates list changes (add, delete, move) and respects the "reduce motion" setting of the user's system.
> - Colours through CSS custom properties.
>
> Limitations
>
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
> 1. Put the widget in the row template of your list, where the six dots should appear.
> 2. Set **Sort value** to the row's sort attribute, e.g. `$currentObject/Sequence`.
> 3. Set **On drop** to a microflow with the row as parameter and the variable `newSortValue`. In it: set the sort
>    attribute to `newSortValue`, retrieve the rows in order, renumber them 1..n in a loop, and commit with refresh
>    in client.
>
> For rows that move between lists (lanes, groups), add a second widget with Role = Drop zone inside each lane, give
> it a Zone key and name the lane element with a CSS selector. The drop action then also gets the key of the zone
> the row went to.
>
> All settings, the action variables and styling hooks are described in the README on GitHub.
>
> ### Known bugs
>
> None known. Please report issues on GitHub.

**Resources**

- GitHub: https://github.com/HomeZeroTech/mendix-dragdrop-widget
- Issues: https://github.com/HomeZeroTech/mendix-dragdrop-widget/issues
- Demo app: https://autodraganddrop-sandbox.mxapps.io/
