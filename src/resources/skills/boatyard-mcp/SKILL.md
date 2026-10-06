---
name: boatyard-mcp
description: Create Boatyard projects; list, move and prioritize TwiCC Kanban sessions; switch projects, inspect and update Boatyard panes and mobile viewports, navigate web panes, capture screenshots, click web content, and fill forms through the authenticated local Boatyard MCP server. Use for requested project creation, pane inspection, navigation, clicking, form filling, or TwiCC Kanban management. Do not use for splitting or closing panes because those operations are not exposed yet.
---

# Boatyard MCP

Use the local Boatyard MCP server to inspect the active UI layout, update exact pane entries and mobile viewports, navigate web panes, capture their visible pixels, click their web content, and fill form fields. Treat the MCP results as the source of truth; pane IDs, window IDs, available entries, capabilities, and layout revisions are runtime values.

## Connect the client

Connection is a user-controlled setup step. In Boatyard, open **Global settings > MCP**, enable the server, then install both the skill and MCP connection for the agent. Boatyard creates a separate token for each agent and revokes that token when the connection is uninstalled. Restart the agent after installing or updating the connection.

Never print, log, commit, or include an MCP token in a response. Do not read Boatyard's private settings or an agent configuration file to recover one.

If the one-click connection cannot be used, the user can configure a connection manually with the endpoint and manual bearer token displayed by Boatyard. Use the endpoint shown by Boatyard instead of assuming the default port. Configure it under the server name `boatyard` so this skill and its MCP dependency use the same identifier.

### Manual Codex setup

Make the copied token available in the environment that launches Codex, then register the Streamable HTTP server:

```bash
export BOATYARD_MCP_TOKEN="<copied token>"
codex mcp add boatyard --url "<copied endpoint>" --bearer-token-env-var BOATYARD_MCP_TOKEN
```

### Manual Claude Code setup

Make `BOATYARD_MCP_TOKEN` available whenever Claude Code starts. Preserve the literal environment-variable placeholder in the stored header:

```bash
export BOATYARD_MCP_TOKEN="<copied token>"
claude mcp add --transport http --scope user \
  boatyard "<copied endpoint>" \
  --header 'Authorization: Bearer ${BOATYARD_MCP_TOKEN}'
```

### Manual Hermes setup

Run the interactive connection command and paste the copied token when Hermes asks for the bearer token:

```bash
hermes mcp add boatyard --url "<copied endpoint>" --auth header
```

If the Boatyard tools are unavailable, stop and tell the user that the `boatyard` MCP connection must be enabled, installed, or repaired. Do not work around a missing connection by reading Boatyard's private configuration or token files.

## Create projects

Resolve the exact configuration with `list_windows`, then call `create_project`
with its `contextId`, a nonempty `name` (maximum 160 characters) and a required
relative `directory` inside configured `projectsBasePath` (maximum 2048
characters, 16 child segments, no dot traversal). Missing directories are
created. An existing directory is refused unless `reuse: true` is explicit.
Optional identity fields are canonical `slug` (maximum 80) and `group` (maximum
160). Unknown fields, escaping symlinks and duplicate slug, folded name or
canonical source location are refused before writing.
If the target configuration is ambiguous, ask the user instead of guessing.

Optional `createTwiccProject` accepts `true`, `false` or `"auto"`; omission means
auto and follows availability of the enabled TwiCC plugin. Explicit true cannot
enable a disabled plugin. TwiCC creation requires a name of at most 25 Unicode
code points; longer names are refused before any write. This creates a core
Boatyard project using its domain store, then optionally creates and links a
trusted TwiCC project and propagates trust to its descendants, including
worktrees. This policy implements the human's explicit choice for new project
creation; it does not
change global or provider/session permission settings. A trust update failure
leaves the TwiCC workflow uncertain and must not be retried automatically.
It does not select a window, apply a layout, start a session,
or enable Gmail or another plugin/backend.
Never pass plugin configuration, credentials or terminal commands through this
tool. Creation results contain only bounded identity and acknowledgement fields.

