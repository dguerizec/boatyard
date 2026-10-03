# Click web content through Boatyard MCP

`click_pane` sends one native left click into an existing visible web pane,
including pointer, mouse, and trusted click events. It focuses the target window
and web content. Other panes are unaffected.

1. Resolve the window and project with `list_windows`.
2. Read `get_pane_layout` and `list_pane_types` for the target pane. Web content
   exposes `interaction.available` and `capabilities.click`.
3. Capture the pane with `capture_pane` if choosing a position visually.
4. Call `click_pane` with `contextId`, `windowId`, `projectId`, `paneId`, the
   inspected `revision` as `expectedRevision`, and the pane's
   `navigation.currentUrl` as `expectedUrl`.
5. Supply either `selector: "#save-button"` or `point: { "x": 120, "y": 80 }`.
6. Inspect the page afterward to confirm the requested effect.

Coordinates use integer CSS pixels relative to the visible pane's top-left
corner, matching a full pane capture. Add the returned rectangle's offsets
when using a cropped capture. Native web view bounds exclude the pane toolbar
and any side panel. Positions inside iframes and shadow roots are supported.

A selector must match exactly one visible, enabled, unobstructed element in the
main document. It does not traverse iframes or shadow roots or scroll the page.
The native click targets the center of the element's visible rectangle and
accounts for page zoom and clipped mobile viewports.

Boatyard validates the pane again after resolving the selector, checks the
actual native web content URL, and rejects hidden, covered, frozen, loading, or
replaced views. A layout change returns `LAYOUT_CHANGED`, a URL change returns
`PAGE_CHANGED`, and an unavailable view returns `PANE_NOT_VISIBLE` or
`PANE_CLICK_NOT_AVAILABLE`. Invalid positions return
`POINT_OUTSIDE_WEB_CONTENT`. Selector errors return `INVALID_SELECTOR`,
`ELEMENT_NOT_FOUND`, `ELEMENT_AMBIGUOUS`, `ELEMENT_NOT_CLICKABLE`, or
`ELEMENT_OBSCURED`.

`clicked: true` acknowledges input dispatch, not application success. Page
content can change without a URL or layout change; capture immediately before
clicking and avoid blind retries. Clicking can submit forms or trigger other
page actions, just as a manual click would.

Build and restart Boatyard to load the new tool. Refresh the MCP connection or
restart the agent if it caches the tool list. Update the installed Boatyard MCP
skill from Global settings > MCP to receive the clicking instructions.

For coordinate clicks, optional `expectedPaneSize: { width, height }` binds the
input to the full captured pane dimensions. Both dimensions must be positive
integers. A mismatch returns `LAYOUT_CHANGED` before native mouse input; a
successful guarded receipt includes `captureSizeVerified: true`. This does not
freeze pixels, DOM, scrolling or zoom between capture and dispatch. Refresh the
capture immediately before choosing coordinates. The option cannot be used with
a selector and preserves the legacy contract when omitted.
