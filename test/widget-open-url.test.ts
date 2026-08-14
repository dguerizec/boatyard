"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { createWidgetOpenUrlPayload } = require(`${process.cwd()}/build/renderer/widgetOpenUrl`);
const { createWidgetOverlayController } = require(`${process.cwd()}/build/renderer/widgetOverlay`);

test("widget URL requests carry their existing pane context into the shared dialog", () => {
  const pane = {
    dataset: {
      paneId: "pane-widgets",
      webAppId: "widgets:default"
    }
  };
  const sourceElement = {
    closest: (selector: string) => selector === ".webapp-pane" ? pane : null,
    getBoundingClientRect: () => ({
      height: 24,
      width: 96,
      x: 120,
      y: 80
    })
  };

  assert.deepEqual(createWidgetOpenUrlPayload({
    sourceElement,
    url: "http://develop.pickatube.test",
    widgetId: "boatyard.pier.urls",
    widgetName: "Pier"
  }), {
    source: "explicit",
    sourceBounds: {
      height: 24,
      width: 96,
      x: 120,
      y: 80
    },
    sourceId: "widget:boatyard.pier.urls",
    sourceLabel: "Pier",
    sourcePaneId: "pane-widgets",
    sourcePaneWebAppId: "widgets:default",
    url: "http://develop.pickatube.test"
  });
});

test("widget overlays freeze WCVs intersecting their rendered bounds", async () => {
  const calls: unknown[] = [];
  const rect = { height: 140, width: 210, x: 320, y: 180 };
  const controller = createWidgetOverlayController({
    freezeForMainRect: async (bounds: unknown, options: unknown) => {
      calls.push(["freeze", bounds, options]);
    },
    restore: async () => {
      calls.push(["restore"]);
    }
  });

  await controller.freeze({
    getBoundingClientRect: () => rect
  }, { margin: 8 });
  await controller.restore();

  assert.deepEqual(calls, [
    ["freeze", rect, { margin: 8 }],
    ["restore"]
  ]);
});

export {};
