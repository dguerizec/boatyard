# Contributing

Thanks for taking the time to improve Boatyard.

## Development setup

Requirements:

- Node.js 22 or newer
- npm
- tmux, for the terminal widget

Install dependencies:

```sh
npm install
```

Run the app locally:

```sh
npm run dev
```

For local manual testing with state stored in the checkout:

```sh
make run
```

## Checks

Before opening a pull request, run:

```sh
make check
```

This runs JavaScript syntax checks and the Node test suite.

## Pull requests

Keep changes focused and describe:

- What changed.
- Why the change is needed.
- How it was tested.

For UI changes, include screenshots or a short screen recording when practical.

## Issues

Bug reports are most useful when they include:

- Boatyard version or commit.
- Operating system and architecture.
- Steps to reproduce.
- Expected and actual behavior.
- Relevant logs or screenshots.

Please do not include secrets, tokens, private repository paths, or personal state files in issues.
