# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). As a small deviation, each release opens with a one-line **Summary** recapping its highlights, and some entries include illustrative screenshots in nested sub-lists.

## [0.7.2] - 2026-06-23

### Summary

- **v0.7.2: Pier worktree controls** — Boatyard adds hands-on Pier worktree management and polishes pane controls and overlay behavior.

### Added

- **Pier worktree creation** — Create a new Pier worktree from the Pier widget, with branch, base ref, path, and start-after-create options.
- **Pier worktree removal** — Remove Pier worktrees from the widget, with confirmation options for forced removal and snapshot purging.
- **Worktree path pattern** — Configure the default Pier worktree path using project, repository, and worktree tokens.

### Changed

- **Pier widget actions** — The Pier widget now groups New and Refresh controls in the header and shows per-worktree removal controls.
- **Widget titles** — Project widgets use more consistent, compact title styling across Pier, terminal, Hawser, Telegram, and color palette widgets.
- **Pane expansion controls** — Hovering or focusing the expand control now previews the pane group that will expand, and active shrink controls are easier to recognize.

### Fixed

- **Overlay dialogs over web apps** — Settings, changelog, group, and URL dialogs now freeze overlapping web app content more consistently to prevent embedded views from interfering with dialogs.

## [0.7.1] - 2026-06-22

### Summary

- **v0.7.1: Terminal tab controls** — Boatyard makes terminal shell tabs easier to manage, scroll, and organize in pane layouts.

### Added

- **Terminal tab context menu** — Right-click a shell tab to rename it, open a new shell to its right, or close it.
- **Scrollable shell tabs** — Terminal tab bars now support horizontal scrolling with arrow controls and mouse wheel gestures when many shells are open.

### Changed

- **New shell placement** — Creating a shell from a terminal pane now places it next to the active shell instead of always appending it at the end.
- **Pane terminal tabs** — Terminal panes now keep shell tabs in the pane tab area, making multi-pane terminal layouts easier to scan.
- **Shell closing flow** — Closing a shell now happens from the tab menu, with the close action disabled when only one shell remains.

## [0.7.0] - 2026-06-22

### Summary

- **v0.7.0: Pane focus controls** — Boatyard adds quick pane expansion controls so multi-pane web app layouts are easier to focus and restore.

### Added

- **Pane expand and shrink controls** — Web app panes now include toolbar buttons for temporarily focusing one pane and returning to the previous split layout.
- **Remembered pane focus** — Expanded pane state is now saved with the project layout, so focused panes stay consistent after the workspace reloads.

## [0.6.1] - 2026-06-21

### Summary

- **v0.6.1: Sidebar workflow polish** — Boatyard makes project navigation easier to search and organize, while surfacing ready-to-install updates directly in the sidebar.

### Added

- **Project search** — The sidebar can now filter projects by name, slug, source path, or group.
- **Create group from project** — Project rows now offer a context menu action for creating a new group around that project.
- **Sidebar update notice** — Downloaded updates now appear in the sidebar with a restart button when they are ready to install.
- **Web app hard reload** — Web app panes now offer a hard reload action that clears cache before refreshing.

### Changed

- **Group explode confirmation** — Exploding a project group now uses a simpler confirmation dialog without requiring the group name to be typed.
- **Grouped project badges** — Collapsed groups now show separate status badges for their projects instead of merging everything into one combined badge.

## [0.6.0] - 2026-06-20

### Summary

- **v0.6.0: Project group organization** — Boatyard adds collapsible project groups with smoother sidebar organization, drag-and-drop, and group management controls.

### Added

- **Project groups** — Projects can now be assigned to named groups and collapsed in the sidebar.
- **Group management menu** — Project groups can be renamed or exploded from a context menu without editing each project one by one.

### Changed

- **Project sidebar dragging** — Dragging projects now shows insertion targets and supports moving projects into, out of, and between groups.
- **Expanded group layout** — Expanded groups now use a compact rail for collapsing and dragging while keeping project rows easy to scan.
- **AppImage launcher path** — AppImage installs now consistently use `~/.local/bin/boatyard` for the terminal launcher.

### Fixed

- **Terminal status display** — Terminal panes no longer show diagnostic chunk counters in the status line.

### Documentation

- **AppImage setup** — The README now links to the hosted documentation and clarifies how to launch Boatyard after AppImage setup.

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
