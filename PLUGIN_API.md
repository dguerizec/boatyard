# Boatyard Plugin API Contract

This document defines the initial contract for Boatyard plugins. It is a design
contract, not a complete implementation guide. The goal is to make third-party
plugins installable, configurable, composable, and callable without exposing
Boatyard internals directly.

## Goals

- Install plugins from third-party repositories or local paths.
- Let plugins contribute widgets, panes, settings UI, actions, services, and
  callable tools.
- Let plugins use Boatyard core features through a stable, permissioned API.
- Let plugins communicate with Boatyard, with other plugins, and with future
  integrated agents.
- Keep plugin-owned logic inside the plugin whenever Boatyard does not need to
  understand the domain.
- Keep Boatyard in control of security-sensitive execution, persistence,
  activation, and UI placement.

## Non-Goals

- Boatyard does not define domain-specific APIs for external tools such as Twicc
  or Pier.
- Boatyard does not run plugin-provided install commands without explicit user
  confirmation.
- Boatyard does not expose its internal store, renderer globals, Electron
  objects, or IPC channels directly to plugins.
- Boatyard does not require plugins to expose agent tools. Tools are an optional
  contribution.

## Plugin Package

A plugin package MUST include a manifest and MAY include runtime entrypoints,
assets, schemas, and generated bundles.

The package source MAY be:

- a local directory,
- a Git repository,
- a packaged archive,
- a future registry entry.

The package manager MUST preserve enough source metadata to support update,
uninstall, diagnostics, and lockfile generation.

## Manifest

Each plugin MUST declare a manifest. The manifest is declarative and is loaded
before plugin code runs.

```js
export default {
  id: "vendor.plugin-name",
  name: "Plugin Name",
  version: "1.0.0",
  apiVersion: "0.1",
  main: "./dist/main.js",
  renderer: "./dist/renderer.js",

  contributes: {
    widgets: ["plugin.widget"],
    panes: ["plugin.pane"],
    globalSettings: ["plugin.globalSettings"],
    projectSettings: ["plugin.projectSettings"],
    services: ["plugin.service"],
    tools: ["plugin.tool"],
    actions: ["plugin.action"]
  },

  permissions: [
    "projects:read",
    "projectConfig:read",
    "projectConfig:write",
    "settings:read",
    "settings:write",
    "pane:wcv",
    "pane:dom",
    "widget:provide",
    "service:provide",
    "service:consume",
    "tool:provide",
    "actions:provide",
    "system:exec"
  ]
};
```

### Required Fields

- `id`: stable globally unique plugin id. Recommended format:
  `vendor.plugin-name`.
- `name`: user-facing plugin name.
- `version`: plugin package version.
- `apiVersion`: Boatyard Plugin API version required by the plugin.

### Optional Fields

- `main`: main-process entrypoint.
- `renderer`: renderer entrypoint.
- `description`: short description.
- `author`: author metadata.
- `homepage`: plugin homepage.
- `repository`: source repository.
- `license`: license id.
- `compatibility`: Boatyard version constraints.
- `contributes`: static contribution ids.
- `permissions`: requested capability list.
- `dependencies`: plugin dependencies.
- `optionalDependencies`: optional plugin dependencies.

## Lifecycle

Plugins are activated by Boatyard. A plugin MAY be activated eagerly or lazily
depending on its contributions and Boatyard policy.

Plugins have a persistent enabled state. Disabled plugins remain installed and
visible in plugin management UI, but Boatyard MUST NOT activate them or publish
their widgets, panes, settings sections, services, tools, actions, or event
subscriptions.

Boatyard SHOULD expose basic plugin management for installed plugins:

- enable and disable,
- runtime status and diagnostics,
- reload,
- future install, update, and uninstall actions.

Runtime entrypoints MAY export:

```js
export async function activate(ctx) {}
export async function deactivate(ctx) {}
```

`activate(ctx)` receives a `PluginContext`. The plugin registers dynamic
contributions, services, tools, actions, event listeners, and status from this
function.

`deactivate(ctx)` is called before disabling, uninstalling, reloading, or
shutting down a plugin. Plugins MUST release subscriptions, handles, timers, and
long-running work through disposables returned by the context APIs.

Boatyard MUST isolate plugin failures. A failing plugin MUST NOT crash the whole
app or corrupt unrelated plugin state.

## Plugin Status