Inspect `status`: `created` confirms the requested workflow; `rejected` means
zero effects; `unknown` with `PROJECT_CREATION_UNCERTAIN` means the domain write
may have changed memory or persisted files; `partial` means directory, Boatyard
or TwiCC effects remain after a later failure. Top-level counts concern Boatyard
creation only; `directory` and `twicc` report independent effects. No cleanup,
rollback or replay occurs. Never retry a partial/unknown receipt or uncertain
transport response automatically. Inspect all state before a manual retry. A
receipt does not prove UI rendering or session readiness. Use `switch_project`
separately only when requested.

## Switch projects

Call `list_windows` to resolve the requested window and project, then call
`switch_project` with its `contextId`, `windowId`, and `projectId`. Use
`projectId: "__global__"` to display Global. This uses the same navigation as the
sidebar and affects only the selected window. The result reports `projectId`
and `view`; it does not wait for embedded web content to finish loading.
Unknown projects are rejected before navigation with `PROJECT_NOT_FOUND`.

## Inspect panes

1. Call `list_windows`. Do not infer a window from the current repository, session, or process.
2. If more than one window is available and the request does not identify one, summarize the choices and ask the user which window to use.
3. Call `get_pane_layout` with the selected `contextId`, `windowId`, and `projectId`.
4. Use the returned pane IDs, selected entries, and `revision` exactly as reported.
5. Call `list_pane_types` with that same context, window, and project plus the target `paneId` before interpreting or changing that pane.

For a read-only request, stop after inspection and report the relevant window, layout, pane, selected entry, and requested capability. Do not call `update_pane`, `navigate_pane`, `click_pane`, or `fill_pane` merely to verify that mutation works.

## Update a pane

Every item shown in Boatyard's pane dropdown is represented as a choice, including dynamic entries such as a particular Pier worktree. Distinguish these fields:

- `choiceId` identifies the exact dropdown entry to select.
- `paneTypeId` identifies only the broader pane family.

Never replace a requested dynamic `choiceId` with its family-level `paneTypeId`.

Before changing a pane:

1. Refresh the layout with `get_pane_layout` if any meaningful time or other operation has passed.
2. Refresh the choices with `list_pane_types` for the exact pane.
3. Resolve the requested entry unambiguously. If several choices could match, show the candidates and ask instead of guessing.
4. Call `update_pane` with the same context, window, and project, the target `paneId`, the exact `choiceId`, and the latest layout `revision` as `expectedRevision`.
5. Report the selected entry and the revision returned by the mutation.

The selected pane reports `viewport: null` when mobile viewport controls are unavailable. A selectable entry's `capabilities.viewport` field tells you whether that entry supports them. To configure a supported entry, pass one or more properties under `viewport`:

- `enabled` toggles the same mobile viewport mode as the pane toolbar button.
- `width` and `height` set its CSS-pixel size and must each be between 160 and 8192. Boatyard constrains the effective size to the visible pane.

When selecting a new entry and configuring its viewport, send `choiceId` and `viewport` in one `update_pane` call. Boatyard validates both before changing the pane and renders it once.

If the server reports `LAYOUT_CHANGED`, fetch the layout and choices again, then reassess the requested target before retrying. If it reports `PANE_TYPE_NOT_AVAILABLE`, refresh the choices and ask the user if the requested entry no longer exists. Do not repeatedly retry stale mutations.

If it reports `PANE_VIEWPORT_NOT_AVAILABLE`, do not substitute another pane entry or simulate mobile mode by resizing the layout.

## Navigate a web pane

The selected pane's `navigation.available` field and each choice's `capabilities.navigation` field indicate web navigation support. Use `navigate_pane` only when the user requests a corresponding browser action:

- `open` requires `url` and uses the same address normalization as the visible URL field.
- `home`, `back`, `forward`, `refresh`, and `hard_refresh` match the visible browser controls.

