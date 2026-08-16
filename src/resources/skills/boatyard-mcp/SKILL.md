---
name: boatyard-mcp
description: Inspect Boatyard windows and pane layouts, enumerate every pane dropdown entry including dynamic subtypes, update pane content and mobile viewport settings, and navigate web panes through the authenticated local Boatyard MCP server. Use when a user asks to inspect, explain, or change panes in a running Boatyard instance. Do not use for splitting, closing, or capturing panes because those operations are not exposed yet.
---

# Boatyard MCP

Use the local Boatyard MCP server to inspect the active UI layout, update exact pane entries and mobile viewports, and navigate web panes. Treat the MCP results as the source of truth; pane IDs, window IDs, available entries, capabilities, and layout revisions are runtime values.

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

## Inspect panes

1. Call `list_windows`. Do not infer a window from the current repository, session, or process.
2. If more than one window is available and the request does not identify one, summarize the choices and ask the user which window to use.
3. Call `get_pane_layout` with the selected `contextId`, `windowId`, and `projectId`.
4. Use the returned pane IDs, selected entries, and `revision` exactly as reported.
5. Call `list_pane_types` with that same context, window, and project plus the target `paneId` before interpreting or changing that pane.

For a read-only request, stop after inspection and report the relevant window, layout, pane, selected entry, and requested capability. Do not call `update_pane` or `navigate_pane` merely to verify that mutation works.

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

## Respect the current boundary

The current MCP can list windows, inspect layouts, enumerate choices, update an existing pane's entry and mobile viewport, and navigate its web content. It cannot create a split, close a pane, start a process, inspect rendered page content, or capture a screenshot. State that limitation when one of those operations is required; do not simulate success through unrelated UI or filesystem actions.
