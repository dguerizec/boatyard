import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const {
  applyDefaultWebAppScrollbarStyle,
  WEBAPP_DEFAULT_SCROLLBAR_CSS
} = require(`${process.cwd()}/build/main/webAppScrollbars`);

test("web app scrollbar styles halve native scrollbar dimensions without forcing precedence", () => {
  assert.match(WEBAPP_DEFAULT_SCROLLBAR_CSS, /width:\s*8px/);
  assert.match(WEBAPP_DEFAULT_SCROLLBAR_CSS, /height:\s*8px/);
  assert.match(WEBAPP_DEFAULT_SCROLLBAR_CSS, /::-webkit-scrollbar-thumb\s*\{[^}]*background-color:/s);
  assert.match(WEBAPP_DEFAULT_SCROLLBAR_CSS, /::-webkit-scrollbar-track[^}]*background:\s*transparent/s);
  assert.doesNotMatch(WEBAPP_DEFAULT_SCROLLBAR_CSS, /!important/);
});

test("Boatyard default scrollbars use the same compact visible treatment", () => {
  const styles = readFileSync(`${process.cwd()}/src/renderer/styles.css`, "utf8");

  assert.match(styles, /::-webkit-scrollbar\s*\{[^}]*width:\s*8px[^}]*height:\s*8px/s);
  assert.match(styles, /::-webkit-scrollbar-thumb\s*\{[^}]*background-color:/s);
  assert.match(styles, /::-webkit-scrollbar-track[^}]*background:\s*transparent/s);
});

test("web app scrollbar styles use user origin so page-authored dimensions win", async () => {
  const calls: Array<[string, { cssOrigin: string }]> = [];
  const webContents = {
    isDestroyed: () => false,
    async insertCSS(css: string, options: { cssOrigin: string }) {
      calls.push([css, options]);
      return "stylesheet-key";
    }
  };

  assert.equal(await applyDefaultWebAppScrollbarStyle(webContents), true);
  assert.deepEqual(calls, [[WEBAPP_DEFAULT_SCROLLBAR_CSS, { cssOrigin: "user" }]]);
});

test("web app scrollbar styles tolerate destroyed or navigating contents", async () => {
  let insertCount = 0;
  const destroyedWebContents = {
    isDestroyed: () => true,
    async insertCSS() {
      insertCount += 1;
      return "stylesheet-key";
    }
  };
  const navigatingWebContents = {
    isDestroyed: () => false,
    async insertCSS() {
      throw new Error("navigation replaced the document");
    }
  };

  assert.equal(await applyDefaultWebAppScrollbarStyle(destroyedWebContents), false);
  assert.equal(insertCount, 0);
  assert.equal(await applyDefaultWebAppScrollbarStyle(navigatingWebContents), false);
});