Pass the same context, window, project, and pane IDs plus the latest layout `revision` as `expectedRevision` so the action cannot target content that was replaced after inspection. If the server reports `PANE_NAVIGATION_NOT_AVAILABLE`, refresh the layout before deciding whether the selected entry changed or the requested history action is unavailable. Do not navigate merely to test a URL or infer page content from a successful navigation.

## Capture a pane

Call `capture_pane` with the selected context, window, project, and pane IDs plus the latest layout `revision` as `expectedRevision`. The result contains PNG image content and metadata describing the captured pane size and rectangle. The image is a composed capture, so native web content such as Pier and URL previews is included.

Omit `rect` to capture the full visible pane. To capture a detail, pass `rect` as `{ x, y, width, height }` in integer CSS pixels. Its origin is the pane's top-left corner, not the window or screen. Boatyard clips the rectangle to the pane and returns the applied rectangle in the result metadata; it rejects a rectangle that does not intersect the pane. Use a full-pane capture first when exact detail coordinates are unknown.

Only the pane displayed in the selected window can be captured. If Boatyard reports `PANE_NOT_VISIBLE`, refresh `list_windows` and `get_pane_layout`; target the active project or ask the user to expose the pane rather than capturing a different one. If it reports `LAYOUT_CHANGED`, refresh the layout before retrying. Do not claim to have seen content unless image content was actually returned.

## Click web content

The selected pane's `interaction.available` and each choice's `capabilities.click`
indicate web clicking support. Inspect the window, layout, and choices first.
Call `click_pane` with the same context, window, project, and pane IDs, the latest
`revision` as `expectedRevision`, and `navigation.currentUrl` as `expectedUrl`.
Provide exactly one target:

- `selector`: a CSS selector matching exactly one visible, enabled, unobstructed
  element in the main document. Selectors do not traverse iframes or shadow roots.
- `point: { x, y }`: non-negative integer CSS pixels relative to the visible
  pane's top-left corner, matching a full `capture_pane` image. For cropped
  captures, add the returned `rect.x` and `rect.y`. Coordinates can target
  content inside iframes or shadow roots.

Both modes send one native left click, including pointer and mouse events.
Coordinates must fall inside the visible native web view; the toolbar and side
panel are excluded. The window and web content receive focus. Hidden, covered,
frozen, or loading web content is rejected. Selectors do not scroll the page.

Capture immediately before choosing coordinates. For point input, pass the full
capture dimensions as optional `expectedPaneSize: { width, height }`; native
input is rejected if the pane size changed. This does not freeze page pixels.
Only click for a requested action; respect its effects, including submissions and destructive buttons.
On `LAYOUT_CHANGED`, `PAGE_CHANGED`, or `PANE_NOT_VISIBLE`, inspect again and
reassess the target. On `ELEMENT_NOT_FOUND`, `ELEMENT_AMBIGUOUS`,
`ELEMENT_NOT_CLICKABLE`, `ELEMENT_OBSCURED`, or `POINT_OUTSIDE_WEB_CONTENT`,
check the target rather than guessing a replacement. `PANE_NOT_READY` means
the page must finish loading. Never blindly retry: `clicked: true` acknowledges
input dispatch, not application success. Capture or use an app-specific read
afterward to verify the effect.

## Fill form fields

Use `fill_pane` for requested form filling. Inspect the window, layout, and
choices first; the selected pane exposes `interaction.available` and its choice
exposes `capabilities.fill`. Pass the same context, window, project, and pane IDs,
the latest revision as `expectedRevision`, and `navigation.currentUrl` as
`expectedUrl`. Supply 1 to 50 entries under `fields` with a unique CSS `selector`
and `value`. Optional `expectedValue` protects a draft from being overwritten.

