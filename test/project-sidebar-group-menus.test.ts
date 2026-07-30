"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  createProjectSidebarGroupMenus
} = require(`${process.cwd()}/build/renderer/projectSidebarGroupMenus`);

class FakeElement {
  className = "";
  disabled = false;
  style: Record<string, string> = {};
  textContent = "";
  type = "";

  addEventListener() {}

  append() {}

  focus() {}

  querySelector() {
    return new FakeElement();
  }

  remove() {}

  setAttribute() {}
}

test("project context menus do not bubble into the top bar context menu", async () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const fakeDocument = {
    body: new FakeElement(),
    createElement: () => new FakeElement(),
    addEventListener() {},
    removeEventListener() {}
  };

  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: fakeDocument
  });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      innerHeight: 720,
      innerWidth: 1280
    }
  });

  let defaultPrevented = false;
  let propagationStopped = false;

  try {
    const menus = createProjectSidebarGroupMenus({
      applyFormControl() {},
      clamp: (value: number, min: number, max: number) => Math.min(max, Math.max(min, value)),
      createProjectGroupForProject: async () => undefined,
      explodeProjectGroup: async () => undefined,
      isProjectPinned: () => true,
      setProjectPinned: async () => undefined,
      showOverlayDialog: async () => false,
      updateProjectGroupName: async () => undefined
    });

    menus.openProjectContextMenu({
      clientX: 100,
      clientY: 40,
      preventDefault() {
        defaultPrevented = true;
      },
      stopPropagation() {
        propagationStopped = true;
      }
    }, {
      id: "project-1",
      name: "Project"
    });

    assert.equal(defaultPrevented, true);
    assert.equal(propagationStopped, true);
    await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: originalDocument
    });
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: originalWindow
    });
  }
});

export {};
