import type { NativeTheme } from "electron";

export type AppTheme = "dark" | "light";

type AppThemeTarget = {
  setTheme(theme: AppTheme): void;
};

type AppThemeManagerOptions = {
  getTargets: () => AppThemeTarget[];
  nativeTheme: Pick<NativeTheme, "themeSource">;
};

const DARK_APP_BACKGROUND_COLOR = "#101418";
const LIGHT_APP_BACKGROUND_COLOR = "#f4f7f5";
const DARK_WEBAPP_BACKGROUND_COLOR = "#0b0f14";
const LIGHT_WEBAPP_BACKGROUND_COLOR = "#ffffff";

export function normalizeAppTheme(value: unknown): AppTheme {
  return value === "light" ? "light" : "dark";
}

export function getAppBackgroundColor(theme: unknown): string {
  return normalizeAppTheme(theme) === "light"
    ? LIGHT_APP_BACKGROUND_COLOR
    : DARK_APP_BACKGROUND_COLOR;
}

export function getWebAppBackgroundColor(backgroundColor: unknown, theme: unknown): string {
  if (backgroundColor === "#ffffff") {
    return LIGHT_WEBAPP_BACKGROUND_COLOR;
  }
  return normalizeAppTheme(theme) === "light"
    ? LIGHT_WEBAPP_BACKGROUND_COLOR
    : DARK_WEBAPP_BACKGROUND_COLOR;
}

export function createAppThemeManager({ getTargets, nativeTheme }: AppThemeManagerOptions) {
  let theme: AppTheme = "dark";

  function setTheme(value: unknown): AppTheme {
    theme = normalizeAppTheme(value);
    nativeTheme.themeSource = theme;
    for (const target of getTargets()) {
      target.setTheme(theme);
    }
    return theme;
  }

  return Object.freeze({
    getTheme: () => theme,
    setTheme
  });
}
