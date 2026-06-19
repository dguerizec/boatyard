# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). As a small deviation, each release opens with a one-line **Summary** recapping its highlights, and some entries include illustrative screenshots in nested sub-lists.

## [Unreleased]

### Summary

- **Unreleased: Update and editing polish** — Boatyard adds post-update release notes, improves pane and widget editing feedback, and clarifies Linux install guidance.

### Added

- **What's new after updates** — Boatyard can now show release notes after an update, including highlights from versions you skipped.

### Changed

- **Pane controls** — split, close, navigation, autofill, and widget-pane actions now use clearer icon buttons.
- **Project creation flow** — the source path field now appears first and receives focus so project details can be derived sooner.
- **Widget edit dragging** — moving widgets now shows a better-aligned drop preview, clearer trash dropzone feedback, and calmer inactive tabs.

### Fixed

- **Widget resize feedback** — the active resize border or corner now stays highlighted throughout the resize gesture.
- **What's new dialog filtering** — documentation-only entries and maintainer workflow notes no longer appear in Boatyard's in-app post-update changelog.

### Documentation

- **AppImage install guidance** — Linux users now get clearer README steps for downloading the AppImage, making it executable, first-run setup, and symlink behavior.

### Internal

- **Changelog generation** — `make changelog` now generates structured changelog data for both `CHANGELOG.md` and the in-app What's new dialog.
- **Release workflow** — release preparation now keeps changelog data and app versioning in sync before publishing.
