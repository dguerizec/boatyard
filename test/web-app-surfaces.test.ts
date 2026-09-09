"use strict";

export {};

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  constrainCenterToViewport,
  createWebAppSurfaces
} = require(`${process.cwd()}/build/renderer/webAppSurfaces`);

test("dialog centers stay anchored while fitting inside the viewport", () => {
  const dialogSize = { width: 620, height: 500 };
  const viewportSize = { width: 1_200, height: 800 };

  assert.deepEqual(
    constrainCenterToViewport({ x: 600, y: 400 }, dialogSize, viewportSize, 16),
    { x: 600, y: 400 }
  );
  assert.deepEqual(
    constrainCenterToViewport({ x: 1_050, y: 700 }, dialogSize, viewportSize, 16),
    { x: 874, y: 534 }
  );
  assert.deepEqual(
    constrainCenterToViewport({ x: 100, y: 100 }, dialogSize, viewportSize, 16),
    { x: 326, y: 266 }
  );
});

test("oversized dialogs fall back to the viewport center", () => {
  assert.deepEqual(
    constrainCenterToViewport(
      { x: 700, y: 500 },
      { width: 900, height: 700 },
      { width: 800, height: 600 },
      16
    ),
    { x: 400, y: 300 }
  );
});

test("web app surfaces pass project ownership to the main process", async () => {
  const calls: Array<{ action: string; payload?: unknown }> = [];
  const loadedKeys: string[] = [];
  const host = {
    closest() { return null; },
    matches() { return false; },
    getBoundingClientRect() {
      return {
        bottom: 240,
        height: 200,
        left: 10,
        right: 310,
        top: 40,
        width: 300,
        x: 10,
        y: 40
      };
    }
  } as unknown as Element;
  const surfaces = createWebAppSurfaces({
    boatyard: {
      async freezeWebApps() {},
      async restoreWebApps() {}
    },
    getFreezeLayerHost: () => ({}) as HTMLElement,
    getSettings: () => ({}),
    getVisibleWebAppEntries: () => [{
      host,
      webApp: {
        key: "project-alpha:dashboard",
        label: "Alpha dashboard",
        projectId: "alpha",
        url: "https://alpha.example.test/dashboard"
      }
    }],
    async invokeWebApp(action: string, payload?: unknown) {
      calls.push({ action, payload });
    },
    isWebAppAutofillEnabled: () => false,
    markWebAppLoaded: (key: string) => loadedKeys.push(key)
  });

  await surfaces.syncWebAppView();

  assert.deepEqual(calls, [
    {
      action: "showWebApp",
      payload: {
        autofillEnabled: false,
        backgroundColor: undefined,
        bounds: { height: 196, width: 296, x: 12, y: 42 },
        key: "project-alpha:dashboard",
        label: "Alpha dashboard",
        projectId: "alpha",
        restoreUrl: undefined,
        url: "https://alpha.example.test/dashboard"
      }
    },
    { action: "setVisibleWebApps", payload: ["project-alpha:dashboard"] }
  ]);
  assert.deepEqual(loadedKeys, ["project-alpha:dashboard"]);
});

test("native mobile surfaces stay inside their pane after shrinking or scrolling", () => {
  let pane = { x: 16, y: 68, right: 882, bottom: 470 };
  const host = {
    closest: () => ({ getBoundingClientRect: () => pane }),
    getBoundingClientRect: () => ({
      x: 60, y: 140, right: 450, bottom: 695, width: 390, height: 555
    })
  } as unknown as Element;
  const surfaces = createWebAppSurfaces({
    boatyard: { async freezeWebApps() {}, async restoreWebApps() {} },
    getFreezeLayerHost: () => ({}) as HTMLElement,
    getSettings: () => ({}),
    getVisibleWebAppEntries: () => [],
    async invokeWebApp() {},
    isWebAppAutofillEnabled: () => false,
    markWebAppLoaded() {}
  });

  assert.deepEqual(surfaces.getWebAppHostBounds(host), {
    x: 62, y: 142, width: 386, height: 326
  });
  pane = { x: 100, y: 160, right: 300, bottom: 400 };
  assert.deepEqual(surfaces.getWebAppHostBounds(host), {
    x: 102, y: 162, width: 196, height: 236
  });
  pane = { x: 16, y: 68, right: 882, bottom: 130 };
  assert.equal(surfaces.getWebAppHostBounds(host), null);
  // Enlarging the pane restores the requested dimensions without resetting them.
  pane = { x: 16, y: 68, right: 882, bottom: 900 };
  assert.deepEqual(surfaces.getWebAppHostBounds(host), {
    x: 62, y: 142, width: 386, height: 551
  });
});


test("mobile surfaces send requested dimensions separately from visible bounds", async () => {
  const calls: Array<{ action: string; payload?: unknown }> = [];
  const host = {
    matches: () => true,
    closest: () => ({
      getBoundingClientRect: () => ({ x: 0, y: 0, right: 300, bottom: 400 })
    }),
    getBoundingClientRect: () => ({
      x: 0, y: 0, right: 390, bottom: 718, width: 390, height: 718
    })
  } as unknown as Element;
  const surfaces = createWebAppSurfaces({
    boatyard: { async freezeWebApps() {}, async restoreWebApps() {} },
    getFreezeLayerHost: () => ({}) as HTMLElement,
    getSettings: () => ({}),
    getVisibleWebAppEntries: () => [{
      host, webApp: { key: "mobile", url: "https://mobile.example.test" }
    }],
    async invokeWebApp(action: string, payload?: unknown) { calls.push({ action, payload }); },
    isWebAppAutofillEnabled: () => false,
    markWebAppLoaded() {}
  });
  await surfaces.syncWebAppView();
  const payload = calls[0].payload as { bounds: unknown; viewportSize: unknown };
  assert.deepEqual(payload.bounds, { x: 2, y: 2, width: 296, height: 396 });
  assert.deepEqual(payload.viewportSize, { width: 390, height: 718 });
});
