"use strict";

(function registerPluginRegistry(globalScope) {
  const plugins = new Map();
  const statuses = new Map();
  const panes = new Map();
  const projectSettingsSections = new Map();
  const widgetsByPlugin = new Map();

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function requireId(value, label) {
    const id = normalizeText(value);
    if (!id) {
      throw new Error(`${label} id is required.`);
    }

    return id;
  }

  function normalizeManifest(manifest) {
    if (!manifest || typeof manifest !== "object") {
      throw new Error("Plugin manifest must be an object.");
    }

    const id = requireId(manifest.id, "Plugin");
    const name = normalizeText(manifest.name);

    if (!name) {
      throw new Error(`Plugin ${id} name is required.`);
    }

    return {
      ...manifest,
      id,
      name,
      version: normalizeText(manifest.version || "0.0.0"),
      apiVersion: normalizeText(manifest.apiVersion || "0.1")
    };
  }

  function normalizePaneDefinition(pluginId, definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error(`Plugin ${pluginId} pane definition must be an object.`);
    }

    const id = requireId(definition.id, "Pane");
    const title = normalizeText(definition.title || definition.name);
    const kind = normalizeText(definition.kind || "wcv");

    if (!title) {
      throw new Error(`Pane ${id} title is required.`);
    }

    if (!["wcv", "dom"].includes(kind)) {
      throw new Error(`Pane ${id} kind must be wcv or dom.`);
    }

    if (kind === "wcv" && typeof definition.resolveUrl !== "function") {
      throw new Error(`WCV pane ${id} must provide resolveUrl.`);
    }

    if (kind === "dom" && typeof definition.render !== "function") {
      throw new Error(`DOM pane ${id} must provide render.`);
    }

    return {
      ...definition,
      id,
      pluginId,
      title,
      kind,
      scope: normalizeText(definition.scope || "project"),
      webAppId: normalizeText(definition.webAppId || id),
      key: normalizeText(definition.key || definition.webAppId || id)
    };
  }

  function normalizeProjectSettingsSection(pluginId, section) {
    if (!section || typeof section !== "object") {
      throw new Error(`Plugin ${pluginId} project settings section must be an object.`);
    }

    const id = requireId(section.id, "Project settings section");
    const title = normalizeText(section.title || section.name);
    const fields = Array.isArray(section.fields)
      ? section.fields.map((field) => ({
          ...field,
          key: requireId(field.key, "Project settings field"),
          label: normalizeText(field.label || field.title || field.key),
          type: normalizeText(field.type || "text"),
          placeholder: normalizeText(field.placeholder)
        }))
      : [];

    if (!title) {
      throw new Error(`Project settings section ${id} title is required.`);
    }

    if (!fields.length) {
      throw new Error(`Project settings section ${id} must provide fields.`);
    }

    return {
      ...section,
      id,
      pluginId,
      title,
      fields
    };
  }

  function createContext(manifest) {
    const pluginId = manifest.id;

    return Object.freeze({
      plugin: manifest,
      status: Object.freeze({
        set(status) {
          statuses.set(pluginId, {
            state: normalizeText(status?.state || "ready"),
            summary: normalizeText(status?.summary),
            details: status?.details && typeof status.details === "object" ? { ...status.details } : {},
            actions: Array.isArray(status?.actions) ? [...status.actions] : []
          });
        },
        get() {
          return statuses.get(pluginId) || null;
        }
      }),
      panes: Object.freeze({
        register(definition) {
          const normalized = normalizePaneDefinition(pluginId, definition);
          if (panes.has(normalized.id)) {
            throw new Error(`Pane already registered: ${normalized.id}`);
          }

          panes.set(normalized.id, normalized);
          return normalized;
        }
      }),
      settings: Object.freeze({
        registerProjectSection(section) {
          const normalized = normalizeProjectSettingsSection(pluginId, section);
          if (projectSettingsSections.has(normalized.id)) {
            throw new Error(`Project settings section already registered: ${normalized.id}`);
          }

          projectSettingsSections.set(normalized.id, normalized);
          return normalized;
        }
      }),
      widgets: Object.freeze({
        register(definition) {
          if (!globalScope.DashtopWidgetRegistry) {
            throw new Error("Widget registry is unavailable.");
          }

          const registered = globalScope.DashtopWidgetRegistry.register({
            provider: manifest.name,
            ...definition
          });
          widgetsByPlugin.set(pluginId, [
            ...(widgetsByPlugin.get(pluginId) || []),
            registered.id
          ]);
          return registered;
        }
      })
    });
  }

  function removePluginContributions(pluginId) {
    for (const [paneId, pane] of panes) {
      if (pane.pluginId === pluginId) {
        panes.delete(paneId);
      }
    }

    for (const [sectionId, section] of projectSettingsSections) {
      if (section.pluginId === pluginId) {
        projectSettingsSections.delete(sectionId);
      }
    }

    if (globalScope.DashtopWidgetRegistry) {
      for (const widgetId of widgetsByPlugin.get(pluginId) || []) {
        globalScope.DashtopWidgetRegistry.unregister(widgetId);
      }
    }
    widgetsByPlugin.delete(pluginId);
  }

  function activatePlugin(plugin) {
    if (plugin.active) {
      return;
    }

    statuses.set(plugin.manifest.id, { state: "activating", summary: "", details: {}, actions: [] });
    const context = createContext(plugin.manifest);
    if (typeof plugin.runtime.activate === "function") {
      plugin.runtime.activate(context);
    } else {
      context.status.set({ state: "ready" });
    }
    plugin.active = true;
  }

  function deactivatePlugin(plugin) {
    if (!plugin.active) {
      statuses.set(plugin.manifest.id, {
        state: "disabled",
        summary: "Plugin is disabled.",
        details: {},
        actions: []
      });
      return;
    }

    if (typeof plugin.runtime.deactivate === "function") {
      plugin.runtime.deactivate(createContext(plugin.manifest));
    }
    removePluginContributions(plugin.manifest.id);
    plugin.active = false;
    statuses.set(plugin.manifest.id, {
      state: "disabled",
      summary: "Plugin is disabled.",
      details: {},
      actions: []
    });
  }

  function register(manifestInput, runtime = {}) {
    const manifest = normalizeManifest(manifestInput);

    if (plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`);
    }

    const plugin = {
      manifest,
      runtime,
      active: false,
      enabled: false
    };
    plugins.set(manifest.id, plugin);
    statuses.set(manifest.id, {
      state: "disabled",
      summary: "Plugin is disabled.",
      details: {},
      actions: []
    });

    return plugin;
  }

  function list() {
    return [...plugins.values()].map((plugin) => ({
      ...plugin.manifest,
      enabled: plugin.enabled,
      active: plugin.active
    }));
  }

  function setEnabled(pluginId, enabled) {
    const plugin = plugins.get(String(pluginId || ""));
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    plugin.enabled = enabled === true;
    if (plugin.enabled) {
      activatePlugin(plugin);
    } else {
      deactivatePlugin(plugin);
    }
    return {
      ...plugin.manifest,
      enabled: plugin.enabled,
      active: plugin.active
    };
  }

  function applyEnabledState(enabledByPlugin = {}) {
    for (const plugin of plugins.values()) {
      setEnabled(plugin.manifest.id, enabledByPlugin[plugin.manifest.id] !== false);
    }
  }

  function listPanes(filter = {}) {
    return [...panes.values()]
      .filter((pane) => !filter.scope || pane.scope === filter.scope)
      .filter((pane) => !filter.kind || pane.kind === filter.kind);
  }

  function listProjectSettingsSections() {
    return [...projectSettingsSections.values()];
  }

  function getStatus(pluginId) {
    return statuses.get(String(pluginId || "")) || null;
  }

  globalScope.DashtopPluginRegistry = Object.freeze({
    register,
    list,
    setEnabled,
    applyEnabledState,
    listPanes,
    listProjectSettingsSections,
    getStatus
  });
})(window);
