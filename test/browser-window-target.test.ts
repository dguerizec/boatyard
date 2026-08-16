import assert from "node:assert/strict";
import test from "node:test";
import { getLiveWindowWebContents } from "../src/main/browserWindowTarget.js";

test("destroyed browser windows are rejected without accessing webContents", () => {
  let webContentsAccesses = 0;
  const window = {
    isDestroyed: () => true,
    get webContents(): never {
      webContentsAccesses += 1;
      throw new Error("Object has been destroyed");
    }
  };

  assert.equal(getLiveWindowWebContents(window), null);
  assert.equal(webContentsAccesses, 0);
});

test("browser windows expose only live renderer contents", () => {
  const liveWebContents = {
    isDestroyed: () => false,
    send() {}
  };
  const destroyedWebContents = {
    isDestroyed: () => true,
    send() {}
  };

  assert.equal(getLiveWindowWebContents({
    isDestroyed: () => false,
    webContents: liveWebContents
  }), liveWebContents);
  assert.equal(getLiveWindowWebContents({
    isDestroyed: () => false,
    webContents: destroyedWebContents
  }), null);
});
