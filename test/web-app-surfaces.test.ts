"use strict";

export {};

const assert = require("node:assert/strict");
const test = require("node:test");
const { createWebAppSurfaces } = require(`${process.cwd()}/build/renderer/webAppSurfaces`);

test("web app surfaces pass project ownership to the main process", async () => {
  const calls: Array<{ action: string; payload?: unknown }> = [];
  const loadedKeys: string[] = [];
  const host = {
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
  } as Element;
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