Plugins own their domain-specific status. For example, the Twicc plugin knows
how to detect Twicc, and the Pier plugin knows how to detect Pier.

Boatyard only provides generic status publication.

```js
ctx.status.set({
  state: "ready",
  summary: "Twicc is available",
  details: {
    version: "0.34.4",
    url: "http://localhost:5173"
  }
});
```

Allowed states:

- `activating`
- `ready`
- `notConfigured`
- `unavailable`
- `degraded`
- `error`
- `disabled`

Status MAY include plugin-owned diagnostics and action ids.

```js
ctx.status.set({
  state: "unavailable",
  summary: "Twicc is not installed",
  details: {
    command: "twicc"
  },
  actions: ["boatyard.twicc.install"]
});
```

## Actions

Plugins MAY register actions. Actions are user-invoked commands that can appear
in plugin settings, project settings, menus, diagnostics, or future command
surfaces.

```js
ctx.actions.register({
  id: "boatyard.twicc.install",
  title: "Install Twicc",
  description: "Install Twicc with uvx.",
  scope: "plugin",
  confirmation: {
    title: "Install Twicc",
    message: "Boatyard will run uvx twicc@latest.",
    command: ["uvx", "twicc@latest"]
  },
  async run() {
    return ctx.system.exec(["uvx", "twicc@latest"]);
  }
});
```

Boatyard MUST show confirmations for sensitive actions. The plugin proposes the
action; Boatyard controls whether and how it runs.

## Permissions

Plugins MUST request permissions for capabilities that cross plugin boundaries,
touch Boatyard state, execute commands, or expose callable tools.

Permission examples:

- `projects:read`
- `projects:write`
- `settings:read`
- `settings:write`
- `projectConfig:read`
- `projectConfig:write`
- `pluginState:read`
- `pluginState:write`
- `pane:wcv`
- `pane:dom`
- `widget:provide`
- `service:provide`
- `service:consume`
- `tool:provide`
- `actions:provide`
- `events:subscribe`
- `system:exec`
- `network:fetch`
- `secrets:read`
- `secrets:write`

Boatyard MAY deny, prompt for, or restrict permissions at install time,
activation time, or call time.

## Plugin Context

`PluginContext` is the only supported runtime API.

```ts
interface PluginContext {
  plugin: PluginIdentity;
  status: PluginStatusApi;
  actions: PluginActionApi;
  widgets: WidgetContributionApi;
  panes: PaneContributionApi;
  settings: SettingsContributionApi;
  projects: ProjectApi;
  config: PluginConfigApi;
  state: PluginStateApi;
  events: EventApi;
  services: PluginServiceApi;
  projectNavBadges: ProjectNavBadgeContributionApi;
  tools: PluginToolApi;
  system: SystemApi;
  secrets: SecretApi;
  logger: LoggerApi;
}
```

Boatyard MAY expose different context subsets to main-process, renderer, and
sandboxed surfaces.

## Contribution IDs

Every contribution id registered by a plugin MUST be namespaced by that plugin
id. A contribution id is valid when it is exactly the plugin id or starts with
`<pluginId>.`.

Examples for plugin `boatyard.pier`:

- `boatyard.pier.urls`
- `boatyard.pier.preview`
- `boatyard.pier.global`
- `boatyard.pier.project`

This prevents collisions between third-party plugins and lets Boatyard remove all
contributions from one plugin during disable, reload, update, or uninstall.

## Configuration

Plugins MAY define global and project configuration. Configuration is
user-editable and SHOULD be schema-backed.

Global configuration applies to the plugin across Boatyard. Project
configuration applies to one project.

Boatyard stores plugin configuration under plugin namespaces:

```js
{
  pluginConfig: {
    global: {
      "vendor.plugin": {}
    },
    projects: {
      "project-id": {
        "vendor.plugin": {}
      }
    }
  }
}
```

```js
ctx.settings.registerGlobalSection({
  id: "boatyard.twicc.global",
  title: "Twicc",
  fields: [
    {
      key: "twiccApiUrl",
      label: "Twicc API URL",
      type: "text",
      valueType: "url",
      placeholder: "http://localhost:3500"
    }
  ]
});

ctx.settings.registerProjectSection({
  id: "boatyard.twicc.project",
  title: "Twicc",
  fields: [
    {
      key: "twiccProjectUrl",
      label: "Twicc project URL",
      type: "text",
      valueType: "url",
      placeholder: "http://localhost:3500/project/example"
    }
  ]
});
```

