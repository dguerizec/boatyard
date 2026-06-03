# Dashtop

Dashtop is a prototype Electron application that acts as a project cockpit for dashboards, tools, and development workflows.

The prototype now focuses on a clean dashboard shell: a global workspace, a project switcher, and project-scoped panes/widgets. It intentionally avoids the previous "desktop inside a desktop" model.

## Features

- Add projects with a name and preview URL.
- Switch between global and project dashboards.
- Persist configured projects locally across restarts.
- Provide placeholder panes for future widgets such as usage, Hawser, Twicc sessions, terminals, and project previews.

## Requirements

- Node.js 22 or newer
- npm

## Install

```sh
npm install
```

## Run

```sh
make run
```

`make run` stores configured apps and layouts in `.dashtop-state.json` at the
repo root so manual test setups survive restarts. The file is ignored by git.

## Development

```sh
npm run dev
```

The app stores its local state in Electron's user data directory as
`dashtop-state.json` by default. Set `DASHTOP_STATE_PATH` to force a specific
state file.

## Validation

```sh
npm run lint
npm test
```

`npm run lint` performs JavaScript syntax checks with Node. `npm test` runs the store and URL normalization tests.

## Prototype Limitations

- Projects are configured with only a name and preview URL.
- There is no packaged installer yet.
- Runtime widgets are not implemented yet.
- Full-app focus panes for tools such as Twicc or Hermes are not implemented yet.
