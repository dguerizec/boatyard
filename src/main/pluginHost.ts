"use strict";

const fs = require("node:fs");
const path = require("node:path");

type PluginHostStore = {
  getState(): { plugins?: { enabled?: Record<string, boolean | undefined> } } | undefined;
  updateGlobalPluginConfig?(pluginId: string, config: Record<string, unknown>): unknown;
  updateProjectPluginConfig?(projectId: string, pluginId: string, config: Record<string, unknown>): unknown;
};

type PluginHostConstructorOptions = {
  execFileAsync?: unknown;
  pluginRoot?: string;
  sendToRenderer?: (channel: string, payload?: unknown) => unknown;
  store?: PluginHostStore | null;
  userDataPath?: string;
};

/**
 * @typedef {import("../plugins/pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {{ id?: unknown, name?: unknown, version?: unknown, apiVersion?: unknown, renderer?: unknown, main?: unknown, styles?: unknown, [key: string]: unknown }} PluginManifestInput
 * @typedef {PluginManifestInput & { id: string, name: string, version: string, apiVersion: string, renderer: string, main: string, styles: string[] }} PluginManifest
 * @typedef {PluginManifest & { directory: string, rendererPath: string, stylePaths: string[] }} RuntimePlugin
 * @typedef {{ id: string, name: string, version: string, apiVersion: string, rendererPath: string, stylePaths: string[] }} RendererPlugin
 * @typedef {(payload?: unknown) => unknown | Promise<unknown>} PluginActionHandler
 * @typedef {(input?: unknown) => unknown | Promise<unknown>} PluginInspectorHandler
 * @typedef {(payload: { state: unknown }) => unknown | Promise<unknown>} PluginStateMigrationHandler
 * @typedef {{ pluginId: string, handler: PluginInspectorHandler }} PluginInspectorRegistration
 * @typedef {{ pluginId: string, handler: PluginStateMigrationHandler }} PluginStateMigrationRegistration
 * @typedef {{ getState(): unknown, updateProjectPluginConfig?(projectId: string, pluginId: string, config: Record<string, unknown>): unknown, updateGlobalPluginConfig?(pluginId: string, config: Record<string, unknown>): unknown }} PluginStore
 * @typedef {{
 *   pluginRoot?: string,
 *   store?: PluginStore | null,
 *   execFileAsync?: ExecFileAsync,
 *   userDataPath?: string,
 *   sendToRenderer?: (channel: string, payload?: unknown) => unknown
 * }} PluginHostOptions
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || "").trim();
}

/**
 * @param {unknown} manifest
 * @param {string} manifestPath
 * @returns {PluginManifest}
 */
function normalizeManifest(manifest, manifestPath) {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new Error(`Plugin manifest must be an object: ${manifestPath}`);
  }

  const source = /** @type {PluginManifestInput} */ (manifest);
  const id = normalizeText(source.id);
  const name = normalizeText(source.name);

  if (!id) {
    throw new Error(`Plugin id is required: ${manifestPath}`);
  }

  if (!name) {
    throw new Error(`Plugin name is required: ${manifestPath}`);
  }

  return {
    ...source,
    id,
    name,
    version: normalizeText(source.version || "0.0.0"),
    apiVersion: normalizeText(source.apiVersion || "0.1"),
    renderer: normalizeText(source.renderer),
    main: normalizeText(source.main),
    styles: Array.isArray(source.styles) ? source.styles.map(normalizeText).filter(Boolean) : []
  };
}

/**
 * @param {string} filePath
 * @returns {unknown}
 */
function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

/**
 * @param {string} pluginRoot
 * @returns {string[]}
 */
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

/**
 * @param {string} filePath
 * @returns {string}
 */
function toRendererPath(filePath) {
  return path.relative(path.join(__dirname, "../renderer"), filePath).replaceAll(path.sep, "/");
}

/**
 * @param {unknown} pluginId
 * @param {unknown} eventName
 * @returns {string}
 */
function getPluginEventChannel(pluginId, eventName) {
  const normalizedPluginId = normalizeText(pluginId);
  const normalizedEventName = normalizeText(eventName);
  if (!normalizedPluginId || !normalizedEventName) {
    throw new Error("Plugin event channel requires plugin id and event name.");
  }

  return `plugins:event:${normalizedPluginId}:${normalizedEventName}`;
}

