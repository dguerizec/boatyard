import assert from "node:assert/strict";
import test from "node:test";

const {
  createThemeToggle,
  getThemeTogglePresentation,
  normalizeTheme,
  THEME_STORAGE_KEY
} = require(`${process.cwd()}/build/renderer-esm/themeController`);

test("theme values default safely to dark", () => {
  assert.equal(normalizeTheme("light"), "light");
  assert.equal(normalizeTheme("dark"), "dark");
  assert.equal(normalizeTheme("system"), "dark");
  assert.equal(normalizeTheme(null), "dark");
});

test("theme toggle presentation describes the available action", () => {
  assert.deepEqual(
    getThemeTogglePresentation("dark"),
    { icon: "sun", label: "Switch to light theme" }
  );
  assert.deepEqual(
    getThemeTogglePresentation("light"),
    { icon: "moon", label: "Switch to dark theme" }
  );
});

test("theme toggle persists clicks and follows changes from other windows", () => {
  const storedValues = new Map([[THEME_STORAGE_KEY, "light"]]);
  const root = { dataset: {} } as unknown as HTMLElement;
  const attributes = new Map<string, string>();
  let clickListener: (() => void) | null = null;
  let storageListener: ((event: { key: string; newValue: string | null }) => void) | null = null;
  const button = {
    title: "",
    addEventListener(type: string, listener: () => void) {
      if (type === "click") {
        clickListener = listener;
      }
    },
    replaceChildren() {},
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    }
  } as unknown as HTMLButtonElement;
  const storage = {
    getItem(key: string) {
      return storedValues.get(key) || null;
    },
    setItem(key: string, value: string) {
      storedValues.set(key, value);
    }
  };
  const windowObject = {
    addEventListener(type: string, listener: (event: { key: string; newValue: string | null }) => void) {
      if (type === "storage") {
        storageListener = listener;
      }
    }
  } as unknown as Window;

  const toggle = createThemeToggle({
    button,
    createIcon: () => ({}) as SVGElement,
    root,
    storage,
    windowObject
  });

  assert.equal(toggle.getTheme(), "light");
  assert.equal(root.dataset.theme, "light");
  assert.equal(attributes.get("aria-label"), "Switch to dark theme");

  assert.ok(clickListener);
  (clickListener as () => void)();
  assert.equal(toggle.getTheme(), "dark");
  assert.equal(storedValues.get(THEME_STORAGE_KEY), "dark");

  assert.ok(storageListener);
  (storageListener as (event: { key: string; newValue: string | null }) => void)({
    key: THEME_STORAGE_KEY,
    newValue: "light"
  });
  assert.equal(toggle.getTheme(), "light");
  assert.equal(root.dataset.theme, "light");
});
