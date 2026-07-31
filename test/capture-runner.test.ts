"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { createCaptureRunner } = require(`${process.cwd()}/build/main/captureRunner`);

test("before-capture actions run after settling and immediately before capture", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-capture-runner-"));
  const requestPath = path.join(tempDir, "request.json");
  const outputPath = path.join(tempDir, "capture.png");
  const requestEnvName = "BOATYARD_TEST_CAPTURE_REQUEST";
  const events: string[] = [];

  fs.writeFileSync(requestPath, JSON.stringify({
    scenario: "global",
    output: outputPath,
    actions: [
      { type: "eval", source: "capture-main-action" }
    ],
    beforeCaptureActions: [
      { type: "eval", source: "capture-last-moment-action" }
    ],
    settleMs: 0
  }));
  process.env[requestEnvName] = requestPath;

  const mainWindow = {
    capturePage: async () => {
      events.push("capture-page");
      return {
        toPNG: () => Buffer.from("capture")
      };
    },
    webContents: {
      executeJavaScript: async (source: string) => {
        if (source.includes("#dashboard-grid")) {
          return true;
        }
        if (source === "capture-main-action") {
          events.push("main-action");
        }
        if (source === "capture-last-moment-action") {
          events.push("last-moment-action");
        }
        return undefined;
      }
    }
  };
  const runner = createCaptureRunner({
    getMainWindow: () => mainWindow,
    quitApp: () => {
      events.push("quit");
    },
    requestEnvName
  });

  try {
    await runner.runCaptureRequest();
    assert.deepEqual(events, [
      "main-action",
      "last-moment-action",
      "capture-page",
      "quit"
    ]);
    assert.equal(fs.readFileSync(outputPath, "utf8"), "capture");
  } finally {
    delete process.env[requestEnvName];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test("capture guards fail without exposing the rejected value", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-capture-guard-"));
  const requestPath = path.join(tempDir, "request.json");
  const requestEnvName = "BOATYARD_TEST_CAPTURE_GUARD_REQUEST";
  let captureCalled = false;

  fs.writeFileSync(requestPath, JSON.stringify({
    scenario: "global",
    output: path.join(tempDir, "capture.png"),
    beforeCaptureActions: [
      {
        type: "assertNoValueMatch",
        selector: ".webapp-url",
        patterns: ["/home/"]
      }
    ],
    settleMs: 0
  }));
  process.env[requestEnvName] = requestPath;

  const mainWindow = {
    capturePage: async () => {
      captureCalled = true;
      return {
        toPNG: () => Buffer.from("capture")
      };
    },
    webContents: {
      executeJavaScript: async (source: string) => {
        if (source.includes("#dashboard-grid")) {
          return true;
        }
        if (source.includes("const violations = []")) {
          return [{ elementIndex: 0, patternIndex: 0 }];
        }
        return undefined;
      }
    }
  };
  const runner = createCaptureRunner({
    getMainWindow: () => mainWindow,
    quitApp: () => undefined,
    requestEnvName
  });

  try {
    await assert.rejects(
      runner.runCaptureRequest(),
      (error: Error) => {
        assert.match(error.message, /Capture guard rejected 1 visible value match.*pattern indexes: 0/);
        assert.doesNotMatch(error.message, /secret-project/);
        return true;
      }
    );
    assert.equal(captureCalled, false);
  } finally {
    delete process.env[requestEnvName];
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

export {};