Config APIs:

```js
await ctx.config.global.get();
await ctx.config.global.update(patch);
await ctx.config.project.get(projectId);
await ctx.config.project.update(projectId, patch);
```

Plugins MAY provide migrations for config schema changes.

## Plugin State

State is private plugin-owned persistence. It is not the same as user
configuration.

```js
await ctx.state.global.get("cache");
await ctx.state.global.set("cache", value);
await ctx.state.project.get(projectId, "lastSessionId");
await ctx.state.project.set(projectId, "lastSessionId", sessionId);
```

Boatyard SHOULD namespace state by plugin id and SHOULD remove or archive it on
uninstall according to the uninstall policy.

## Widgets

Plugins MAY contribute widgets. Widgets are project-scoped by default but MAY be
global if the surface supports it.

```js
ctx.widgets.register({
  id: "example.status",
  title: "Project Status",
  scope: "project",
  category: "Agents",
  layout: {
    default: { columns: 1, rows: 3 },
    min: { columns: 1, rows: 2 },
    max: { columns: 4, rows: 8 }
  },
  createElement(project, props) {
    return createStatusWidget(project, props);
  }
});
```

Widget `props` SHOULD include:

- `projectId`
- `project`
- `config`
- `state`
- `events`
- `services`

Widget renderers MUST return a disposable or cleanup callback when they attach
listeners, timers, or external resources.

### Top bar widgets

Widgets whose data is app-global MAY also opt into the top bar surface by
including `"topbar"` in `scopes` and providing a `createCompact` renderer:

```js
ctx.widgets.register({
  id: "boatyard.twicc.usage",
  title: "TwiCC Usage",
  scopes: ["global", "project", "topbar"],
  createElement(project, props) {
    return createUsageWidget(project, props);
  },
  createCompact(project, props) {
    return createCompactUsageWidget(project, props);
  }
});
```

`createCompact(null, props)` MUST return a small inline element that fits the
top bar (roughly one text line). Clicking the chip opens a popover rendered
with the widget's regular `createElement`/`create`, so the full widget MUST
tolerate a `null` project. Users enable top bar widgets from the top bar
context menu; the selection is persisted globally.

## Project Navigation Badges

Plugins MAY contribute compact badges for the project sidebar. Badges are
renderer-side DOM contributions and SHOULD remain short enough to fit beside the
project name.

```js
ctx.projectNavBadges.register({
  id: "boatyard.twicc.projectStatus",
  render({ project, projectConfig, globalConfig }) {
    return createTwiccStatusBadge(project, projectConfig, globalConfig);
  }
});
```

The renderer calls `render` when the project list is rendered. `isActiveProject`
is true when the project is currently focused in the main workbench. Plugins
that change badge data asynchronously SHOULD notify the sidebar to re-render
through the renderer event surface provided by their integration.

## Panes

Plugins MAY contribute panes. Pane kinds are:

- `wcv`: Electron `WebContentsView` pane.
- `dom`: Boatyard DOM-rendered pane.

### WCV Pane

```js
ctx.panes.register({
  id: "boatyard.twicc.pane",
  title: "Twicc",
  kind: "wcv",
  scope: "project",
  resolveUrl({ projectConfig }) {
    return projectConfig.twiccUrl || "http://localhost:5173";
  }
});
```

### DOM Pane

```js
ctx.panes.register({
  id: "vendor.inspector.pane",
  title: "Inspector",
  kind: "dom",
  scope: "project",
  render(container, props) {
    return renderInspector(container, props);
  }
});
```

Boatyard owns pane layout, selection, splitting, closing, persistence, and
surface placement. Plugins provide pane content and metadata.

## Services

Services are plugin-to-plugin APIs. They are meant for in-process integration
between plugins.

```js
ctx.services.provide("boatyard.twicc.api", {
  version: "1.0.0",
  async listProjects() {},
  async createSession(input) {}
});
```

Consumers request services by id. Missing optional services return `null`.

```js
const twicc = ctx.services.get("boatyard.twicc.api");

if (twicc) {
  await twicc.createSession({ projectId, prompt });
}
```

Services SHOULD expose a `version` field when they have an external consumer.
Plugins SHOULD treat service integrations as optional unless the manifest
declares a hard dependency.

Future Boatyard versions SHOULD provide availability events:

