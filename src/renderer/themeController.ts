export type AppTheme = "dark" | "light";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;

type ThemeToggleOptions = {
  button: HTMLButtonElement;
  createIcon: (name: "moon" | "sun") => SVGElement;
  onThemeChange?: (theme: AppTheme) => unknown;
  root?: HTMLElement;
  storage?: ThemeStorage;
  windowObject?: Window;
};

export const THEME_STORAGE_KEY = "boatyard.theme";

export function normalizeTheme(value: unknown): AppTheme {
  return value === "light" ? "light" : "dark";
}

export function getThemeTogglePresentation(theme: AppTheme) {
  return theme === "dark"
    ? { icon: "sun" as const, label: "Switch to light theme" }
    : { icon: "moon" as const, label: "Switch to dark theme" };
}

function readTheme(storage: ThemeStorage): AppTheme {
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    return "dark";
  }
}

export function createThemeToggle({
  button,
  createIcon,
  onThemeChange,
  root = document.documentElement,
  storage = window.localStorage,
  windowObject = window
}: ThemeToggleOptions) {
  let theme = readTheme(storage);

  function render(nextTheme: AppTheme) {
    theme = nextTheme;
    root.dataset.theme = theme;

    const presentation = getThemeTogglePresentation(theme);
    button.replaceChildren(createIcon(presentation.icon));
    button.setAttribute("aria-label", presentation.label);
    button.title = presentation.label;

    try {
      void Promise.resolve(onThemeChange?.(theme)).catch((error) => {
        console.error("Could not synchronize the application theme:", error);
      });
    } catch (error) {
      console.error("Could not synchronize the application theme:", error);
    }
  }

  function persist(nextTheme: AppTheme) {
    try {
      storage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The selected theme still applies for the current window when storage is unavailable.
    }
  }

  button.addEventListener("click", () => {
    const nextTheme = theme === "dark" ? "light" : "dark";
    render(nextTheme);
    persist(nextTheme);
  });

  windowObject.addEventListener("storage", (event) => {
    if (event.key === THEME_STORAGE_KEY) {
      render(normalizeTheme(event.newValue));
    }
  });

  render(theme);

  return Object.freeze({
    getTheme: () => theme
  });
}
