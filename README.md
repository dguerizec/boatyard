# Dashtop

Dashtop is an Electron project cockpit for dashboards, web tools, and local development workflows.

It is organized around a global workspace, a project switcher, project-scoped widgets, and project-scoped webapp panes. The app intentionally stays closer to a dashboard/workbench than to a "desktop inside a desktop".

## Features

- Register projects with source path, git/repository URLs, preview URL, Twicc URL, Hawser main session, and custom provider URLs.
- Reorder projects in the sidebar and unregister projects from Dashtop without deleting files on disk.
- Persist app state across restarts, including the last active page, window bounds, widget layouts, pane splits, loaded webapp URLs, and widget rail width.
- Open project webapps in Electron `WebContentsView` panes with navigation controls, editable URL bar, tab picker, split panes, close panes, and persisted pane layouts.
- Manage a freeform widget grid with lock/unlock, drag-and-drop placement, resize handles, trash dropzone, and opt-in widget installation per project.
- Use built-in project widgets for project summary, persistent tmux terminal tabs, Hawser inbox/task status, and placeholder integrations.
- Configure global settings for projects base path, webapp overlay blur, Hawser API URL/token, and installed widget registry.

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

- Global settings: projects base path, presentation blur, Hawser API settings, and installed widgets.
- Project settings: identity, source path, git/repository URLs, preview URL, Twicc URL, Hawser session, and additional project URLs.
- Project danger zone: unregisters a project from Dashtop state only.

Set `DASHTOP_STATE_PATH` to force a specific state file.

## Development

```sh
npm run lint
npm test
```

`npm run lint` performs JavaScript syntax checks with Node. `npm test` runs the store, widget registry, terminal service, and Hawser service tests.

The smoke entrypoint is also available:

```sh
npm run smoke
```

## Current Limitations

- Dashtop is still a prototype and has no packaged installer.
- Widget plugins are local built-ins for now; third-party widget installation is not implemented yet.
- Hawser integration is read-only and requires an API URL/token configured in global settings.