```js
ctx.services.onAvailable("boatyard.twicc.api", async (twicc) => {});
ctx.services.onUnavailable("boatyard.twicc.api", () => {});
```

## Tools

The main-process plugin context implements `ctx.tools.register`. Boatyard
publishes these tools through its authenticated MCP server. Domain behavior
belongs to the plugin; the server handles transport and configuration routing.

```ts
import { z } from "zod";

ctx.tools.register({
  id: "vendor.example.listItems",
  title: "List items",
  description: "Read items for a project.",
  inputSchema: z.object({ projectId: z.string().min(1) }).strict(),
  readOnly: true,
  async invoke(input) {
    return listItems(input.projectId);
  }
});
```

- Tool IDs must start with the owning plugin ID followed by `.` and be unique.
- Input schemas are Zod objects. Both MCP and direct host invocation validate
  inputs before calling the handler. Use strict schemas to reject extra fields.
- `contextId` is reserved: MCP adds this required argument, using the context
  returned by `list_windows`, and routes to that configuration's plugin host.
  The plugin receives its own input fields only, without `contextId`.
- Disabled plugins are excluded from tool discovery and rejected on invocation.
  Discovery reflects the current registered tools on each MCP request.
- Plugin configuration and credentials should be read from `ctx.getState()` at
  invocation time, never supplied by the MCP caller or included in the result.
- Handlers return JSON-compatible values. Exceptions become MCP tool errors.
  `readOnly` describes actual behavior, including indirect writes. Mutating tools
  default to a destructive hint; set `destructive: false` for non-destructive
  operations such as moving a Kanban card.
- Registration is reset when the host rediscovers plugins. This initial API does
  not expose REST publication, output schemas or a general call context.

### TwiCC Kanban tools

The `boatyard.twicc` plugin registers:

| Tool ID | Inputs besides `contextId` | Behavior |
| --- | --- | --- |
| `boatyard.twicc.list_sessions` | `projectId`, optional `lane` | Read visible, unarchived sessions in board order, including independent `lane` and `processState` fields. |
| `boatyard.twicc.move_sessions` | `projectId`, `sessionIds`, `lane` | Move explicit sessions; return each update's result. |
| `boatyard.twicc.reorder_sessions` | `projectId`, `sessionIds`, `lane`, `position`, optional `anchorSessionId` | Set visual priority within a lane. |

Project IDs are Boatyard IDs returned by `list_windows`; the plugin resolves the
same TwiCC project reference used by the UI. Lanes are `in_progress`, `backlog`
and `done`. Mutation selections must be unique and contain 1–100 session IDs
from that project's visible, unarchived board. `position` is `first`, `last`,
`before` or `after`; an anchor is required only for `before`/`after` and must be
another session in the same lane. Selected sessions retain input order.

Reads paginate through TwiCC and never write annotations. Sessions without an
explicit lane use the shared board rules: active/open run → In progress,
otherwise pinned → Backlog, otherwise Done. Such inferred lanes can change
until explicitly assigned. Existing explicit assignments remain authoritative.

Startup separately converts legacy `testing` annotations to `done`, including
hidden and archived sessions, through TwiCC's public annotation commands. Other
metadata and session activity are preserved. Failed conversions are reported
and retried at the next startup; legacy values still display as Done meanwhile.
The legacy literal dotted annotation key, if present, is superseded by the
canonical nested value without replacing the session's annotation object.

Moves and reordering do not stop agents or archive sessions. Done remains
separate from TwiCC's archive flag. Reordering assigns consecutive order values
to the destination lane. Writes are sequential, not transactional; MCP mutations
are serialized per configuration, but another client or the UI can still edit
annotations concurrently. Partial results identify completed and failed writes;
re-list before retrying or resolving concurrent edits.

## Events

Plugins MAY subscribe to Boatyard events. Future versions MAY allow plugins to
publish plugin events.

```js
const dispose = ctx.events.on("boatyard.projectForm.sourcePathInspected", (event) => {
  if (event.inspected?.twiccUrl) {
    event.fields.setValue("twiccProjectUrl", event.inspected.twiccUrl);
  }
});

ctx.events.on("boatyard.projectForm.coreFieldChanged", (event) => {
  console.log(event.field, event.value, event.coreFields);
});
```

