"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const DEFAULT_BOUNDS = {
  x: 48,
  y: 92,
  width: 720,
  height: 460
};

function createDefaultState() {
  return {
    apps: []
  };
}

function normalizeUrl(rawUrl) {
  const trimmed = String(rawUrl || "").trim();

  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const withProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(trimmed)
    ? trimmed
    : `https://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
}

function normalizeBounds(bounds, fallback = DEFAULT_BOUNDS) {
  const source = bounds && typeof bounds === "object" ? bounds : {};
  const next = {
    x: Number.isFinite(source.x) ? source.x : fallback.x,
    y: Number.isFinite(source.y) ? source.y : fallback.y,
    width: Number.isFinite(source.width) ? source.width : fallback.width,
    height: Number.isFinite(source.height) ? source.height : fallback.height
  };

  return {
    x: Math.max(0, Math.round(next.x)),
    y: Math.max(0, Math.round(next.y)),
    width: Math.max(260, Math.round(next.width)),
    height: Math.max(200, Math.round(next.height))
  };
}

function normalizeApp(app, index = 0) {
  const id = String(app.id || crypto.randomUUID());
  const name = String(app.name || "").trim();

  if (!name) {
    throw new Error("Name is required.");
  }

  return {
    id,
    name,
    url: normalizeUrl(app.url),
    bounds: normalizeBounds(app.bounds, {
      x: 48 + index * 32,
      y: 92 + index * 28,
      width: DEFAULT_BOUNDS.width,
      height: DEFAULT_BOUNDS.height
    }),
    isOpen: app.isOpen !== false
  };
}

class AppStore {
  constructor(filePath) {
    this.filePath = filePath;
    this.state = createDefaultState();
  }

  load() {
    try {
      const raw = fs.readFileSync(this.filePath, "utf8");
      const parsed = JSON.parse(raw);
      const apps = Array.isArray(parsed.apps) ? parsed.apps : [];
      this.state = {
        apps: apps.map((app, index) => normalizeApp(app, index))
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`Could not load Dashtop state: ${error.message}`);
      }
      this.state = createDefaultState();
    }

    return this.getState();
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify(this.state, null, 2)}\n`);
  }

  getState() {
    return structuredClone(this.state);
  }

  addApp(app) {
    const normalized = normalizeApp(
      {
        ...app,
        id: crypto.randomUUID(),
        isOpen: true
      },
      this.state.apps.length
    );
    this.state.apps.push(normalized);
    this.save();
    return this.getState();
  }

  updateApp(id, patch) {
    const index = this.state.apps.findIndex((app) => app.id === id);

    if (index === -1) {
      throw new Error(`Unknown app: ${id}`);
    }

    const current = this.state.apps[index];
    this.state.apps[index] = normalizeApp({
      ...current,
      ...patch,
      id: current.id,
      bounds: patch.bounds ? normalizeBounds(patch.bounds, current.bounds) : current.bounds
    }, index);
    this.save();
    return this.getState();
  }

  removeApp(id) {
    this.state.apps = this.state.apps.filter((app) => app.id !== id);
    this.save();
    return this.getState();
  }
}

module.exports = {
  AppStore,
  DEFAULT_BOUNDS,
  normalizeApp,
  normalizeBounds,
  normalizeUrl
};
