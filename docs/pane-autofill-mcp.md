# Local credential autofill through MCP

`set_pane_autofill` toggles the existing pane toolbar's credential autofill. It
does not accept or return usernames, passwords, or vault records. Inspect
`list_windows`, `get_pane_layout`, and `list_pane_types` first, then pass the
exact context, window, project and pane IDs, latest `expectedRevision`,
`navigation.currentUrl` as `expectedUrl`, and boolean `enabled`.

Enabling requires the local password manager already to be enabled and encryption
available. This tool never changes those settings. Missing saved credentials must
be entered locally through Boatyard's existing credential flow; do not put them
in MCP messages. Disabling disarms autofill; it does not clear previously filled
fields.

The target must be attached, visible, uncovered, unfrozen and not loading. Native
URL and renderer revision checks are repeated after asynchronous target lookup.
The command reuses the existing main/preload credential path instead of exporting
credentials to the agent or executing a caller-provided script. MCP arming is
bound to the exact inspected URL. The guard survives DOM readiness, and a
navigation to another URL disarms it. Draft fields, field replacement and page
changes during credential lookup stop the scoped fill. Cancellation also stops
an in-flight lookup. The legacy manually operated toolbar remains available.

Autofill may wait for the existing login form or a saved credential. The existing
field discovery addresses the main document only, and setters emit application
field events. Boatyard does not submit or press Enter; page handlers may still
cause site-specific effects. No explicit login result is verified.

The receipt contains target IDs and revision plus `requested:true`,
`requestedEnabled` and `fieldsFilledVerified:false`. These acknowledge an
arming/disarming request, not actual field filling or authentication. Never retry
an uncertain action automatically, and never inspect credential-bearing fields
to prove success.

Build and gracefully restart the whole Boatyard application to load the new MCP
handler and preload. Refresh/reconnect the MCP client afterwards. A pane reload
alone does not replace the main-process handler. Preserve embedded page drafts
before an approved application restart.
