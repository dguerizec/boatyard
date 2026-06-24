const crypto = require("node:crypto");

import type {
  ProjectUrl,
  ProjectWidgetPane,
  StoredProject,
  WebAppHomeTab
} from "./storeTypes";
import {
  DEFAULT_BOUNDS,
  deriveRepoUrl,
  normalizeBounds,
  normalizeMultilineText,
  normalizeOptionalUrl,
  normalizeSlug,
  normalizeText,
  normalizeUrl,
  slugify,
  toRecord
} from "./storeUtils";

const DEFAULT_WIDGET_PANE_ID = "widgets-0";

export function normalizeWebAppHomeTabList(tabs: unknown = []): WebAppHomeTab[] {
  if (!Array.isArray(tabs)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: WebAppHomeTab[] = [];
  for (const tab of tabs) {
    const source = toRecord(tab);
    const id = normalizeText(source.id);
    const parentWebAppId = normalizeText(source.parentWebAppId);
    const label = normalizeText(source.label);

    if (!id || seenIds.has(id) || !parentWebAppId || !label) {
      continue;
    }

    try {
      normalized.push({
        id,
        parentWebAppId,
        parentLabel: normalizeText(source.parentLabel),
        label,
        url: normalizeUrl(source.url)
      });
      seenIds.add(id);
    } catch {
      // Ignore invalid saved webapp home tabs.
    }
  }

  return normalized;
}

export function normalizeProjectUrls(urls: unknown = []): ProjectUrl[] {
  if (!Array.isArray(urls)) {
    return [];
  }

  const seenIds = new Set<string>();
  const normalized: ProjectUrl[] = [];
  urls.forEach((entry, index) => {
    const source = toRecord(entry);
    const label = normalizeText(source.label);
    const rawUrl = normalizeText(source.url);

    if (!label && !rawUrl) {
      return;
    }

    if (!label) {
      throw new Error("URL label is required.");
    }

    if (!rawUrl) {
      throw new Error("URL is required.");
    }

    const baseId = normalizeText(source.id) || slugify(label) || `url-${index + 1}`;
    let id = baseId;
    let suffix = 2;

    while (seenIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    seenIds.add(id);
    normalized.push({
      id,
      label,
      url: normalizeUrl(rawUrl)
    });
  });
  return normalized;
}

export function normalizeProjectWidgetPanes(widgetPanes: unknown = []): ProjectWidgetPane[] {
  const source = Array.isArray(widgetPanes) ? widgetPanes : [];
  const seenIds = new Set<string>();
  const normalized: ProjectWidgetPane[] = [];
  source.forEach((entry, index) => {
    const pane = toRecord(entry);
    const label = normalizeText(pane.label || pane.name);

    if (!label) {
      return;
    }

    const baseId = normalizeText(pane.id) || slugify(label) || `widgets-${index}`;
    let id = baseId;
    let suffix = 2;

    while (seenIds.has(id)) {
      id = `${baseId}-${suffix}`;
      suffix += 1;
    }

    seenIds.add(id);
    normalized.push({ id, label });
  });

  return normalized.length
    ? normalized
    : [{
        id: DEFAULT_WIDGET_PANE_ID,
        label: "Widgets"
      }];
}

export function normalizeProject(project: unknown, index = 0): StoredProject {
  const source = toRecord(project);
  const id = String(source.id || crypto.randomUUID());
  const name = String(source.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  const slug = normalizeSlug(source.slug, name);
  const previewUrl = normalizeOptionalUrl(source.previewUrl || source.url);
  const gitUrl = normalizeText(source.gitUrl);
  const repoUrl = normalizeOptionalUrl(source.repoUrl) || deriveRepoUrl(gitUrl);

  return {
    id,
    slug,
    name,
    group: normalizeText(source.group),
    sourcePath: normalizeText(source.sourcePath),
    gitUrl,
    repoUrl,
    devBranch: normalizeText(source.devBranch),
    terminalEnv: normalizeMultilineText(source.terminalEnv),
    previewUrl,
    urls: normalizeProjectUrls(source.urls),
    webAppHomeTabs: normalizeWebAppHomeTabList(source.webAppHomeTabs),
    widgetPanes: normalizeProjectWidgetPanes(source.widgetPanes),
    bounds: normalizeBounds(source.bounds, {
      x: 48 + index * 32,
      y: 92 + index * 28,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    }),
    isOpen: source.isOpen !== false
  };
}