class PluginHost {
  pluginRoot;
  store;
  execFileAsync;
  userDataPath;
  sendToRenderer;
  actions;
  inspectors;
  stateMigrations;
  plugins;

  /**
   * @param {PluginHostOptions} options
   */
  constructor(options: PluginHostConstructorOptions = {}) {
    this.pluginRoot = options.pluginRoot || path.join(__dirname, "../plugins");
    this.store = options.store || null;
    this.execFileAsync = options.execFileAsync;
    this.userDataPath = options.userDataPath || "";
    this.sendToRenderer = options.sendToRenderer || (() => {});
    /** @type {Map<string, PluginActionHandler>} */
    this.actions = new Map();
    /** @type {PluginInspectorRegistration[]} */
    this.inspectors = [];
    /** @type {PluginStateMigrationRegistration[]} */
    this.stateMigrations = [];
    /** @type {RuntimePlugin[]} */
    this.plugins = [];
  }

  /**
   * @returns {RuntimePlugin[]}
   */
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

  /**
   * @returns {RendererPlugin[]}
   */
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

  /**
   * @param {RuntimePlugin} plugin
   * @param {string} mainPath
   */
  loadMainPlugin(plugin, mainPath) {
    const runtime = require(mainPath);
    const activate = typeof runtime === "function" ? runtime : runtime?.activate;

    if (typeof activate !== "function") {
      throw new Error(`Plugin ${plugin.id} main entry must export activate().`);
    }

    activate(this.createContext(plugin));
  }

  /**
   * @param {RuntimePlugin} plugin
   */
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

  /**
   * @param {string} pluginId
   * @returns {boolean}
   */
  isPluginEnabled(pluginId) {
    return this.store?.getState?.().plugins?.enabled?.[pluginId] !== false;
  }

  /**
   * @param {string} pluginId
   * @param {unknown} actionName
   * @param {unknown} handler
   */
  registerAction(pluginId, actionName, handler) {
    const name = normalizeText(actionName);
    if (!name) {
      throw new Error(`Plugin ${pluginId} action name is required.`);
    }

    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} action ${name} handler must be a function.`);
    }

    this.actions.set(`${pluginId}:${name}`, /** @type {PluginActionHandler} */ (handler));
  }

  /**
   * @param {string} pluginId
   * @param {unknown} handler
   */
  registerProjectInspector(pluginId, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} project inspector must be a function.`);
    }

    this.inspectors.push({ pluginId, handler: /** @type {PluginInspectorHandler} */ (handler) });
  }

  /**
   * @param {string} pluginId
   * @param {unknown} handler
   */
  registerStateMigration(pluginId, handler) {
    if (typeof handler !== "function") {
      throw new Error(`Plugin ${pluginId} state migration must be a function.`);
    }

    this.stateMigrations.push({ pluginId, handler: /** @type {PluginStateMigrationHandler} */ (handler) });
  }

  /**
   * @returns {Promise<void>}
   */
  async applyStateMigrations() {
    if (!this.store) {
      return;
    }

    for (const migration of this.stateMigrations) {
      if (!this.isPluginEnabled(migration.pluginId)) {
        continue;
      }

      const result = await migration.handler({ state: this.store.getState() });
      const migrationResult = /** @type {{ projectPluginConfig?: Array<{ projectId?: unknown, config?: unknown }>, globalPluginConfig?: unknown } | null | undefined} */ (result);
      for (const entry of migrationResult?.projectPluginConfig || []) {
        if (!entry?.projectId || !entry.config || typeof entry.config !== "object") {
          continue;
        }
        this.store.updateProjectPluginConfig?.(
          String(entry.projectId),
          migration.pluginId,
          /** @type {Record<string, unknown>} */ (entry.config)
        );
      }

      if (migrationResult?.globalPluginConfig && typeof migrationResult.globalPluginConfig === "object") {
        this.store.updateGlobalPluginConfig?.(
          migration.pluginId,
          /** @type {Record<string, unknown>} */ (migrationResult.globalPluginConfig)
        );
      }
    }
  }

  /**
   * @param {unknown} pluginId
   * @param {unknown} actionName
   * @param {unknown} payload
   * @returns {Promise<unknown>}
   */
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

  /**
   * @param {unknown} input
   * @returns {Promise<Record<string, unknown>>}
   */
  async inspectSourcePath(input) {
    /** @type {Record<string, unknown>} */
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

export {
  PluginHost,
  getPluginEventChannel,
  listPluginManifestPaths,
  normalizeManifest
};