Use strings for text/password/number/date inputs, textarea, single select option
values, and plain `contenteditable` text; booleans for checkboxes; `true` for
radios; and string arrays for multiple selects. Empty strings and empty arrays
clear supported fields. Selectors address the main document only. Fields must
be rendered, enabled, writable, and supported. File/hidden inputs, buttons,
iframes, shadow roots, and custom editor APIs are not supported by this tool.
It neither scrolls nor focuses the pane.

The entire batch is validated before writing. Later application handlers may
change fields or navigate; filling stops at the first failure and returns
partial results plus `NOT_ATTEMPTED` for remaining fields. Inspect
`allSucceeded`, `filledCount`, and each result before continuing. On
`FIELD_CHANGED`, preserve the newer draft and reassess the requested value.
Never blindly retry partial fills. Values are not echoed in results.

Version 2 receipts keep `attempted` and `applied` facts separately from final
`filled` observation. `applied:true` confirms the requested value immediately
after its setter/handlers; `applied:null` is uncertain. An acknowledged write can
therefore have `filled:false` with `PAGE_CHANGED` after a search updates the URL.
Counts are `attemptedCount`/`appliedCount`; later fields remain `NOT_ATTEMPTED`.
Gateway callers can request `receiptVersion:2`. Never replay on page change or
infer that zero final-observed fields means no values were applied.

Gateway callers should set `rejectCredentialFields: true` and require
`expectedValue` for every field. The native guard rejects password and marked
username/OTP fields, plus fields in password-containing forms, before reading
values or writing. It rechecks during execution. Acknowledgements include
`credentialPolicyApplied`; use saved local autofill for credentials. Unmarked
login fields and custom widgets are not universally identifiable.

Native setters and programmatic field events notify the application, including
checkbox/radio activation. Boatyard does not submit the form or press Enter;
page handlers can still autosave. Verify application state afterward. A separate
`click_pane` on a submit control requires authorization for that action.

## Autofill saved local credentials

Use `set_pane_autofill` to enable or disable the existing local credential
autofill in an inspected visible web pane. Pass the exact context, window,
project and pane IDs, latest `expectedRevision`, `navigation.currentUrl` as
`expectedUrl`, and boolean `enabled`. This is a toolbar action, not a web
coordinate click. Enabling requires the local password manager already enabled
with encryption available; do not change settings or permissions as a workaround.

Never supply, request, print or inspect login/password values through MCP. Saved
credentials stay in Boatyard's local main/preload path. Enter missing credentials
locally using the existing credential flow. MCP autofill preserves field drafts,
binds the request to the inspected URL, and disarms on navigation to another URL.
It may wait for a login form or saved credential. Disabling does not clear fields.

A receipt with `requested:true` and `fieldsFilledVerified:false` proves only
arming/disarming. It does not prove filling or successful authentication. The
command does not submit or press Enter, but page field handlers may have effects.
Do not retry an uncertain request automatically or capture sensitive fields to
prove success.

## Respect the current boundary

The current MCP can list windows, switch projects, inspect layouts, enumerate choices, update an existing pane's entry and mobile viewport, navigate and click its web content, fill form fields, toggle saved local credential autofill, and capture a visible pane. It cannot create a split, close a pane, start a process, or inspect the rendered page as structured DOM/content. State that limitation when one of those operations is required; do not simulate success through unrelated UI or filesystem actions.


## Manage TwiCC Kanban sessions

The enabled TwiCC plugin contributes these tools to the **Boatyard** MCP server:

- `boatyard.twicc.list_sessions`: `contextId`, `projectId`, optional `lane`.
- `boatyard.twicc.move_sessions`: `contextId`, `projectId`, `sessionIds`, `lane`,
  optional `expectedBoardToken` and `maxAffectedSessions`.
- `boatyard.twicc.reorder_sessions`: `contextId`, `projectId`, `sessionIds`,
  `lane`, `position` and, for `before`/`after`, `anchorSessionId`; optional
  `expectedLaneToken` and `maxAffectedSessions`.

