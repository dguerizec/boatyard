"use strict";

(function registerColorPalettePlugin(globalScope) {
  type ColorPaletteColor = {
    r: number;
    g: number;
    b: number;
    a?: number;
  };

  type ColorPaletteProject = {
    id?: string;
    slug?: string;
  };

  type ColorPaletteGlobal = Window & {
    BoatyardPluginRegistry?: any;
    boatyard?: {
      writeClipboardText?: (value: string) => Promise<unknown>;
    };
  };

  const typedGlobalScope = globalScope as unknown as ColorPaletteGlobal;
  const registry = typedGlobalScope.BoatyardPluginRegistry;
  const DEFAULT_COLOR = "#41b883";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function toHexByte(value) {
    return clamp(Math.round(value), 0, 255).toString(16).padStart(2, "0");
  }

  function normalizeAlpha(value) {
    const alpha = Number(value);
    return Number.isFinite(alpha) ? clamp(alpha, 0, 1) : 1;
  }

  function normalizeColor(color: ColorPaletteColor) {
    return {
      r: clamp(Math.round(color.r), 0, 255),
      g: clamp(Math.round(color.g), 0, 255),
      b: clamp(Math.round(color.b), 0, 255),
      a: normalizeAlpha(color.a)
    };
  }

  function parseHexColor(value) {
    const match = String(value || "").trim().match(/^#?([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (!match) {
      return null;
    }

    const hex = match[1];
    if (hex.length === 3 || hex.length === 4) {
      return normalizeColor({
        r: parseInt(`${hex[0]}${hex[0]}`, 16),
        g: parseInt(`${hex[1]}${hex[1]}`, 16),
        b: parseInt(`${hex[2]}${hex[2]}`, 16),
        a: hex.length === 4 ? parseInt(`${hex[3]}${hex[3]}`, 16) / 255 : 1
      });
    }

    return normalizeColor({
      r: parseInt(hex.slice(0, 2), 16),
      g: parseInt(hex.slice(2, 4), 16),
      b: parseInt(hex.slice(4, 6), 16),
      a: hex.length === 8 ? parseInt(hex.slice(6, 8), 16) / 255 : 1
    });
  }

  function parseRgbColor(value) {
    const match = String(value || "").trim().match(
      /^rgba?\(\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)\s*,\s*([+-]?\d+(?:\.\d+)?)(?:\s*,\s*([+-]?\d*(?:\.\d+)?))?\s*\)$/i
    );
    if (!match) {
      return null;
    }

    return normalizeColor({
      r: Number(match[1]),
      g: Number(match[2]),
      b: Number(match[3]),
      a: match[4] === undefined || match[4] === "" ? 1 : Number(match[4])
    });
  }

  function parseColor(value) {
    return parseHexColor(value) || parseRgbColor(value);
  }

  function formatHex(color) {
    const normalized = normalizeColor(color);
    const base = `#${toHexByte(normalized.r)}${toHexByte(normalized.g)}${toHexByte(normalized.b)}`;
    return normalized.a < 1 ? `${base}${toHexByte(normalized.a * 255)}` : base;
  }

  function formatOpaqueHex(color) {
    const normalized = normalizeColor(color);
    return `#${toHexByte(normalized.r)}${toHexByte(normalized.g)}${toHexByte(normalized.b)}`;
  }

  function formatRgb(color) {
    const normalized = normalizeColor(color);
    return normalized.a < 1
      ? `rgba(${normalized.r}, ${normalized.g}, ${normalized.b}, ${Number(normalized.a.toFixed(3))})`
      : `rgb(${normalized.r}, ${normalized.g}, ${normalized.b})`;
  }

  function getStorageKey(project: ColorPaletteProject = {}) {
    return `boatyard:color-palette:${String(project.id || project.slug || "project")}`;
  }

  function loadFavorites(project) {
    try {
      const parsed = JSON.parse(globalScope.localStorage?.getItem(getStorageKey(project)) || "[]");
      return Array.isArray(parsed)
        ? parsed.map((item) => formatHex(parseColor(item) || parseColor(DEFAULT_COLOR))).filter(Boolean)
        : [];
    } catch {
      return [];
    }
  }

  function saveFavorites(project, favorites) {
    try {
      globalScope.localStorage?.setItem(getStorageKey(project), JSON.stringify(favorites));
    } catch {
      // Ignore unavailable storage; the widget still works for the current session.
    }
  }

  function createOutput(label, value) {
    const button = document.createElement("button");
    button.className = "color-palette-value";
    button.type = "button";
    button.title = `Copy ${label}`;
    button.setAttribute("aria-label", `Copy ${label}`);

    const labelElement = document.createElement("span");
    labelElement.textContent = label;

    const valueElement = document.createElement("strong");
    valueElement.textContent = value;
    button.append(labelElement, valueElement);
    button.addEventListener("click", () => {
      typedGlobalScope.boatyard?.writeClipboardText?.(value);
    });
    return button;
  }

  function createFavoriteButton(color, selectColor, removeColor) {
    const button = document.createElement("button");
    button.className = "color-palette-favorite";
    button.type = "button";
    button.title = color;
    button.setAttribute("aria-label", `Use ${color}`);
    button.style.backgroundColor = color;
    button.addEventListener("click", () => selectColor(color));
    button.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      removeColor(color);
    });
    return button;
  }

  function createColorPaletteWidget(project) {
    const card = document.createElement("article");
    card.className = "widget-card color-palette-widget";

    const title = document.createElement("div");
    title.className = "color-palette-title";
    const heading = document.createElement("h3");
    heading.textContent = "Color Palette";
    title.append(heading);

    const preview = document.createElement("button");
    preview.className = "color-palette-preview";
    preview.type = "button";
    preview.title = "Open color picker";
    preview.setAttribute("aria-label", "Open color picker");

    const nativePicker = document.createElement("input");
    nativePicker.className = "color-palette-native-picker";
    nativePicker.type = "color";
    nativePicker.setAttribute("aria-label", "Pick color");

    const input = document.createElement("input");
    input.className = "color-palette-input";
    input.type = "text";
    input.spellcheck = false;
    input.autocomplete = "off";
    input.placeholder = "#41b883 or rgba(65, 184, 131, .8)";

    const outputs = document.createElement("div");
    outputs.className = "color-palette-values";

    const addFavorite = document.createElement("button");
    addFavorite.className = "color-palette-add";
    addFavorite.type = "button";
    addFavorite.textContent = "+";
    addFavorite.title = "Add current color to favorites";
    addFavorite.setAttribute("aria-label", "Add current color to favorites");

    const error = document.createElement("small");
    error.className = "color-palette-error";
    error.hidden = true;

    const favoritesGrid = document.createElement("div");
    favoritesGrid.className = "color-palette-favorites";

    let currentColor = parseColor(DEFAULT_COLOR);
    let favorites = loadFavorites(project);

    function renderFavorites() {
      favoritesGrid.innerHTML = "";
      for (const color of favorites) {
        favoritesGrid.append(createFavoriteButton(
          color,
          (nextColor) => {
            input.value = nextColor;
            renderColor(nextColor);
          },
          (removedColor) => {
            favorites = favorites.filter((item) => item !== removedColor);
            saveFavorites(project, favorites);
            renderFavorites();
          }
        ));
      }
      favoritesGrid.append(addFavorite);
    }

    function renderColor(value) {
      const parsed = parseColor(value);
      if (!parsed) {
        error.hidden = false;
        error.textContent = "Invalid color";
        addFavorite.disabled = true;
        return;
      }

      currentColor = parsed;
      const hex = formatHex(parsed);
      const rgb = formatRgb(parsed);
      nativePicker.value = formatOpaqueHex(parsed);
      preview.style.setProperty("--color-palette-preview-color", rgb);
      outputs.replaceChildren(createOutput("HTML", hex), createOutput("RGB", rgb));
      error.hidden = true;
      error.textContent = "";
      addFavorite.disabled = false;
    }

    input.addEventListener("input", () => renderColor(input.value));
    preview.addEventListener("click", () => {
      if (typeof nativePicker.showPicker === "function") {
        nativePicker.showPicker();
        return;
      }

      nativePicker.click();
    });
    nativePicker.addEventListener("input", () => {
      input.value = nativePicker.value;
      renderColor(nativePicker.value);
    });
    addFavorite.addEventListener("click", () => {
      const color = formatHex(currentColor);
      favorites = [...favorites.filter((item) => item !== color), color].slice(-12);
      saveFavorites(project, favorites);
      renderFavorites();
    });

    input.value = favorites[0] || DEFAULT_COLOR;
    renderColor(input.value);
    renderFavorites();

    card.append(title, preview, nativePicker, input, outputs, error, favoritesGrid);
    return card;
  }

  registry.register(
    {
      id: "boatyard.colorPalette",
      name: "Color Palette",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.colorPalette.widget"]
      },
      permissions: ["widget:provide"]
    },
    {
      activate(ctx) {
        ctx.status.set({
          state: "ready",
          summary: "Color palette widget is available"
        });

        ctx.widgets.register({
          id: "boatyard.colorPalette.widget",
          name: "Color Palette",
          title: "Color Palette",
          scope: "project",
          category: "Utilities",
          status: "stable",
          defaultVisible: false,
          description: "Converts HTML and RGB(A) colors and stores project favorites.",
          layout: {
            default: { columns: 3, rows: 3 },
            min: { columns: 2, rows: 2 }
          },
          createElement: createColorPaletteWidget
        });
      }
    }
  );
})(window);
