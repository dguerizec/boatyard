# Observed Kanban guards and bounded mutation receipts

The TwiCC plugin provides `boatyard.twicc.list_sessions`, `move_sessions` and
`reorder_sessions`. The server injects the required `contextId`; `projectId` is
always a Boatyard project ID discovered with `list_windows`. Canonical lanes are
`in_progress`, `backlog` and `done`.

These operations use the configured public TwiCC RPC or the existing local CLI.
They do not modify TwiCC itself, stop agents, archive sessions, change permissions,
or add browser capabilities.

## Inputs

All input objects are strict. Existing required fields remain unchanged.

| Tool | Required plugin fields | Optional plugin fields |
| --- | --- | --- |
| `list_sessions` | `projectId` | `lane` |
| `move_sessions` | `projectId`, `sessionIds`, `lane` | `expectedBoardToken`, `maxAffectedSessions` |
| `reorder_sessions` | `projectId`, `sessionIds`, `lane`, `position` | `anchorSessionId`, `expectedLaneToken`, `maxAffectedSessions` |

`projectId` and session IDs are trimmed nonempty strings. `sessionIds` contains
1–100 unique IDs. `position` is `first`, `last`, `before` or `after`;
`anchorSessionId` is required only for `before`/`after` and must identify another
visible session in the same lane. Selected reorder sessions must already be in
that lane. Invalid wire inputs fail MCP schema validation before invocation;
a defensive direct invocation returns `INVALID_INPUT` instead.

Both tokens match `^obs1:[a-f0-9]{64}$`. Pass them unchanged from a successful
list. `maxAffectedSessions` is an optional integer in
`[1, 9007199254740991]`; a gateway can enforce its own smaller policy such as 20.
Supplying either the token or the bound enables stop-on-failure behavior for a
move. Reorder always stops on its first failure. Legacy unguarded moves continue
attempting their explicit targets after a failure.

## Listing and tokens

A successful list retains `sessions` and `total`, and adds:

```json
{
  "guard": {
    "mode": "observed_snapshot",
    "version": 1,
    "atomic": false,
    "complete": true,
    "boardToken": "obs1:<64 lowercase hex characters>",
    "laneToken": "obs1:<64 lowercase hex characters>"
  }
}
```

`laneToken` is present only when `lane` filters the list. `boardToken` always
covers the full board. No list persists inferred lanes or other annotations.
Hidden and archived rows are independently excluded when their flags are present;
older responses without those flags rely on TwiCC's listing defaults.

Each snapshot collects the project catalog, all session pages for the resolved
project/worktree scope, and process information used by the existing lane rules.
A second complete collection must have the same board token. Duplicate IDs,
invalid scope/visibility metadata, malformed pagination, contradictory totals,
truncated responses and observed collection changes fail closed. A legacy list
without `--full` is read only after an explicit unsupported-option response,
against the same configured instance. This is a read compatibility fallback,
never a mutation replay.

`complete: true` means all advertised pages were collected, validated and matched
a second observation. Offset pagination and matching observations do not prove
an atomic backend snapshot or detect every possible intervening change.

### Version 1 fingerprint encoding

Tokens are `obs1:` followed by lowercase SHA-256 hex of UTF-8 JSON. Recursively
normalize object keys with
`Object.fromEntries(Object.keys(value).sort().map(key => [key, normalize(value[key])]))`,
preserve array order, then encode with JavaScript `JSON.stringify` (including its
standard integer-key enumeration). This differs from the Python ASCII-escaped
schema digest used by Harborcall; both kinds of digest are exported separately.
The hashed JSON value is:

```text
["boatyard.twicc.kanban", 1, scope, view, projection]

scope = [transport, baseUrl, boatyardProjectId, projectReference,
         resolvedTwiccProjectId, scopeProjects]
transport = "rpc" or "local_cli"
baseUrl = configured base URL with trailing slashes removed,
          or "http://localhost:3500" when absent
scopeProjects = [[projectId, worktreeOfOrNull], ...], sorted by projectId.localeCompare
view = "board" or the canonical lane ID
projection = [sessionProjection, ...], in effective Kanban order
sessionProjection = [sessionId, twiccProjectId, effectiveLane, normalizedOrderOrNull,
                     rawAnnotations, createdAtOrNull, spawnedByOrNull]
rawAnnotations = [rawLane, rawOrder, rawOrigin]
rawField = [nestedKeyPresent, nestedValueOrNull,
            literalDottedKeyPresent, literalDottedValueOrNull]
```

The three raw fields correspond to `sessionFlowLane`, `sessionFlowOrder` and
`sessionFlowOrigin` in the `boatyard` annotation namespace. Lane tokens filter
`projection` to that lane, but retain the complete scope. An empty worktree's
addition/removal therefore changes the token. Unrelated annotation keys, titles,
costs, context usage and activity timestamps are excluded. Process/open-run and
pin state affect the token through the existing effective lane projection.
Creation time, origin and spawn relationships support automatic ordering.