`boatyard.projectForm.sourcePathInspected` is emitted when the project form
inspects a source path. Plugin handlers receive their own scoped field API, so a
plugin can update its own project settings fields without accessing another
plugin's fields.

`boatyard.projectForm.coreFieldChanged` is emitted when a core project field
changes in the project form. The payload includes `field`, `value`, `source`,
and `coreFields` with the current `name`, `slug`, `sourcePath`, `gitUrl`,
`repoUrl`, `devBranch`, and `twiccUrl` values.

Boatyard events SHOULD be typed and versioned. Plugin events SHOULD be
namespaced by plugin id.

## System Execution

Plugins MAY request command execution if they have the `system:exec`
permission.

```js
await ctx.system.exec(["uvx", "twicc@latest"], {
  cwd: project.sourcePath,
  env: {},
  confirmation: true
});
```

Boatyard MUST control execution policy. It MAY:

- deny execution,
- require confirmation,
- restrict commands,
- run commands in a sandbox,
- log command usage,
- redact sensitive values.

Plugins SHOULD implement domain-specific probe and install logic themselves,
but command execution remains mediated by Boatyard.

## Secrets

Plugins SHOULD use the secrets API for tokens, passwords, and credentials.
Secrets SHOULD NOT be stored in plain plugin config.

```js
await ctx.secrets.set("apiToken", token);
const token = await ctx.secrets.get("apiToken");
```

Boatyard SHOULD namespace secrets by plugin id and MAY support project-scoped
secrets.

## Installation

Installation flow:

1. Resolve source package.
2. Read manifest without executing plugin runtime code.
3. Validate id, version, API compatibility, contributions, and permissions.
4. Show requested permissions and source metadata to the user.
5. Install package into Boatyard plugin storage.
6. Build or load runtime assets if required.
7. Add plugin to the installed plugin registry.
8. Activate plugin according to policy.

Boatyard SHOULD maintain a plugin lockfile that records:

- plugin id,
- installed version,
- source type,
- source URL/path,
- resolved commit or package digest,
- install time,
- enabled state.

## Update

Update flow:

1. Resolve candidate update.
2. Read manifest.
3. Compare permissions and compatibility.
4. Ask for confirmation when permissions expand or source changes.
5. Deactivate old runtime.
6. Install new runtime.
7. Run migrations if declared.
8. Activate new runtime.

## Uninstall

Uninstall flow:

1. Deactivate plugin.
2. Remove contributions from active registries.
3. Remove package files.
4. Remove lockfile entry.
5. Ask whether to remove plugin config, plugin state, and secrets.

Boatyard MUST clean active panes, widgets, services, tools, and actions provided
by the plugin.

## Example: Twicc Plugin

The Twicc plugin owns Twicc detection and install logic.

Contributions:

- global settings section with `twiccBaseUrl`,
- project settings section with `twiccProjectUrl`,
- WCV pane named `Twicc`,
- service `boatyard.twicc.api`,
- tools such as `twicc.listProjects` and `twicc.createSession`,
- status actions such as `boatyard.twicc.install`.

The plugin MAY set status to `unavailable` if Twicc is not detected, and MAY
provide an install action that runs `uvx twicc@latest` through `ctx.system.exec`
after user confirmation.

## Example: Pier Plugin

The Pier plugin owns Pier detection and configuration.

Contributions:

- global settings for `pierApiUrl`,
- project settings for `pierPreviewUrl` override and `pierProjectName`,
- WCV pane named `Pier`.
- project widget listing running Pier workload URLs and worktree paths.
- service `boatyard.pier` exposing Pier workload operations.

Legacy project `previewUrl` values MAY be migrated into
`pluginConfig.projects[projectId]["boatyard.pier"].pierPreviewUrl` at store load
time only. Runtime Pier contributions MUST read from Pier plugin config and the
Pier API, not from the deprecated project root `previewUrl` field.

The plugin MAY expose preview-related tools later, but it does not need to do
so for the pane contribution.

## Open Design Questions

- What plugin runtime isolation should Boatyard use for third-party renderer
  code?
- Should plugin packages be JavaScript-only at first, or should Boatyard support
  language-agnostic plugins through external processes?
- Which permissions are install-time approvals and which are call-time
  approvals?
- Should WCV pane preload scripts be plugin-provided, Boatyard-provided, or
  forbidden for third-party plugins?
- What is the first supported distribution format: Git repository, local path,
  npm package, or Boatyard-specific archive?
