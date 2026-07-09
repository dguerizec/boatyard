"use strict";

import type {
  ExecFileAsync,
  PluginActionHandler,
  PluginContext,
  PluginProjectInspectors,
  PluginStateMigrations
} from "../shared/pluginTypes";

import type { Dirent } from "node:fs";

const fs = require("node:fs");
const path = require("node:path");

type UnknownRecord = Record<string, unknown>;

type PluginHostStore = {
  getState(): {
    pluginConfig?: {
      global?: Record<string, UnknownRecord>;
    };
    plugins?: { enabled?: Record<string, boolean | undefined> };
  } | undefined;
  updateGlobalPluginConfig?(pluginId: string, config: UnknownRecord): unknown;
  updateProjectPluginConfig?(projectId: string, pluginId: string, config: UnknownRecord): unknown;
};

type PluginHostConstructorOptions = {
  execFileAsync?: ExecFileAsync;
  pluginRoot?: string;
  sendToRenderer?: (channel: string, payload?: unknown) => unknown;
  store?: PluginHostStore | null;
  userDataPath?: string;
};

type PluginManifestInput = UnknownRecord & {
  apiVersion?: unknown;
  id?: unknown;
  main?: unknown;
  name?: unknown;
  renderer?: unknown;
  styles?: unknown;
  version?: unknown;
};

type PluginManifest = PluginManifestInput & {
  apiVersion: string;
  id: string;
  main: string;
  name: string;
  renderer: string;
  styles: string[];
  version: string;
};

type RuntimePlugin = PluginManifest & {
  directory: string;
  rendererPath: string;
  stylePaths: string[];
};

type RendererPlugin = {
  apiVersion: string;
  id: string;
  name: string;
  rendererPath: string;
  stylePaths: string[];
  version: string;
};

type PluginInspectorHandler = (input?: unknown) => unknown | Promise<unknown>;
type PluginStateMigrationHandler = (payload: { state: unknown }) => unknown | Promise<unknown>;
type PluginInspectorRegistration = { pluginId: string; handler: PluginInspectorHandler };
type PluginStateMigrationRegistration = { pluginId: string; handler: PluginStateMigrationHandler };
type PluginProjectConfigMigration = { config: UnknownRecord; projectId: string };
type PluginMigrationResult = {
  globalPluginConfig?: UnknownRecord;
  projectPluginConfig: PluginProjectConfigMigration[];
} | null | undefined;

