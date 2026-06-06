# Dashtop Plugin API Contract

This document defines the initial contract for Dashtop plugins. It is a design
contract, not a complete implementation guide. The goal is to make third-party
plugins installable, configurable, composable, and callable without exposing
Dashtop internals directly.

## Goals

- Install plugins from third-party repositories or local paths.
- Let plugins contribute widgets, panes, settings UI, actions, services, and
  callable tools.
- Let plugins use Dashtop core features through a stable, permissioned API.
- Let plugins communicate with Dashtop, with other plugins, and with future
  integrated agents.
- Keep plugin-owned logic inside the plugin whenever Dashtop does not need to
  understand the domain.
- Keep Dashtop in control of security-sensitive execution, persistence,
  activation, and UI placement.

## Non-Goals

- Dashtop does not define domain-specific APIs for external tools such as Twicc,
  Hawser, or Pier.
- Dashtop does not run plugin-provided install commands without explicit user
  confirmation.
- Dashtop does not expose its internal store, renderer globals, Electron
  objects, or IPC channels directly to plugins.
- Dashtop does not require plugins to expose agent tools. Tools are an optional
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
- `apiVersion`: Dashtop Plugin API version required by the plugin.

### Optional Fields

- `main`: main-process entrypoint.
- `renderer`: renderer entrypoint.
- `description`: short description.
- `author`: author metadata.
- `homepage`: plugin homepage.
- `repository`: source repository.
- `license`: license id.
- `compatibility`: Dashtop version constraints.
- `contributes`: static contribution ids.
- `permissions`: requested capability list.
- `dependencies`: plugin dependencies.
- `optionalDependencies`: optional plugin dependencies.

## Lifecycle

Plugins are activated by Dashtop. A plugin MAY be activated eagerly or lazily
depending on its contributions and Dashtop policy.

Plugins have a persistent enabled state. Disabled plugins remain installed and
visible in plugin management UI, but Dashtop MUST NOT activate them or publish
their widgets, panes, settings sections, services, tools, actions, or event
subscriptions.

Dashtop SHOULD expose basic plugin management for installed plugins:

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

Dashtop MUST isolate plugin failures. A failing plugin MUST NOT crash the whole
app or corrupt unrelated plugin state.

## Plugin Status

Plugins own their domain-specific status. For example, the Twicc plugin knows
how to detect Twicc, the Hawser plugin knows how to detect Hawser, and the Pier
plugin knows how to detect Pier.

Dashtop only provides generic status publication.

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
  actions: ["dashtop.twicc.install"]
});
```

## Actions

Plugins MAY register actions. Actions are user-invoked commands that can appear
in plugin settings, project settings, menus, diagnostics, or future command
surfaces.

```js
ctx.actions.register({
  id: "dashtop.twicc.install",
  title: "Install Twicc",
  description: "Install Twicc with uvx.",
  scope: "plugin",
  confirmation: {
    title: "Install Twicc",
    message: "Dashtop will run uvx twicc@latest.",
    command: ["uvx", "twicc@latest"]
  },
  async run() {
    return ctx.system.exec(["uvx", "twicc@latest"]);
  }
});
```

Dashtop MUST show confirmations for sensitive actions. The plugin proposes the
action; Dashtop controls whether and how it runs.

## Permissions

Plugins MUST request permissions for capabilities that cross plugin boundaries,
touch Dashtop state, execute commands, or expose callable tools.

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

Dashtop MAY deny, prompt for, or restrict permissions at install time,
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
  tools: PluginToolApi;
  system: SystemApi;
  secrets: SecretApi;
  logger: LoggerApi;
}
```

Dashtop MAY expose different context subsets to main-process, renderer, and
sandboxed surfaces.

## Contribution IDs

Every contribution id registered by a plugin MUST be namespaced by that plugin
id. A contribution id is valid when it is exactly the plugin id or starts with
`<pluginId>.`.

Examples for plugin `dashtop.pier`:

