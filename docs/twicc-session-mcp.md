# Open a TwiCC session through Boatyard MCP

The optional TwiCC plugin uses the existing TwiCC conversation pane to display
session titles, messages, live activity and interactive prompts. No additional
conversation renderer or TwiCC installation is required by other Boatyard panes.

## Setup and usage

1. Enable the TwiCC plugin and configure its base URL and API token in Boatyard's
   global plugin settings. Configure the project's TwiCC URL so its conversation
   pane is available. Without an explicit base URL, session lookup uses the local
   `twicc` CLI and navigation uses `http://localhost:3500`.
2. Enable MCP in **Global settings > MCP** and install the agent connection.
   Restart the agent to refresh its tools if necessary.
3. Call `list_windows`, then `get_pane_layout` and `list_pane_types` for the chosen
   window, project and pane. Choose the window explicitly when several are open.
4. If necessary, use `update_pane` with the exact TwiCC conversation `choiceId`
   returned by the catalog. This intentionally replaces that pane's selection.
5. Call `open_twicc_session` with the latest layout revision:

```json
{
  "contextId": "context-from-list-windows",
  "windowId": "window-from-list-windows",
  "projectId": "boatyard-project-id",
  "paneId": "pane-from-layout",
  "expectedRevision": "revision-from-layout-or-update",
  "sessionId": "full-twicc-session-id"
}
```

The tool resolves the session's actual TwiCC project, including hidden or archived
sessions accessible to the configured account. It returns the title, URL, process
state, `requiresUserAction`, any state lookup warning, and navigation acknowledgement.
The pane loads TwiCC's full conversation with its existing browser controls.
`boatyard.twicc.resolve_session` provides the same lookup without navigating.

## TwiCC version compatibility

Boatyard supports both the legacy CLI/RPC responses and TwiCC's October 1, 2026
API contract. No TwiCC upgrade or compatibility setting is required for this
migration. Project and session lists follow pagination; the board retains the
full session metadata used for activity ordering and lane inference.

Recent TwiCC versions include process state in session responses. Older versions
continue using the legacy process commands. An explicit unsupported option can
trigger a retry against the same instance; connection and authentication failures
never redirect these reads to a different local instance.

TwiCC's new active-session listing can briefly omit a newly started session until
its session row and first user message are indexed. Status summaries, resource
attribution and the restart readiness check share that upstream visibility limit;
a readiness result is a snapshot, not a guarantee that no process is starting.
Opening a known session reads its individual process state as soon as its row is
available, including hidden and archived sessions.

## Errors and recovery

- `INVALID_SESSION_ID`: pass an ID, not a URL or command-line option.
- `TWICC_SESSION_NOT_FOUND`: verify the full ID and configured TwiCC instance.
- `TWICC_PERMISSION_DENIED`: check the API token and session permissions in TwiCC.
- `TWICC_UNAVAILABLE`: start/reconnect TwiCC or fix its URL; then retry. A configured
  server failure never falls back silently to a different local instance.
- `TWICC_INVALID_RESPONSE` / `TWICC_INVALID_CONFIGURATION`: check server compatibility
  and use an HTTP(S) base URL without embedded credentials.
- `TWICC_PLUGIN_UNAVAILABLE`: enable the optional plugin in the selected configuration.
- `PANE_TYPE_NOT_AVAILABLE`: select the TwiCC conversation pane using the catalog.
- `LAYOUT_CHANGED`: refresh layout and choices before retrying; do not reuse a stale
  revision. Invalid window, project and pane targets use the standard MCP errors.

When `requiresUserAction` is true, respond inside the TwiCC conversation. The tool
never approves permissions or submits messages. API authentication and embedded web
login are separate: a successful lookup may still require signing in in the pane.
An unavailable process lookup returns `unknown` with a warning rather than claiming
that the session is idle.

If Boatyard MCP is disabled, disconnected or unauthorized, this tool cannot run.
Enable/repair the connection through Global settings; do not extract private tokens
from files. As a manual fallback, select the TwiCC pane and open the session through
TwiCC's UI (or its known conversation URL). If TwiCC itself is unavailable, use
another Boatyard pane while restoring the service. No automatic installation or
service restart is performed.

Navigation acknowledgement confirms that Boatyard accepted the navigation, not
that the page rendered or web authentication succeeded. Messages and subsequent
live updates are displayed by TwiCC, not copied into the MCP result. Existing pane
history controls provide back, forward, refresh and home. This flow does not create
splits or switch Boatyard projects automatically; existing cross-project TwiCC
navigation behavior remains in effect.
