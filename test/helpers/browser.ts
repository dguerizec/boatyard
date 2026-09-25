import assert from "node:assert/strict";
import type { TestContext } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";

export function runBrowserTest(t: TestContext, fixture: string, native?: { main: string; preload: string }) {
  const xvfb = process.platform === "linux" && spawnSync("which", ["xvfb-run"]).status === 0;
  if (process.platform === "linux" && !xvfb && !process.env.DISPLAY) {
    t.skip("Electron requires DISPLAY or xvfb-run");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "boatyard-browser-test-"));
  try {
    buildSync({ entryPoints: [resolve(fixture)], bundle: true,
      format: "esm", loader: { ".png": "dataurl" }, outfile: join(directory, "browser.js"), logLevel: "silent" });
    const stylesheet = existsSync(join(directory, "browser.css")) ? '<link rel="stylesheet" href="browser.css">' : '';
    writeFileSync(join(directory, "index.html"), `<!doctype html>${stylesheet}<script type="module" src="browser.js"></script>`);
    const electron = require("electron") as string;
    writeFileSync(join(directory, "main.cjs"), `
      const { app, BrowserWindow } = require("electron");
      app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
      app.whenReady().then(async () => {
        // Hidden test windows still need animation frames for editor layout measurements.
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, backgroundThrottling: false,
          ${native ? `preload: ${JSON.stringify(resolve(native.preload))}` : ""} } });
        ${native ? `await require(${JSON.stringify(resolve(native.main))})(win);` : ""}
        win.webContents.on('console-message', (event) => { console.log(event.message); if (event.level === 'error') app.exit(1); });
        await win.loadFile(${JSON.stringify(join(directory, "index.html"))});
        const timer = setInterval(async () => {
          if (await win.webContents.executeJavaScript('window.browserTestResult === "passed"')) {
            clearInterval(timer); console.log('BROWSER_TEST_PASSED'); app.exit(0);
          }
        }, 50);
        setTimeout(() => { console.error('Browser test timed out'); app.exit(1); }, 15000);
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    const args = [join(directory, "main.cjs"), "--no-sandbox"];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(xvfb ? "xvfb-run" : electron, xvfb ? ["-a", electron, ...args] : args,
      { env, encoding: "utf8", timeout: 25000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /BROWSER_TEST_PASSED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