- `dashtop.pier.urls`
- `dashtop.pier.preview`
- `dashtop.pier.global`
- `dashtop.pier.project`

This prevents collisions between third-party plugins and lets Dashtop remove all
contributions from one plugin during disable, reload, update, or uninstall.

## Configuration

Plugins MAY define global and project configuration. Configuration is
user-editable and SHOULD be schema-backed.

Global configuration applies to the plugin across Dashtop. Project
configuration applies to one project.

Dashtop stores plugin configuration under plugin namespaces:

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
  id: "dashtop.twicc.global",
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
  id: "dashtop.twicc.project",
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

Dashtop SHOULD namespace state by plugin id and SHOULD remove or archive it on
uninstall according to the uninstall policy.

## Widgets

Plugins MAY contribute widgets. Widgets are project-scoped by default but MAY be
global if the surface supports it.

```js
ctx.widgets.register({
  id: "dashtop.hawser.inbox",
  title: "Hawser Inbox",
  scope: "project",
  category: "Agents",
  layout: {
    default: { columns: 1, rows: 3 },
    min: { columns: 1, rows: 2 },
    max: { columns: 4, rows: 8 }
  },
  createElement(project, props) {
    return createHawserWidget(project, props);
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

## Panes

Plugins MAY contribute panes. Pane kinds are:

- `wcv`: Electron `WebContentsView` pane.
- `dom`: Dashtop DOM-rendered pane.

### WCV Pane

```js
ctx.panes.register({
  id: "dashtop.twicc.pane",
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

Dashtop owns pane layout, selection, splitting, closing, persistence, and
surface placement. Plugins provide pane content and metadata.

## Services

Services are plugin-to-plugin APIs. They are meant for in-process integration
between plugins.

```js
ctx.services.provide("dashtop.twicc.api", {
  version: "1.0.0",
  async listProjects() {},
  async createSession(input) {}
});
```

Consumers request services by id. Missing optional services return `null`.

```js
const twicc = ctx.services.get("dashtop.twicc.api");

if (twicc) {
  await twicc.createSession({ projectId, prompt });
}
```

Services SHOULD expose a `version` field when they have an external consumer.
Plugins SHOULD treat service integrations as optional unless the manifest
declares a hard dependency.

Future Dashtop versions SHOULD provide availability events:

```js
ctx.services.onAvailable("dashtop.twicc.api", async (twicc) => {});
ctx.services.onUnavailable("dashtop.twicc.api", () => {});
```

## Tools

Tools are callable operations intended for agents, automation, MCP, REST, or
direct Dashtop calls. Tools are not the same as services. Services are plugin
APIs; tools are externalizable capabilities with schemas.

```js
ctx.tools.register({
  id: "twicc.createSession",
  title: "Create Twicc Session",
  description: "Create a Twicc session for a Dashtop project.",
  inputSchema: {
    type: "object",
    properties: {
      projectId: { type: "string" },
      prompt: { type: "string" },
      provider: { type: "string" }
    },
    required: ["projectId", "prompt"]
  },
  outputSchema: {
    type: "object",
    properties: {
      sessionId: { type: "string" },
      url: { type: "string" }
    },
    required: ["sessionId"]
  },
  async invoke(input, callCtx) {
    return createTwiccSession(input, callCtx);
  }
});
```

Dashtop owns publication of registered tools. The same tool registry MAY be
exposed through:

- an MCP server,
- a REST API,
- direct in-process calls,
- an integrated agent plugin.

Tool calls SHOULD receive a call context:

```ts
interface ToolCallContext {
  caller: "user" | "agent" | "plugin" | "rest" | "mcp";
  callerId?: string;
  projectId?: string;
  permissions: string[];
  signal?: AbortSignal;
}
```

Tools MUST validate input through their schema. Dashtop MAY require additional
confirmation before invoking sensitive tools.

## Events

Plugins MAY subscribe to Dashtop events. Future versions MAY allow plugins to
publish plugin events.

```js
const dispose = ctx.events.on("dashtop.projectForm.sourcePathInspected", (event) => {
  if (event.inspected?.twiccUrl) {
    event.fields.setValue("twiccProjectUrl", event.inspected.twiccUrl);
  }
});
```

`dashtop.projectForm.sourcePathInspected` is emitted when the project form
inspects a source path. Plugin handlers receive their own scoped field API, so a
plugin can update its own project settings fields without accessing another
plugin's fields.

Dashtop events SHOULD be typed and versioned. Plugin events SHOULD be
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

Dashtop MUST control execution policy. It MAY:

- deny execution,
- require confirmation,
- restrict commands,
- run commands in a sandbox,
- log command usage,
- redact sensitive values.

Plugins SHOULD implement domain-specific probe and install logic themselves,
but command execution remains mediated by Dashtop.

## Secrets

Plugins SHOULD use the secrets API for tokens, passwords, and credentials.
Secrets SHOULD NOT be stored in plain plugin config.

```js
await ctx.secrets.set("apiToken", token);
const token = await ctx.secrets.get("apiToken");
```

Dashtop SHOULD namespace secrets by plugin id and MAY support project-scoped
secrets.

## Installation

Installation flow:

1. Resolve source package.
2. Read manifest without executing plugin runtime code.
3. Validate id, version, API compatibility, contributions, and permissions.
4. Show requested permissions and source metadata to the user.
5. Install package into Dashtop plugin storage.
6. Build or load runtime assets if required.
7. Add plugin to the installed plugin registry.
8. Activate plugin according to policy.

Dashtop SHOULD maintain a plugin lockfile that records:

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

Dashtop MUST clean active panes, widgets, services, tools, and actions provided
by the plugin.

## Example: Twicc Plugin

The Twicc plugin owns Twicc detection and install logic.

Contributions:

- global settings section with `twiccBaseUrl`,
- project settings section with `twiccProjectUrl`,
- WCV pane named `Twicc`,
- service `dashtop.twicc.api`,
- tools such as `twicc.listProjects` and `twicc.createSession`,
- status actions such as `dashtop.twicc.install`.

The plugin MAY set status to `unavailable` if Twicc is not detected, and MAY
provide an install action that runs `uvx twicc@latest` through `ctx.system.exec`
after user confirmation.

## Example: Hawser Plugin

The Hawser plugin owns Hawser detection and configuration.

Contributions:

- global or project settings for Hawser main session,
- project widget for inbox/task status,
- optional service consumption of `dashtop.twicc.api`.

The Hawser widget SHOULD continue to work in a reduced mode when the Twicc
service is unavailable.

## Example: Pier Plugin

The Pier plugin owns Pier detection and configuration.

Contributions:

- global settings for `pierApiUrl`,
- project settings for `pierPreviewUrl` override and `pierProjectName`,
- WCV pane named `Pier`.
- project widget listing running Pier workload URLs and worktree paths.
- service `dashtop.pier` exposing Pier workload operations.

Legacy project `previewUrl` values MAY be migrated into
`pluginConfig.projects[projectId]["dashtop.pier"].pierPreviewUrl` at store load
time only. Runtime Pier contributions MUST read from Pier plugin config and the
Pier API, not from the deprecated project root `previewUrl` field.

The plugin MAY expose preview-related tools later, but it does not need to do
so for the pane contribution.

## Open Design Questions

- What plugin runtime isolation should Dashtop use for third-party renderer
  code?
- Should plugin packages be JavaScript-only at first, or should Dashtop support
  language-agnostic plugins through external processes?
- Which permissions are install-time approvals and which are call-time
  approvals?
- Should WCV pane preload scripts be plugin-provided, Dashtop-provided, or
  forbidden for third-party plugins?
- What is the first supported distribution format: Git repository, local path,
  npm package, or Dashtop-specific archive?
- Should Dashtop expose the tool registry through MCP itself, or should an
  agent plugin own MCP publication?
