import { createToolIcon, hasToolIcon } from "./toolIcons.js";

export type PaneIconSource = {
  faviconUrl?: unknown;
  icon?: unknown;
  iconUrl?: unknown;
  key?: unknown;
  label?: unknown;
  url?: unknown;
};

function getDisplayName(label: unknown) {
  const normalized = String(label || "").trim();
  const prefixed = normalized.match(/^[^:]{1,40}:\s*(.+)$/);
  return prefixed?.[1].trim() || normalized;
}

export function getPaneIconInitial(label: unknown) {
  return getDisplayName(label).match(/[\p{L}\p{N}]/u)?.[0].toLocaleUpperCase() || "?";
}

export function shouldUseIconOnlyPaneTab(compactPaneTabs: unknown, paneIconOnly: unknown) {
  return compactPaneTabs === true || paneIconOnly === true;
}

export function getPaneFaviconUrl(url: unknown) {
  try {
    const parsed = new URL(String(url || ""));
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return "";
    }
    return new URL("/favicon.ico", parsed.origin).href;
  } catch {
    return "";
  }
}

export function haveSamePaneOrigin(firstUrl: unknown, secondUrl: unknown) {
  try {
    const first = new URL(String(firstUrl || ""));
    const second = new URL(String(secondUrl || ""));
    return [first.protocol, second.protocol].every((protocol) => protocol === "http:" || protocol === "https:")
      && first.origin === second.origin;
  } catch {
    return false;
  }
}

export function needsLightPaneFavicon(url: unknown) {
  try {
    const hostname = new URL(String(url || "")).hostname.toLowerCase();
    return hostname === "github.com" || hostname.endsWith(".github.com");
  } catch {
    return false;
  }
}

export function getSafePaneIconUrl(iconUrl: unknown) {
  const value = String(iconUrl || "").trim();
  if (!value) {
    return "";
  }

  try {
    const parsed = new URL(value, document.baseURI);
    if (["file:", "http:", "https:"].includes(parsed.protocol)) {
      return parsed.href;
    }
    if (parsed.protocol === "data:" && parsed.href.startsWith("data:image/")) {
      return parsed.href;
    }
  } catch {
    return "";
  }

  return "";
}

function createInitialIcon(label: unknown) {
  const initial = document.createElement("span");
  initial.className = "pane-icon-initial";
  initial.textContent = getPaneIconInitial(label);
  return initial;
}

function applyPaneImage(icon: HTMLElement, imageUrl: string, label: unknown, sourceUrl: unknown) {
  const image = document.createElement("img");
  image.className = "pane-icon-image";
  image.classList.toggle("light-on-dark", needsLightPaneFavicon(sourceUrl));
  image.src = imageUrl;
  image.alt = "";
  image.addEventListener("error", () => {
    icon.classList.remove("image");
    icon.classList.add("initial");
    icon.replaceChildren(createInitialIcon(label));
  }, { once: true });
  icon.classList.remove("initial", "tool");
  icon.classList.add("image");
  icon.replaceChildren(image);
}

export function createPaneIcon(source: PaneIconSource, label: unknown = source.label) {
  const icon = document.createElement("span");
  icon.className = "pane-icon";
  icon.setAttribute("aria-hidden", "true");
  const webAppKey = String(source.key || "").trim();
  if (webAppKey) {
    icon.dataset.webAppKey = webAppKey;
  }

  const toolIcon = String(source.icon || "").trim();
  if (toolIcon && hasToolIcon(toolIcon)) {
    icon.classList.add("tool");
    icon.append(createToolIcon(toolIcon));
    return icon;
  }

  const explicitIconUrl = getSafePaneIconUrl(source.iconUrl);
  const imageUrl = explicitIconUrl || getSafePaneIconUrl(source.faviconUrl) || getPaneFaviconUrl(source.url);
  if (!explicitIconUrl && webAppKey) {
    icon.dataset.usesPageFavicon = "true";
    icon.dataset.paneIconLabel = String(label || "");
    icon.dataset.paneSourceUrl = String(source.url || "");
  }
  if (!imageUrl) {
    icon.classList.add("initial");
    icon.append(createInitialIcon(label));
    return icon;
  }

  applyPaneImage(icon, imageUrl, label, source.url);
  return icon;
}

export function updatePaneFaviconElements(key: unknown, faviconUrl: unknown, sourceUrl: unknown = "") {
  const normalizedKey = String(key || "").trim();
  const normalizedFaviconUrl = getSafePaneIconUrl(faviconUrl);
  if (!normalizedKey || !normalizedFaviconUrl) {
    return 0;
  }

  let updated = 0;
  for (const icon of document.querySelectorAll<HTMLElement>(".pane-icon[data-uses-page-favicon='true']")) {
    if (icon.dataset.webAppKey !== normalizedKey) {
      continue;
    }

    const nextSourceUrl = String(sourceUrl || icon.dataset.paneSourceUrl || "");
    icon.dataset.paneSourceUrl = nextSourceUrl;
    applyPaneImage(icon, normalizedFaviconUrl, icon.dataset.paneIconLabel || "", nextSourceUrl);
    updated += 1;
  }
  return updated;
}

export function createPaneIconLabel(source: PaneIconSource, label: unknown = source.label) {
  const content = document.createElement("span");
  content.className = "pane-icon-label";
  content.append(createPaneIcon(source, label));

  const name = document.createElement("span");
  name.className = "pane-icon-name";
  name.textContent = String(label || "");
  content.append(name);
  return content;
}
