# Dashtop

Dashtop is a prototype Electron application that acts as a desktop for dashboards and other important websites.

The prototype displays configured apps and sites in a desktop-like workspace with movable and resizable internal windows. Each app window renders its URL through an Electron `WebContentsView`; the renderer process only draws the Dashtop shell, window chrome, and configuration UI.

## Features

- Add apps with a name and URL.
- Move and resize app windows inside the main Dashtop window.
- Close app windows without deleting their configuration.
- Reopen or remove configured apps from the app panel.
- Persist configured apps and window layouts locally across restarts.

## Requirements

- Node.js 22 or newer
- npm

## Install

```sh
npm install
```

## Run

```sh
npm start
```

## Development

```sh
npm run dev
```

The app stores its local state in Electron's user data directory as `dashtop-state.json`.

## Validation

```sh
npm run lint
npm test
```

`npm run lint` performs JavaScript syntax checks with Node. `npm test` runs the store and URL normalization tests.

## Prototype Limitations

- Apps are configured with only a name and URL.
- There is no packaged installer yet.
- Some websites may block embedding, require authentication flows, or restrict behavior through their own headers and policies.
- Window chrome is rendered by the Dashtop shell while page content is rendered by separate `WebContentsView` instances.
