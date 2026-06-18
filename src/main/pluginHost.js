"use strict";

const fs = require("node:fs");
const path = require("node:path");

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Plugin manifest must be an object: ${manifestPath}`);
  }

  const id = normalizeText(manifest.id);
  const name = normalizeText(manifest.name);

  if (!id) {
    throw new Error(`Plugin id is required: ${manifestPath}`);
  }

  if (!name) {
    throw new Error(`Plugin name is required: ${manifestPath}`);
  }

  return {
    ...manifest,
    id,
    name,
    version: normalizeText(manifest.version || "0.0.0"),
    apiVersion: normalizeText(manifest.apiVersion || "0.1"),
    renderer: normalizeText(manifest.renderer),
    main: normalizeText(manifest.main),
    styles: Array.isArray(manifest.styles) ? manifest.styles.map(normalizeText).filter(Boolean) : []
  };
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listPluginManifestPaths(pluginRoot) {
  if (!fs.existsSync(pluginRoot)) {
    return [];
  }

  return fs.readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(pluginRoot, entry.name, "plugin.json"))
    .filter((manifestPath) => fs.existsSync(manifestPath))
    .sort();
}

function toRendererPath(filePath) {
  return path.relative(path.join(__dirname, "../renderer"), filePath).replaceAll(path.sep, "/");
}

function getPluginEventChannel(pluginId, eventName) {
  const normalizedPluginId = normalizeText(pluginId);
  const normalizedEventName = normalizeText(eventName);
  if (!normalizedPluginId || !normalizedEventName) {
    throw new Error("Plugin event channel requires plugin id and event name.");
  }

  return `plugins:event:${normalizedPluginId}:${normalizedEventName}`;
}

class PluginHost {
  constructor(options = {}) {
    this.pluginRoot = options.pluginRoot || path.join(__dirname, "../plugins");
    this.store = options.store || null;
    this.execFileAsync = options.execFileAsync;
    this.userDataPath = options.userDataPath || "";
    this.sendToRenderer = options.sendToRenderer || (() => {});
    this.actions = new Map();
    this.inspectors = [];
    this.stateMigrations = [];
    this.plugins = [];
  }

  discover() {
    this.actions.clear();
    this.inspectors = [];
    this.stateMigrations = [];
    this.plugins = listPluginManifestPaths(this.pluginRoot).map((manifestPath) => {
      const manifest = normalizeManifest(readJson(manifestPath), manifestPath);
      const pluginDir = path.dirname(manifestPath);
      const plugin = {
        ...manifest,
        directory: pluginDir,
        rendererPath: manifest.renderer ? toRendererPath(path.resolve(pluginDir, manifest.renderer)) : "",
        stylePaths: manifest.styles.map((style) => toRendererPath(path.resolve(pluginDir, style)))
      };

      if (manifest.main) {
        this.loadMainPlugin(plugin, path.resolve(pluginDir, manifest.main));
      }

      return plugin;
    });

    return this.plugins;
  }

  listRendererPlugins() {
    return this.plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      apiVersion: plugin.apiVersion,
      rendererPath: plugin.rendererPath,
      stylePaths: plugin.stylePaths
    }));
  }

  loadMainPlugin(plugin, mainPath) {
    const runtime = require(mainPath);
    const activate = typeof runtime === "function" ? runtime : runtime?.activate;

    if (typeof activate !== "function") {
      throw new Error(`Plugin ${plugin.id} main entry must export activate().`);
    }

    activate(this.createContext(plugin));
  }

  createContext(plugin) {
    const pluginId = plugin.id;

    return {
      plugin,
      paths: {
        userData: this.userDataPath,
        pluginData: this.userDataPath ? path.join(this.userDataPath, "plugins", pluginId) : ""
      },
      execFileAsync: this.execFileAsync,
      getState: () => this.store?.getState(),
      actions: {
        handle: (actionName, handler) => this.registerAction(pluginId, actionName, handler)
      },
      events: {
        emit: (eventName, payload) => this.sendToRenderer(getPluginEventChannel(pluginId, normalizeText(eventName)), payload)
      },
      stateMigrations: {
        register: (handler) => this.registerStateMigration(pluginId, handler)
      },
      projectInspectors: {
        register: (handler) => this.registerProjectInspector(pluginId, handler)
      }
    };
  }

  isPluginEnabled(pluginId) {
    return this.store?.getState?.().plugins?.enabled?.[pluginId] !== false;
  }

  registerAction(pluginId, actionName, handler) {
    const name = normalizeText(actionName);
    if (!name) {
      throw new Error(`Plugin ${pluginId} action name is required.`);
    }

    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} action ${name} handler must be a function.`);
    }

    this.actions.set(`${pluginId}:${name}`, handler);
  }

  registerProjectInspector(pluginId, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} project inspector must be a function.`);
    }

    this.inspectors.push({ pluginId, handler });
  }

  registerStateMigration(pluginId, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} state migration must be a function.`);
    }

    this.stateMigrations.push({ pluginId, handler });
  }

  async applyStateMigrations() {
    if (!this.store) {
      return;
    }

    for (const migration of this.stateMigrations) {
      if (!this.isPluginEnabled(migration.pluginId)) {
        continue;
      }

      const result = await migration.handler({ state: this.store.getState() });
      for (const entry of result?.projectPluginConfig || []) {
        if (!entry?.projectId || !entry.config || typeof entry.config !== "object") {
          continue;
        }
        this.store.updateProjectPluginConfig(entry.projectId, migration.pluginId, entry.config);
      }

      if (result?.globalPluginConfig && typeof result.globalPluginConfig === "object") {
        this.store.updateGlobalPluginConfig(migration.pluginId, result.globalPluginConfig);
      }
    }
  }

  async invoke(pluginId, actionName, payload) {
    const normalizedPluginId = normalizeText(pluginId);
    if (!this.isPluginEnabled(normalizedPluginId)) {
      throw new Error(`Plugin is disabled: ${normalizedPluginId}`);
    }

    const action = this.actions.get(`${normalizedPluginId}:${normalizeText(actionName)}`);
    if (!action) {
      throw new Error(`Unknown plugin action: ${pluginId}:${actionName}`);
    }

    return action(payload);
  }

  async inspectSourcePath(input) {
    const plugins = {};

    for (const inspector of this.inspectors) {
      if (!this.isPluginEnabled(inspector.pluginId)) {
        continue;
      }

      const result = await inspector.handler(input);
      if (result && typeof result === "object" && !Array.isArray(result)) {
        plugins[inspector.pluginId] = result;
      }
    }

    return plugins;
  }
}

module.exports = {
  PluginHost,
  getPluginEventChannel,
  listPluginManifestPaths,
  normalizeManifest
};
