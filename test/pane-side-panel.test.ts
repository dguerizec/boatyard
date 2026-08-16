"use strict";

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  clampPaneSidePanelWidth,
  getPaneSidePanelStorageKey,
  normalizePaneSidePanel,
  resizePaneSidePanelWidth
} = require(`${process.cwd()}/build/renderer/paneSidePanel`);

test("pane side panel defaults are usable for a resizable WCV companion", () => {
  assert.deepEqual(normalizePaneSidePanel({ title: "Sessions" }), {
    defaultOpen: true,
    defaultWidth: 360,
    maxWidth: 720,
    minMainWidth: 360,
    minWidth: 280,
    position: "left",
    title: "Sessions"
  });
  assert.equal(normalizePaneSidePanel(null), null);
});

test("pane side panel width preserves the main WCV minimum", () => {
  const sidePanel = normalizePaneSidePanel({
    defaultWidth: 360,
    maxWidth: 720,
    minMainWidth: 360,
    minWidth: 280
  });

  assert.equal(clampPaneSidePanelWidth(500, 800, sidePanel), 440);
  assert.equal(clampPaneSidePanelWidth(120, 800, sidePanel), 280);
  assert.equal(clampPaneSidePanelWidth(360, 500, sidePanel), 140);
});

test("pane side panel drag direction follows its configured edge", () => {
  const sidePanel = normalizePaneSidePanel({ minMainWidth: 320 });
  const common = {
    clientX: 140,
    containerWidth: 1000,
    sidePanel,
    startClientX: 100,
    startWidth: 360
  };

  assert.equal(resizePaneSidePanelWidth({ ...common, position: "left" }), 400);
  assert.equal(resizePaneSidePanelWidth({ ...common, position: "right" }), 320);
});

test("pane side panel persistence is isolated by project and pane webapp key", () => {
  assert.notEqual(
    getPaneSidePanelStorageKey("project-a", "pane-1:twicc"),
    getPaneSidePanelStorageKey("project-b", "pane-1:twicc")
  );
  assert.notEqual(
    getPaneSidePanelStorageKey("project-a", "pane-1:twicc"),
    getPaneSidePanelStorageKey("project-a", "pane-2:twicc")
  );
});

test("pane side panels use a nested WCV viewport and a thin draggable boundary", () => {
  const view = readFileSync(`${process.cwd()}/src/renderer/paneLayoutView.ts`, "utf8");
  const styles = readFileSync(`${process.cwd()}/src/renderer/styles.css`, "utf8");

  assert.match(view, /pluginPane\.renderSidePanel\(sidePanelLayout\.panel, pluginPaneProps\)/);
  assert.match(view, /visibleHost\.dataset\.webappViewport = "true"/);
  assert.match(view, /querySelector<HTMLElement>\("\[data-webapp-viewport=/);
  assert.match(view, /syncPaneSidePanelLayout\?\.\(\)/);
  assert.match(styles, /\.webapp-side-panel-separator\s*\{[^}]*width:\s*1px;[^}]*cursor:\s*ew-resize;/s);
  assert.match(styles, /\.webapp-side-panel-separator::before\s*\{[^}]*inset:\s*0 -4px;/s);
});
