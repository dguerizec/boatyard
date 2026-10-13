# Create a Boatyard project through MCP

`create_project` creates one core Boatyard project using `ProjectStore.addProject`,
inside the selected configuration's projects tree. It can also register that
source directory in the already enabled TwiCC plugin and store its project URL.
It does not configure or activate any other MCP/backend plugin such as Gmail.
The existing MCP bearer-token boundary applies; creation grants no new client
permissions and does not change credentials.

## Input

The object is strict: additional properties are rejected.

| Field | Required | Contract |
| --- | --- | --- |
| `contextId` | Yes | Exactly 16 lowercase hexadecimal characters from `list_windows`; the configuration must already be loaded. |
| `name` | Yes | At most 160 characters before trimming, nonempty after trimming, no ASCII control characters. When TwiCC creation is requested, its existing limit of 25 Unicode code points is checked before any writes. |
| `directory` | Yes | Relative child directory inside configured `projectsBasePath`, at most 2048 characters and 16 segments. Absolute paths, dot/dot-dot segments, empty segments, backslashes, colons and ASCII control characters are rejected. Missing child directories are created. |
| `reuse` | No | Boolean, defaults to `false`. An existing directory is refused unless this is explicitly `true`. Does not bypass duplicate project guards. |
| `slug` | No | At most 80 characters, matching `^[a-z0-9]+(?:-[a-z0-9]+)*$`. Omission uses the existing domain slug derivation from the name; empty or overlong derived slugs are refused. |
| `group` | No | At most 160 characters before trimming, nonempty after trimming, no ASCII control characters. Defaults to the domain's empty group. |
| `createTwiccProject` | No | Boolean or `"auto"`, defaults to `"auto"`. Auto creates a trusted TwiCC project when the plugin's creation action is enabled and available, propagating trust to descendants; `false` skips it. Explicit `true` with an unavailable/disabled plugin is refused before any write. |

No absolute source/configuration path, caller-selected ID, plugin settings,
credentials, terminal commands, environment or initial layout are accepted.
Resolve the exact configuration through `list_windows`; never guess it from a
repository path. `projectsBasePath` must already be an existing absolute
directory; a filesystem root is not accepted as the projects tree.

Preflight canonicalizes the root and target using the existing directory
resolver. A target must be a strict descendant of the canonical root, including
when symlinks are present. Existing files and escaping symlinks are refused.
Duplicate canonical slug, trimmed NFKC/case-folded name and canonical source
location are checked before any directory or project write. Source comparison
uses the shared directory resolver, including existing symlink resolution; it
is not a transaction or a guarantee of equivalence under concurrent filesystem
changes. Relative legacy source paths are not compared as absolute locations.

Directory creation proceeds one child at a time, rechecking directory type and
canonical containment. At most 16 child directories are created. No repository
commands run. The synchronous filesystem preflight and domain creation do not
yield to another main-process request. External filesystem writers can still
race path checks and mkdir; this is not an OS-level filesystem sandbox or an
atomic transaction. UI creation and external configuration-file writers do not
share these MCP duplicate guards.

## Receipts

All business receipts are equivalent JSON text content and MCP
`structuredContent`. Clients must inspect `status` rather than treating a
successful MCP envelope as proof of creation.

A complete creation returns:

```json
{
  "status": "created",
  "contextId": "0123456789abcdef",
  "project": {
    "id": "00000000-0000-4000-8000-000000000001",
    "name": "Example",
    "slug": "example",
    "group": "",
    "isOpen": true
  },
  "attemptedCount": 1,
  "confirmedCount": 1,
  "directory": { "status": "created", "createdCount": 1 },
  "twicc": { "status": "skipped", "attemptedCount": 0, "confirmedCount": 0 }
}
```

The domain generates the UUID, marks the project open and initializes its
display settings. No window is selected or navigated, and no initial pane layout
is applied. Every open window in the selected configuration receives the updated
project catalog immediately after the domain mutation, and again after linking
TwiCC. Sidebars update without reloading the current view, navigating away, or
discarding settings drafts. Other configurations are not notified.
`list_windows` also reads the updated project inventory. The receipt acknowledges
store/backend operations, not UI rendering or session readiness.

Top-level `attemptedCount` and `confirmedCount` refer only to the single Boatyard
`addProject` call. Directory and TwiCC effects are reported independently:

- `directory.status`: `not_attempted`, `existing`, `created` or `unknown`.
  `createdCount` counts acknowledged mkdir calls, from 0 to 16. Unknown can leave
  those directories behind, and may include further uncertain effects.
