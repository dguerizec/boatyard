---
name: boatyard-mcp
description: Inspect Boatyard windows and pane layouts, enumerate every pane dropdown entry including dynamic subtypes, and assign an exact entry to an existing pane through the authenticated local Boatyard MCP server. Use when a user asks to inspect, explain, or change panes in a running Boatyard instance. Do not use for splitting, closing, or capturing panes because those operations are not exposed yet.
---

# Boatyard MCP

Use the local Boatyard MCP server to inspect the active UI layout and select exact pane entries. Treat the MCP results as the source of truth; pane IDs, window IDs, available entries, and layout revisions are runtime values.

## Connect the client

Connection is a user-controlled setup step. In Boatyard, open **Global settings > MCP**, enable the server, and copy the displayed endpoint and bearer token. Never print, log, commit, or include the token in a response.

Use the endpoint shown by Boatyard instead of assuming the default port. Configure the connection under the server name `boatyard` so this skill and the MCP dependency use the same identifier.

### Codex

Make the copied token available in the environment that launches Codex, then register the Streamable HTTP server:

```bash
export BOATYARD_MCP_TOKEN="<copied token>"
codex mcp add boatyard --url "<copied endpoint>" --bearer-token-env-var BOATYARD_MCP_TOKEN
```

### Claude Code

Make `BOATYARD_MCP_TOKEN` available whenever Claude Code starts. Preserve the literal environment-variable placeholder in the stored header:

```bash
export BOATYARD_MCP_TOKEN="<copied token>"
claude mcp add --transport http --scope user \
  --header 'Authorization: Bearer ${BOATYARD_MCP_TOKEN}' \
  boatyard "<copied endpoint>"
```

### Hermes

Run the interactive connection command and paste the copied token when Hermes asks for the bearer token:

```bash
hermes mcp add boatyard --url "<copied endpoint>" --auth header
```

If the Boatyard tools are unavailable, stop and tell the user that the `boatyard` MCP connection must be enabled or repaired. Do not work around a missing connection by reading Boatyard's private configuration or token files.

## Inspect panes

1. Call `list_windows`. Do not infer a window from the current repository, session, or process.
2. If more than one window is available and the request does not identify one, summarize the choices and ask the user which window to use.
3. Call `get_pane_layout` with the selected `windowId`.
4. Use the returned pane IDs, selected entries, and `revision` exactly as reported.
5. Call `list_pane_types` with both `windowId` and the target `paneId` before interpreting or changing that pane.

For a read-only request, stop after inspection and report the relevant window, layout, pane, and selected entry. Do not call `assign_pane_type` merely to verify that assignment works.

## Select a pane entry

Every item shown in Boatyard's pane dropdown is represented as a choice, including dynamic entries such as a particular Pier worktree. Distinguish these fields:

- `choiceId` identifies the exact dropdown entry to select.
- `paneTypeId` identifies only the broader pane family.

Never replace a requested dynamic `choiceId` with its family-level `paneTypeId`.

Before changing a pane:

1. Refresh the layout with `get_pane_layout` if any meaningful time or other operation has passed.
2. Refresh the choices with `list_pane_types` for the exact pane.
3. Resolve the requested entry unambiguously. If several choices could match, show the candidates and ask instead of guessing.
4. Call `assign_pane_type` with `windowId`, `paneId`, the exact `choiceId`, and the latest layout `revision` as `expectedRevision`.
5. Report the selected entry and the revision returned by the mutation.

If the server reports `LAYOUT_CHANGED`, fetch the layout and choices again, then reassess the requested target before retrying. If it reports `PANE_TYPE_NOT_AVAILABLE`, refresh the choices and ask the user if the requested entry no longer exists. Do not repeatedly retry stale mutations.

## Respect the current boundary

The current MCP can list windows, inspect layouts, enumerate choices, and assign an entry to an existing pane. It cannot create a split, close a pane, start a process, or capture a screenshot. State that limitation when one of those operations is required; do not simulate success through unrelated UI or filesystem actions.
