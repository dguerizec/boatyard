# Dashtop

Dashtop is an Electron project cockpit for dashboards, web tools, and local development workflows.

It is organized around a global workspace, a project switcher, project-scoped widgets, and project-scoped webapp panes. The app intentionally stays closer to a dashboard/workbench than to a "desktop inside a desktop".

## Features

- Register projects with source path, git/repository URLs, development branch, and custom provider URLs.
- Reorder projects in the sidebar and unregister projects from Dashtop without deleting files on disk.
- Persist app state across restarts, including the last active page, window bounds, widget layouts, pane splits, loaded webapp URLs, and widget rail width.
- Open project webapps in Electron `WebContentsView` panes with navigation controls, editable URL bar, tab picker, split panes, close panes, and persisted pane layouts.
- Manage a freeform widget grid with lock/unlock, drag-and-drop placement, resize handles, trash dropzone, and opt-in widget installation per project.
- Use built-in project widgets for persistent tmux terminal tabs.
- Extend projects with built-in plugins for Pier, Twicc, and Hawser panes, widgets, settings, and services.
- Configure global settings for projects base path, webapp overlay blur, password handling, plugins, and installed widgets.

## Requirements

- Node.js 22 or newer
- npm
- tmux, for the terminal widget

## Install

```sh
npm install
```

## Run

```sh
npm run dev
```

The app stores local state in Electron's user data directory as `dashtop-state.json` by default.

For local manual testing from this checkout, you can use:

```sh
make run
```

`make run` sets `DASHTOP_STATE_PATH=.dashtop-state.json` so configured projects and layouts stay in the repository working directory. That state file is ignored by git.

## Configuration

Most configuration is available inside the app:

- Global settings: projects base path, presentation blur, password handling, plugin settings, and installed widgets.
- Project settings: identity, source path, git/repository URLs, plugin settings, and additional project URLs.
- Project danger zone: unregisters a project from Dashtop state only.

Set `DASHTOP_STATE_PATH` to force a specific state file.

## Plugin API

Plugins are registered in the renderer through `window.DashtopPluginRegistry.register(manifest, runtime)`.

The manifest must provide a namespaced `id`, `name`, `version`, and `apiVersion`. Contribution ids must be prefixed by the plugin id. Runtime activation receives a `ctx` object with these capabilities:

- `ctx.status.set(status)`: reports plugin state, summary, details, and optional actions.
- `ctx.panes.register(definition)`: contributes project panes. `kind: "wcv"` panes provide `resolveUrl`; `kind: "dom"` panes provide `render`.
- `ctx.widgets.register(definition)`: contributes one or more project widgets through the widget registry.
- `ctx.settings.registerGlobalSection(section)`: contributes global plugin settings. Global settings are edited from the plugin card cog dialog.
- `ctx.settings.registerProjectSection(section)`: contributes project plugin settings in the project settings form.
- `ctx.services.provide(serviceId, implementation)`: exposes a namespaced service callable by Dashtop or other plugins through `DashtopPluginRegistry.getService`.
- `ctx.events.on(eventName, handler)`: listens to core or plugin events and is automatically cleaned up when the plugin is disabled or reloaded.

Plugin settings fields currently support:

- `key`, `label`, `type`, `valueType`, `placeholder`, and `required`.
- `defaultValue`, either a static value or a function receiving `{ project, coreFields }`. If the user leaves the field empty, the default is persisted on save. If the user typed a value, the user value wins.
- `action`, which renders a small field action with `label`, `pendingLabel`, `message`, and async `run({ project, coreFields, fields })`.

Project setting event payloads expose a scoped field API through `event.fields`:

- `getValue(key)`
- `setValue(key, value, options)`
- `isEdited(key)`
- `setDefaultValue(key, value)`
- `setActionVisible(key, visible)`
- `setActionMessage(key, message)`

Core project form events currently emitted:

- `dashtop.projectForm.coreFieldChanged`
- `dashtop.projectForm.sourcePathInspected`

Implemented built-in plugins:

- `dashtop.pier`: Pier URLs widget, Pier preview pane, global/project settings, and service.
- `dashtop.twicc`: Twicc pane, global/project settings, project creation action, and service.
- `dashtop.hawser`: Hawser pane, inbox widget, global/project settings, and service.

## Development

```sh
npm run lint
npm test
```

`npm run lint` performs JavaScript syntax checks with Node. `npm test` runs the store, plugin registry, widget registry, terminal service, Twicc service, Hawser service, and plugin field tests.

The smoke entrypoint is also available:

```sh
npm run smoke
```

## Current Limitations

- Dashtop is still a prototype and has no packaged installer.
- Plugins are local built-ins for now; third-party plugin installation is not implemented yet.
- Plugin APIs are still versioned as `0.1` and can change while the contract is being hardened.