The instance binding identifies the configured endpoint/transport, not an
attested server incarnation. Local CLI mode relies on the existing local CLI
instance selection. Tokens are unkeyed state fingerprints, not credentials or
backend revisions. A change followed by a return to the same state can reproduce
the token. Clients should treat tokens as opaque, not reconstruct or authenticate
anything with them.

## Mutation planning

Inside this configuration's MCP mutation queue, the operation captures connection
settings, reads a checked snapshot, validates the expected token, all selected
IDs and any anchor, and calculates an immutable complete write plan. The bound is
checked before the first annotation update. The captured configuration cannot
retarget the middle of the operation.

Move targets exactly the selected IDs. Reorder targets **every currently visible
session in the requested lane**, even if only one selected card changes priority.
Each reorder update writes both lane and zero-based order. The planned ID set and
order never grow or change after validation. Sessions added externally after that
point are not included in this operation's writes.

The bound limits the distinct session targets attempted by this request. It does
not limit the final lane size or protect a target that becomes hidden, archived,
moves project or changes lane between validation and its write.

## Receipts

Every mutation returns the following fields; `code` is present on refusal/failure:

```json
{
  "status": "partial",
  "code": "UPDATE_UNKNOWN",
  "plannedSessionIds": ["session-a", "session-b", "session-c"],
  "attemptedCount": 2,
  "confirmedCount": 1,
  "atomic": false,
  "finalState": "not_observed",
  "allSucceeded": false,
  "results": [
    {"sessionId": "session-a", "lane": "backlog", "order": 0, "status": "updated"},
    {"sessionId": "session-b", "lane": "backlog", "order": 1, "status": "unknown", "code": "UPDATE_UNKNOWN"},
    {"sessionId": "session-c", "lane": "backlog", "order": 2, "status": "not_attempted"}
  ]
}
```

`status` is `completed` when every target was acknowledged, `rejected` for a
pre-write refusal, or `partial` after attempts with an unconfirmed outcome.
`results` has exactly one entry for every planned ID, in planned order. Moves omit
`order`. Completed reorder receipts additionally retain `lane` and `sessionIds`;
reorders that reach execution retain `lane` on partial receipts too.

| Per-target status | Meaning |
| --- | --- |
| `updated` | TwiCC acknowledged the submitted update. |
| `noop` | TwiCC acknowledged a submitted update as a no-op. There is no local skipped-write optimization. |
| `rejected` | A structured TwiCC rejection/validation receipt definitively refused that update. |
| `unknown` | A failed transport, malformed receipt or server failure leaves application uncertain. It may have committed. |
| `not_attempted` | Boatyard did not submit this target after refusal or stopping. |

`attemptedCount` includes `updated`, `noop`, `rejected` and `unknown`.
`confirmedCount` includes `updated` and `noop`. These count distinct targets,
not changed rows. Upstream error messages and private annotation values are not
copied into receipts. Post-read failure is separate from these acknowledgements;
Boatyard does not perform a post-write read or report a final board state.

Pre-write codes are `STALE_BOARD`, `STALE_LANE`, `AFFECTED_LIMIT_EXCEEDED`,
`INVALID_SCOPE`, `INVALID_ANCHOR`, `INCOMPLETE_SNAPSHOT`, `SNAPSHOT_CHANGED`,
`SNAPSHOT_UNAVAILABLE`, and the defensive `INVALID_INPUT`. They return
`attemptedCount: 0`, `confirmedCount: 0`, `allSucceeded: false`. Before a valid plan
exists, both `plannedSessionIds` and `results` are empty. A bound refusal retains
the complete plan, with every target `not_attempted`.

After writing begins, `UPDATE_REJECTED` and `UPDATE_UNKNOWN` identify unconfirmed
outcomes. `UPDATE_UNKNOWN` takes precedence if an unguarded move accumulates both.
Never automatically replay or compensate with a rollback. Inspect a fresh board
and obtain a new user decision when needed; do not overwrite later user choices.

## Remaining concurrency limits

The queue covers MCP mutations registered in one Boatyard configuration. Boatyard
UI drag/drop, other configurations/instances, and independent TwiCC clients bypass
it. All writes are sequential and non-atomic. A token check cannot prevent a change
after that check. Acknowledgements do not prove the final board still matches.
TwiCC's existing annotation read/modify/write path can also overwrite concurrent
unrelated annotation changes; this Boatyard feature does not fix that backend risk.

## Activation

From a source checkout, `make run` (or `npm start`) builds and starts Boatyard using
its normal entry point. A running Electron main process has already loaded its
plugin modules. Rebuilding or refreshing a pane/tool list does not replace those
modules: a scoped Boatyard application restart is required to activate this code.
That restart closes native Boatyard windows and recreates their WebContentsViews.
Normal graceful quitting saves workspace window state; avoid closing each window
individually, which can remove it from the saved workspace. The file editor keeps
drafts locally, but arbitrary embedded pages have their own persistence behavior:
save or preserve their unsaved drafts before restarting. Do not restart unrelated
applications or TwiCC. After an authorized restart,
refresh/reconnect the MCP client and verify `tools/list` and `list_sessions.guard`
before enabling guarded integrations. Updating an installed agent skill uses
Boatyard's existing MCP skill installation flow. No restart or activation is
performed merely by implementing this feature.