- `twicc.status`: `not_attempted`, `skipped`, `created` or `unknown`.
  Its attempt/confirmation counts concern the single TwiCC creation workflow,
  each from 0 to 1. A confirmed creation also includes a bounded `projectId`.
  It does not confirm persistence of the local TwiCC link.

Stable `rejected` codes (zero mkdir calls and zero project creation attempts):

- `INVALID_PROJECT_INPUT`
- `CONTEXT_NOT_AVAILABLE`
- `PROJECT_READ_FAILED`
- `PROJECTS_ROOT_NOT_AVAILABLE`
- `DIRECTORY_NOT_AVAILABLE`
- `DIRECTORY_OUTSIDE_PROJECTS_ROOT`
- `DIRECTORY_ALREADY_EXISTS`
- `DUPLICATE_PROJECT_SLUG`
- `DUPLICATE_PROJECT_NAME`
- `DUPLICATE_SOURCE_PATH`
- `TWICC_NOT_AVAILABLE`
- `TWICC_NAME_TOO_LONG`
- `PROJECT_CREATION_UNAVAILABLE`

Rejected receipts omit context/project identities and report `not_attempted`
for directory/TwiCC with zero counts. Protocol schema failures are rejected by
MCP validation before the callback and may use an MCP error envelope instead.

`unknown` with `PROJECT_CREATION_UNCERTAIN` reports one attempted Boatyard call,
zero confirmations, the observed directory receipt and TwiCC `not_attempted`.
The store changes memory before writing several files: a persistence exception
may leave memory changes or partially persisted files. An unexpected domain
receipt also yields unknown. No project ID is claimed in this case.

`partial` uses one of these codes:

- `DIRECTORY_CREATION_UNCERTAIN`: directory effects may exist; Boatyard/TwiCC
  creation has not been attempted, and no project identity is returned.
- `TWICC_CREATION_UNCERTAIN`: Boatyard creation is confirmed and returned; the
  one TwiCC workflow may have committed, but its result cannot be confirmed.
- `TWICC_LINK_UNCERTAIN`: Boatyard and TwiCC creation are independently
  confirmed; storing the local project link failed and may have changed memory
  or disk.
- `TWICC_LINK_CHANGED`: Boatyard and TwiCC creation are confirmed; the project
  was removed, its source path changed or its link was filled while awaiting
  TwiCC. The tool preserves that intervening change instead of replacing it.

The TwiCC workflow reuses the plugin's project-creation API with `trust: true`,
`propagateTrust: true` and `allowCliFallback: false`. This creation policy
reflects the human's explicit choice to trust projects created through this
workflow and their descendants, including worktrees. RPC sends
`propagate: true`, and CLI sends `--propagate` explicitly, matching manual
project creation in Boatyard. Global settings and provider/session permission
modes remain unchanged.

Creation, trust update and inspection are separate backend operations. A trust
update failure returns `TWICC_CREATION_UNCERTAIN`: the TwiCC project may exist,
but the workflow is not confirmed and no local TwiCC link is stored. There is
no fallback, retry or rollback. A confirmed TwiCC receipt acknowledges the
complete workflow, including the trust update, rather than proving its final
state against subsequent external changes. The tool does not start a session
or enable a disabled plugin. Only an exact
TwiCC source match and a credential-free HTTP(S) link are accepted for linking.
Backend exception messages, URLs, source paths, full state and credentials are
not returned to the model.

There is no automatic retry, cleanup or rollback. Inspect all relevant state
before a manual retry after a partial/unknown receipt or transport failure.
An unexpected host callback/output error uses a sanitized MCP error with
`PROJECT_CREATION_UNCERTAIN` and no counts, because step effects are unavailable.

Annotations: `readOnlyHint: false`, `destructiveHint: false`,
`idempotentHint: false`, `openWorldHint: true`. The isolated protocol test export
(`BOATYARD_MCP_CONTRACT_EXPORT`) records actual registered input/output JSON
Schemas and annotations for integration review.

## Activation

The tool is loaded by the Electron main process. Build via `npm run build:app`
and restart Boatyard through its usual launch method (development uses
`npm start`, which builds first). Client tool refresh or MCP disable/enable alone
does not load changed main-process code. A whole-app restart closes native
windows and embedded pages: preserve pending drafts before an authorized
restart. Preparing this implementation does not restart or alter the live app.
