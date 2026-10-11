import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { runBrowserTest } from "./helpers/browser";

test("WebRTC sends the composed Boatyard window, crops video and routes native input", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-access.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: process.env.BOATYARD_REMOTE_FIXTURE_ICE_FILE ? 90000 : 45000
  });
});


test("read-only remote access streams and crops while rejecting host input", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-readonly.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("native window chrome is excluded from video and pointer coordinates at every crop", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-menu.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("local input forces Remote to follow while an idle or unrelated viewer cannot interfere", t => {
  if (process.platform !== "linux" || ["xdotool", "xvfb-run"].some(command => spawnSync("which", [command]).status !== 0)) {
    t.skip("Local input coverage requires Linux, xdotool and an isolated Xvfb display"); return;
  }
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-input-handover.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("zoom removes Fit letterboxing and Fill covers portrait and landscape viewers", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-camera.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

for (const readOnly of [false, true]) test(`two-finger pan and zoom stream during continuous movement in ${readOnly ? "Share" : "Remote"}`, t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: readOnly ? "test/fixtures/remote-gesture-readonly.main.cjs" : "test/fixtures/remote-gesture.main.cjs",
    preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});


for (const readOnly of [false, true]) test(`follow mouse tracks the physical host pointer in ${readOnly ? "read-only" : "full"} mode without sending viewer input`, t => {
  if (process.platform !== "linux" || ["xdotool", "xvfb-run"].some(command => spawnSync("which", [command]).status !== 0)) {
    t.skip("Physical pointer coverage requires Linux, xdotool and an isolated Xvfb display"); return;
  }
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: readOnly ? "test/fixtures/remote-follow-readonly.main.cjs" : "test/fixtures/remote-follow.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("two Share viewers keep independent crops alongside Remote and revoke independently", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-clients.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("TURN credential renewal restarts ICE on both peers without replacing the session", async t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-renewal.main.cjs", preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

for (const readOnly of [false, true]) test(`persistent video delay remains observable without transport replacement in ${readOnly ? "Share" : "Remote"}`, t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: readOnly ? "test/fixtures/remote-recovery-readonly.main.cjs" : "test/fixtures/remote-recovery.main.cjs",
    preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});

test("an interrupted Share transport recovers without losing host moderation", t => {
  runBrowserTest(t, "test/fixtures/remote-access.browser.js", {
    main: "test/fixtures/remote-recovery-interrupted.main.cjs",
    preload: "test/fixtures/remote-access.preload.cjs", timeoutMs: 45000
  });
});
