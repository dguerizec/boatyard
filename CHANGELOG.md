# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). As a small deviation, each release opens with a one-line **Summary** recapping its highlights, and some entries include illustrative screenshots in nested sub-lists.

## [0.8.5] - 2026-07-08

### Summary

- **v0.8.5: Reliable overlays** — Boatyard keeps dialogs and overlays usable when web apps are active behind them.

### Fixed

- **Overlay dialogs over web apps** — Changelog and other dialogs no longer become hidden behind live web app views while the backdrop blocks the interface.
- **Sidebar hover overlay behavior** — Closing the sidebar hover overlay no longer re-enables web app views that are still covered by another open dialog or tour step.
- **Startup web app visibility** — Web apps that appear while an overlay is already open now stay hidden until the overlay is dismissed.

## [0.8.4] - 2026-07-07

### Summary

- **v0.8.4: Smoother web app reopening** — Boatyard avoids unnecessary reloads when restoring or showing a web app that is already on the requested page.

### Fixed

- **Web app URL sync** — Web apps now keep their URL state aligned without reloading when the active page already matches the requested address.

## [0.8.3] - 2026-07-07

### Summary

- **v0.8.3: Faster project navigation** — Boatyard adds pinned project shortcuts and a collapsible sidebar so project workspaces take less space and stay quicker to reach.

### Added

- **Pinned projects** — Projects can now be pinned from their context menu and opened from shortcut buttons in the top bar.
- **Collapsible sidebar** — The project sidebar can now collapse into a narrow rail and reopen temporarily on hover, focus, or click.
- **Remembered sidebar layout** — Boatyard now restores pinned projects and the sidebar collapsed state across launches.

### Fixed

- **Removed project cleanup** — Deleted projects are now also removed from pinned shortcuts.
- **Sidebar overlay behavior** — Temporary sidebar overlays now avoid interfering with visible web app panes and close after project selection or Escape.

## [0.8.2] - 2026-07-06

### Summary

- **v0.8.2: Smoother pane workspaces** — Boatyard improves split-pane resizing, keeps panes stable across layout changes, and adds mobile viewport tools for development apps.

### Added

- **Mobile viewport mode** — Development web apps can now switch panes into mobile viewport presets for checking smaller layouts.
- **Viewport bookmarks** — Mobile viewport sizes can be saved and reused from pane controls.

### Changed

- **Pane reuse** — Layout-only changes and web app switches now preserve existing panes more often instead of rebuilding them.
- **Splitter feedback** — Split resizers now highlight on hover, making draggable pane dividers easier to spot.
- **Password autofill icon** — Password autofill now uses a clearer key icon.

### Fixed

- **Pane resizing stability** — Split panes now resize more reliably after layout changes and splitter rotation.
- **Narrow pane layouts** — Split panes can shrink further, reducing unwanted layout pressure in tight spaces.
- **Pane action buttons** — Reused panes now keep their action buttons in sync after layout updates.

### Internal

- **Changelog session handling** — Changelog generation no longer persists Codex changelog sessions.
- **Update comparison coverage** — Added regression coverage for version comparison behavior.

## [0.8.1] - 2026-06-26

### Summary

- **v0.8.1: Smarter link opening** — Boatyard refines web app link-opening rules with project-specific pane targets, editable URL patterns, and better handling for modified link clicks.

### Added

- **Project URL opening rules** — Projects can now keep their own saved URL opening rules, including rules that target an existing pane in that project.
- **URL pattern matching** — Saved link-opening rules can now use wildcard URL patterns such as `https://example.com/*`.
- **Modified link clicks** — Ctrl-click, Command-click, and middle-click links inside web apps now route through Boatyard's link-opening flow instead of bypassing it.
- **Rule layout previews** — Existing-pane rules now show a mini pane layout that highlights the source and target panes.

### Changed

- **Open dialog defaults** — When a saved rule matches a link, the open dialog now preselects that rule's target, scope, and pattern.
- **Rule scopes** — URL opening rules now focus on URL patterns and source apps, making saved behavior easier to understand and reuse.
- **Global rule control** — The open dialog now separates saving a rule from applying it globally, while keeping existing-pane rules tied to the current project.

### Fixed

- **Stale pane targets** — Saved rules that point to missing panes are ignored instead of applying to an unavailable destination.
- **Rule editing clarity** — Project-specific and existing-pane rules now preserve pane labels and show clearer source, target, and scope details while editing.

## [0.8.0] - 2026-06-25

### Summary

- **v0.8.0: Web app routing polish** — Boatyard adds finer control over where web app links open, improves split-pane behavior, and polishes settings and web app presentation.

### Added

- **Web app pane targets** — Links from web apps can now be opened directly in an existing pane, with a visual pane picker and optional saved rules for the source pane.

### Changed

- **Split panes** — Splitting a pane now opens the manual in the new pane when available, keeping the current web app in place.
- **Project settings layout** — Project settings now use a denser two-column layout that keeps related controls easier to scan.

### Fixed

- **Custom URL backgrounds** — Custom URL web apps now use a white loading background, reducing dark flashes on light websites.
- **Web app framing** — Embedded web apps are inset slightly so their content fits the pane more cleanly.

### Internal

- **TypeScript migration** — The app, built-in plugins, scripts, and tests were migrated to strict TypeScript with a compiled build pipeline.

## [0.7.4] - 2026-06-23

### Summary

- **v0.7.4: Gauge and changelog polish** — Boatyard improves TwiCC usage visuals and makes changelog version menus easier to read.

### Fixed

- **Twicc burn gauges** — Burn-rate gauges now scale correctly above normal usage and show over-limit usage more clearly.
- **Changelog version menus** — Version dropdown options now use readable colors in the changelog and plugin settings dialogs.

## [0.7.3] - 2026-06-23

### Summary

- **v0.7.3: Overlay freeze polish** — Boatyard improves dialog behavior over embedded web apps so update-era overlays feel steadier and less intrusive.

### Fixed

- **Overlay dialogs over web apps** — Dialogs that freeze overlapping web app content now wait for web app visibility to sync and use the visible dialog content bounds, reducing stale or incorrect freeze areas.

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
