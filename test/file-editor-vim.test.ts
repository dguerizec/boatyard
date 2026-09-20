import assert from "node:assert/strict";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buildSync } from "esbuild";

test("Vim editing, pane toolbar, persistence, and save/history ownership in Electron", (t) => {
  const xvfb = process.platform === "linux" && spawnSync("which", ["xvfb-run"]).status === 0;
  if (process.platform === "linux" && !xvfb && !process.env.DISPLAY) {
    t.skip("Electron requires DISPLAY or xvfb-run");
    return;
  }
  const directory = mkdtempSync(join(tmpdir(), "boatyard-vim-test-"));
  try {
    buildSync({ entryPoints: [resolve("test/fixtures/file-editor-vim.browser.js")], bundle: true,
      format: "esm", outfile: join(directory, "browser.js"), logLevel: "silent" });
    writeFileSync(join(directory, "index.html"), '<!doctype html><script type="module" src="browser.js"></script>');
    const electron = require("electron") as string;
    writeFileSync(join(directory, "main.cjs"), `
      const { app, BrowserWindow } = require("electron");
      app.setPath('userData', ${JSON.stringify(join(directory, "profile"))});
      app.whenReady().then(async () => {
        const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true } });
        win.webContents.on('console-message', (event) => { console.log(event.message); if (event.level === 'error') app.exit(1); });
        await win.loadFile(${JSON.stringify(join(directory, "index.html"))});
        const timer = setInterval(async () => {
          if (await win.webContents.executeJavaScript('window.vimTestResult === "passed"')) {
            clearInterval(timer); console.log('VIM_TEST_PASSED'); app.exit(0);
          }
        }, 50);
        setTimeout(() => { console.error('Vim browser test timed out'); app.exit(1); }, 15000);
      }).catch(error => { console.error(error); app.exit(1); });
    `);
    const args = [join(directory, "main.cjs"), "--no-sandbox"];
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const result = spawnSync(xvfb ? "xvfb-run" : electron, xvfb ? ["-a", electron, ...args] : args,
      { env, encoding: "utf8", timeout: 25000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /VIM_TEST_PASSED/);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