type RuntimePluginContext = Omit<PluginContext<unknown>, "execFileAsync" | "projectInspectors" | "stateMigrations"> & {
  execFileAsync?: ExecFileAsync;
  projectInspectors: PluginProjectInspectors;
  stateMigrations: PluginStateMigrations<unknown>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function requireFunction<THandler>(
  value: unknown,
  message: string
): THandler {
  if (typeof value !== "function") {
    throw new Error(message);
  }

  return value as THandler;
}

function normalizeMigrationResult(result: unknown): PluginMigrationResult {
  if (!isRecord(result)) {
    return null;
  }

  return {
    globalPluginConfig: isRecord(result.globalPluginConfig) ? result.globalPluginConfig : undefined,
    projectPluginConfig: Array.isArray(result.projectPluginConfig)
      ? result.projectPluginConfig.flatMap((entry) => {
          if (!isRecord(entry) || !entry.projectId || !isRecord(entry.config)) {
            return [];
          }

          return [{
            projectId: String(entry.projectId),
            config: entry.config
          }];
        })
      : []
  };
}

function normalizeManifest(manifest: unknown, manifestPath: string): PluginManifest {
  if (!isRecord(manifest)) {
    throw new Error(`Plugin manifest must be an object: ${manifestPath}`);
  }

  const source: PluginManifestInput = manifest;
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

function readJson(filePath: string): unknown {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function listPluginManifestPaths(pluginRoot: string): string[] {
  if (!fs.existsSync(pluginRoot)) {
    return [];
  }

  return fs.readdirSync(pluginRoot, { withFileTypes: true })
    .filter((entry: Dirent) => entry.isDirectory())
    .map((entry: Dirent) => path.join(pluginRoot, entry.name, "plugin.json"))
    .filter((manifestPath: string) => fs.existsSync(manifestPath))
    .sort();
}

function toRendererPath(filePath: string): string {
  return path.relative(path.join(__dirname, "../renderer"), filePath).replaceAll(path.sep, "/");
}

function getPluginEventChannel(pluginId: unknown, eventName: unknown): string {
  const normalizedPluginId = normalizeText(pluginId);
  const normalizedEventName = normalizeText(eventName);
  if (!normalizedPluginId || !normalizedEventName) {
    throw new Error("Plugin event channel requires plugin id and event name.");
  }

  return `plugins:event:${normalizedPluginId}:${normalizedEventName}`;
}

class PluginHost {
  pluginRoot: string;
  store: PluginHostStore | null;
  execFileAsync?: ExecFileAsync;
  userDataPath: string;
  sendToRenderer: (channel: string, payload?: unknown) => unknown;
  actions: Map<string, PluginActionHandler>;
  inspectors: PluginInspectorRegistration[];
  stateMigrations: PluginStateMigrationRegistration[];
  plugins: RuntimePlugin[];

  constructor(options: PluginHostConstructorOptions = {}) {
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

  discover(): RuntimePlugin[] {
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

  listRendererPlugins(): RendererPlugin[] {
    return this.plugins.map((plugin) => ({
      id: plugin.id,
      name: plugin.name,
      version: plugin.version,
      apiVersion: plugin.apiVersion,
      rendererPath: plugin.rendererPath,
      stylePaths: plugin.stylePaths
    }));
  }

  loadMainPlugin(plugin: RuntimePlugin, mainPath: string): void {
    const runtime = require(mainPath);
    const activate = typeof runtime === "function" ? runtime : runtime?.activate;

    requireFunction<(context: RuntimePluginContext) => unknown>(
      activate,
      `Plugin ${plugin.id} main entry must export activate().`
    )(this.createContext(plugin));
  }

  createContext(plugin: RuntimePlugin): RuntimePluginContext {
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

  isPluginEnabled(pluginId: string): boolean {
    return this.store?.getState?.()?.plugins?.enabled?.[pluginId] !== false;
  }

  registerAction(pluginId: string, actionName: unknown, handler: unknown): void {
    const name = normalizeText(actionName);
    if (!name) {
      throw new Error(`Plugin ${pluginId} action name is required.`);
    }

    this.actions.set(
      `${pluginId}:${name}`,
      requireFunction<PluginActionHandler>(
        handler,
        `Plugin ${pluginId} action ${name} handler must be a function.`
      )
    );
  }

  registerProjectInspector(pluginId: string, handler: unknown): void {
    this.inspectors.push({
      pluginId,
      handler: requireFunction<PluginInspectorHandler>(
        handler,
        `Plugin ${pluginId} project inspector must be a function.`
      )
    });
  }

  registerStateMigration(pluginId: string, handler: unknown): void {
    this.stateMigrations.push({
      pluginId,
      handler: requireFunction<PluginStateMigrationHandler>(
        handler,
        `Plugin ${pluginId} state migration must be a function.`
      )
    });
  }

  async applyStateMigrations(): Promise<void> {
    if (!this.store) {
      return;
    }

    for (const migration of this.stateMigrations) {
      if (!this.isPluginEnabled(migration.pluginId)) {
        continue;
      }

      const migrationResult = normalizeMigrationResult(await migration.handler({ state: this.store.getState() }));
      for (const entry of migrationResult?.projectPluginConfig || []) {
        this.store.updateProjectPluginConfig?.(
          entry.projectId,
          migration.pluginId,
          entry.config
        );
      }

      if (isRecord(migrationResult?.globalPluginConfig)) {
        this.store.updateGlobalPluginConfig?.(
          migration.pluginId,
          migrationResult.globalPluginConfig
        );
      }
    }
  }

  async invoke(pluginId: unknown, actionName: unknown, payload: unknown): Promise<unknown> {
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

  async inspectSourcePath(input: unknown): Promise<UnknownRecord> {
    const plugins: UnknownRecord = {};

    for (const inspector of this.inspectors) {
      if (!this.isPluginEnabled(inspector.pluginId)) {
        continue;
      }

      const source = isRecord(input) ? input : {};
      const globalConfig = this.store?.getState?.()?.pluginConfig?.global?.[inspector.pluginId] || {};
      const result = await inspector.handler({
        ...source,
        globalConfig
      });
      if (isRecord(result)) {
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