Use `list_windows` to discover the configuration and Boatyard project IDs. These
operations work without opening a Kanban pane. Tool names may be normalized by
the MCP client; discover them from the server rather than guessing a prefix.
Lanes are `in_progress`, `backlog` and `done`. `processState` describes agent
activity independently of the lane. Listing includes visible, unarchived sessions
in the same order as the Kanban and never writes annotations.

List before choosing session IDs. Check `guard.mode: "observed_snapshot"`,
`guard.version: 1`, `guard.atomic: false` and `guard.complete: true`. Pass
`guard.boardToken` as `expectedBoardToken` for a move, or the `guard.laneToken`
from a lane-filtered list as `expectedLaneToken` for reorder. Tokens are opaque
`obs1:` SHA-256 state fingerprints, not backend revisions or credentials. Set an
explicit `maxAffectedSessions` appropriate to the user's requested scope; reorder
targets every visible session in the lane, not only the selected cards. Refuse
integrations that require guards if the upstream tool does not support them;
never strip these fields to make a request succeed.

Move only the sessions requested by the user.
For visual priority, use `position: "first"` or `"last"`, or `"before"`/`"after"`
with another session in the same lane as the anchor. Selected sessions must
already be in that lane; move them first if needed. The input order of multiple
selected sessions is preserved. Do not invent IDs or numeric order values.

A move to Done does not archive or stop an agent. Guard/limit/scope refusals have
`status: "rejected"`, an explicit `code` and `attemptedCount: 0`. Once a plan
exists, `plannedSessionIds` and `results` cover every planned target in order.
Guarded moves and all reorders stop at the first unconfirmed update; remaining
targets are `not_attempted`. Check `allSucceeded`, `attemptedCount`,
`confirmedCount` and every per-target status. `updated`/`noop` are submitted TwiCC
acknowledgements and count as both attempted and confirmed. `rejected` is a
definite upstream refusal; `unknown` may already have committed. There is no
local skipped-write no-op. Receipts report `atomic: false` and
`finalState: "not_observed"`; keep a failed post-read separate from write receipts.

Do not automatically replay or roll back a partial or uncertain operation.
Inspect a fresh board and obtain a new user decision when needed. The queue
only serializes this configuration's MCP writers; Boatyard UI and independent
TwiCC clients can race after validation. Newly hidden/archived targets are not
protected at commit time, and TwiCC's unrelated-annotation lost-update risk
remains. Never describe this as an atomic update or hard external-writer CAS.

## Open a TwiCC session by ID

When asked to display a TwiCC session, inspect the window, layout and pane choices
as above. Select the TwiCC conversation choice with `update_pane` if needed, then
call `open_twicc_session` with `contextId`, `windowId`, `projectId`, `paneId`, the
latest `expectedRevision`, and the full `sessionId`. It resolves the session's
actual TwiCC project and navigates only an already-selected TwiCC conversation
pane. Do not guess a project URL from the current repository.

The result includes session title, process state, URL and navigation acknowledgement.
`requiresUserAction` means the user should respond in TwiCC; never approve a prompt
or send a message merely to display a session. The pane itself shows the transcript
and live updates. Navigation acknowledgement does not prove rendering or web login.
For lookup only, use the plugin's read-only `boatyard.twicc.resolve_session` tool.

Handle `TWICC_SESSION_NOT_FOUND`, `TWICC_PERMISSION_DENIED`, `TWICC_UNAVAILABLE` and
`TWICC_PLUGIN_UNAVAILABLE` explicitly: check ID, permissions, service/settings or
plugin availability respectively. Do not retry against another TwiCC instance.
Refresh the layout after `LAYOUT_CHANGED`; select the appropriate pane after
`PANE_TYPE_NOT_AVAILABLE`. If MCP is unavailable, explain how to enable/repair its
connection and offer manual navigation through the TwiCC pane. If TwiCC is also
unavailable, other Boatyard panes remain usable. Do not extract tokens from files.
