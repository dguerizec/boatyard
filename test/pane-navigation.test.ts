"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const test = require("node:test");
const {
  isPaneNavigationItemActive,
  shouldHidePaneBrowserControls,
  shouldUseCompactPaneBrowserControls
} = require(`${process.cwd()}/build/renderer/paneNavigation`);

test("pane navigation uses compact browser controls when the address bar is hidden", () => {
  assert.equal(shouldUseCompactPaneBrowserControls({
    items: [{ id: "overview", label: "Overview" }],
    showAddressBar: false
  }), true);
  assert.equal(shouldUseCompactPaneBrowserControls({
    items: [{ id: "overview", label: "Overview" }],
    showAddressBar: true
  }), false);
  assert.equal(shouldUseCompactPaneBrowserControls({
    browserControls: "compact",
    items: [],
    showAddressBar: true
  }), true);
  assert.equal(shouldHidePaneBrowserControls({
    browserControls: "hidden",
    items: []
  }), true);
  assert.equal(shouldUseCompactPaneBrowserControls(undefined), false);
});

test("compact browser controls overlay preserves primary and secondary navigation actions", () => {
  const view = readFileSync(`${process.cwd()}/src/renderer/paneLayoutView.ts`, "utf8");
  const menus = readFileSync(`${process.cwd()}/src/renderer/webAppMenus.ts`, "utf8");
  const renderer = readFileSync(`${process.cwd()}/src/renderer/renderer.ts`, "utf8");
  const styles = readFileSync(`${process.cwd()}/src/renderer/styles.css`, "utf8");

  assert.match(view, /compactBrowserControlsButton\.disabled = isDomPane/);
  assert.match(view, /compactBrowserControlsOverlay\.append\([\s\S]*?\.\.\.browserControlButtons,[\s\S]*?showAddressBar/);
  assert.match(view, /button\.addEventListener\("click", \(\) => closeCompactBrowserControls\(\)\)/);
  assert.match(view, /event\.key !== "Escape" \|\| isWebAppTabMenuOpen\(\)/);
  assert.match(view, /target\.closest\("\.webapp-tab-menu"\)/);
  assert.match(view, /openWebAppNavigationHistoryMenu\([\s\S]*?useCompactBrowserControls \? closeCompactBrowserControls : undefined/);
  assert.match(view, /openWebAppRefreshMenu\([\s\S]*?useCompactBrowserControls \? closeCompactBrowserControls : undefined/);
  assert.match(menus, /closeWebAppTabMenu\(\);\s*onAction\?\.\(\);\s*invokeWebApp\("navigateWebApp", selectedWebApp\.key, "history-index"/);
  assert.match(menus, /closeWebAppTabMenu\(\);\s*onAction\?\.\(\);\s*invokeWebApp\("navigateWebApp", selectedWebApp\.key, "hard-refresh"/);
  assert.match(menus, /menu\.className = "webapp-tab-menu webapp-navigation-history-menu"/);
  assert.match(renderer, /webAppMenus\.openWebAppNavigationHistoryMenu\(event, selectedWebApp, direction, onAction\)/);
  assert.match(renderer, /webAppMenus\.openWebAppRefreshMenu\(event, selectedWebApp, onAction\)/);
  assert.match(view, /const availableWidth = tabs\.getBoundingClientRect\(\)\.right\s*- compactBrowserControlsOverlay\.getBoundingClientRect\(\)\.left/);
  assert.match(view, /compactBrowserControlsOverlay\.style\.maxWidth = `\$\{Math\.max\(0, availableWidth\)\}px`/);
  assert.match(view, /compactBrowserControlsResizeObserver = new ResizeObserver\(syncCompactBrowserControlsWidth\)/);
  assert.match(styles, /\.webapp-browser-controls-overlay\s*\{[^}]*position:\s*absolute;[^}]*top:\s*0;[^}]*height:\s*32px;[^}]*box-sizing:\s*border-box;/s);
  assert.match(styles, /\.webapp-browser-controls-overlay\s*\{[^}]*overflow-x:\s*auto;[^}]*overflow-y:\s*hidden;[^}]*scrollbar-width:\s*none;/s);
  assert.match(styles, /\.webapp-browser-controls-overlay::\-webkit-scrollbar\s*\{[^}]*display:\s*none;/s);
  assert.match(styles, /\.webapp-browser-controls-overlay \.webapp-tool-button\s*\{[^}]*height:\s*28px;[^}]*min-height:\s*28px;/s);
  assert.match(styles, /\.webapp-browser-controls-overlay \.webapp-url\s*\{[^}]*height:\s*28px;/s);
  assert.match(styles, /\.webapp-navigation-history-menu \.webapp-tab-menu-item\s*\{[^}]*height:\s*26px;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/s);
});

test("pane navigation keeps provider route matching outside the core", () => {
  const item = {
    activeUrlPatterns: ["^https://example\\.test/project/(?:issues|issue)(?:/|$)"],
    id: "issues",
    label: "Issues",
    url: "https://example.test/project/issues",
    webAppId: "vendor.repository"
  };

  assert.equal(isPaneNavigationItemActive(
    item,
    "vendor.repository",
    "https://example.test/project/issues/42"
  ), true);
  assert.equal(isPaneNavigationItemActive(
    item,
    "vendor.repository",
    "https://example.test/project/actions"
  ), false);
  assert.equal(isPaneNavigationItemActive(
    item,
    "vendor.overview",
    "https://example.test/project/issues"
  ), false);
});

test("pane navigation supports exact URL and DOM-surface destinations", () => {
  assert.equal(isPaneNavigationItemActive({
    id: "code",
    label: "Code",
    url: "https://example.test/project/",
    webAppId: "vendor.repository"
  }, "vendor.repository", "https://example.test/project"), true);

  assert.equal(isPaneNavigationItemActive({
    id: "overview",
    label: "Overview",
    webAppId: "vendor.overview"
  }, "vendor.overview", ""), true);
});

export {};
