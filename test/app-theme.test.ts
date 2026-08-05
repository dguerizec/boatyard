import assert from "node:assert/strict";
import test from "node:test";

const {
  createAppThemeManager,
  getAppBackgroundColor,
  getWebAppBackgroundColor,
  normalizeAppTheme
} = require(`${process.cwd()}/build/main/appTheme`);

test("application themes normalize safely and expose matching backgrounds", () => {
  assert.equal(normalizeAppTheme("light"), "light");
  assert.equal(normalizeAppTheme("dark"), "dark");
  assert.equal(normalizeAppTheme("system"), "dark");
  assert.equal(getAppBackgroundColor("light"), "#f4f7f5");
  assert.equal(getAppBackgroundColor("dark"), "#101418");
  assert.equal(getWebAppBackgroundColor(undefined, "light"), "#ffffff");
  assert.equal(getWebAppBackgroundColor(undefined, "dark"), "#0b0f14");
  assert.equal(getWebAppBackgroundColor("#ffffff", "dark"), "#ffffff");
});

test("application theme manager updates Electron and every workspace runtime", () => {
  const nativeTheme = { themeSource: "system" };
  const receivedThemes: string[][] = [[], []];
  const targets = receivedThemes.map((themes) => ({
    setTheme(theme: string) {
      themes.push(theme);
    }
  }));
  const manager = createAppThemeManager({
    getTargets: () => targets,
    nativeTheme
  });

  assert.equal(manager.setTheme("light"), "light");
  assert.equal(manager.getTheme(), "light");
  assert.equal(nativeTheme.themeSource, "light");
  assert.deepEqual(receivedThemes, [["light"], ["light"]]);

  assert.equal(manager.setTheme("unsupported"), "dark");
  assert.equal(nativeTheme.themeSource, "dark");
  assert.deepEqual(receivedThemes, [["light", "dark"], ["light", "dark"]]);
});
