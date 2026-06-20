# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). As a small deviation, each release opens with a one-line **Summary** recapping its highlights, and some entries include illustrative screenshots in nested sub-lists.

## [0.5.0] - 2026-06-20

### Summary

- **v0.5.0: Terminal and update polish** — Boatyard improves terminal stability, makes web app overlays less disruptive, and adds easier access to changelog history.

### Added

- **Changelog history** — The update panel now includes a Changelog button for reviewing release notes from inside Boatyard.

### Changed

- **Terminal display** — Embedded terminals now hide the tmux status bar so the terminal area stays cleaner.
- **Web app overlays** — Overlay blur is now off by default, keeping web apps easier to read when dialogs or menus appear.
- **Update status** — Update checks now show clearer checked-at timestamps and keep the latest check result visible in the update panel.

### Fixed

- **Terminal rendering stability** — Terminal panes now resize and refresh more reliably, reducing stale layouts and delayed tab updates.
- **Overlay responsiveness** — Web apps are now frozen only when an overlay actually covers them, avoiding unnecessary interruptions in other panes.
- **What's new tracking** — Post-update release notes now use the stored previous app version instead of relying on restart environment state.

## [0.4.5] - 2026-06-20

### Summary

- **v0.4.5: Update and editing polish** — Boatyard adds post-update release notes, improves pane and widget editing feedback, and clarifies Linux install guidance.

### Added

- **What's new after updates** — Boatyard can now show release notes after an update, including highlights from versions you skipped.

### Changed

- **Pane controls** — Split, close, navigation, autofill, and widget-pane actions now use clearer icon buttons.
- **Project creation flow** — The source path field now appears first and receives focus so project details can be derived sooner.
- **Widget edit dragging** — Moving widgets now shows a better-aligned drop preview, clearer trash dropzone feedback, and calmer inactive tabs.

### Fixed

- **Widget resize feedback** — The active resize border or corner now stays highlighted throughout the resize gesture.
- **What's new filtering** — Documentation-only entries and maintainer workflow notes no longer appear in Boatyard's in-app post-update changelog.

### Documentation

- **AppImage install guidance** — Linux users now get clearer README steps for downloading the AppImage, making it executable, first-run setup, and symlink behavior.

### Internal

- **Changelog generation** — `make changelog` now generates structured changelog data for both `CHANGELOG.md` and the in-app What's new dialog.
- **Release workflow** — Release preparation now keeps changelog data and app versioning in sync before publishing.
