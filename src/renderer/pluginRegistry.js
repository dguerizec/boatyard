"use strict";

(function registerPluginRegistry(globalScope) {
  const plugins = new Map();
  const statuses = new Map();
  const panes = new Map();
  const projectNavBadges = new Map();
  const globalSettingsSections = new Map();
  const projectSettingsSections = new Map();
  const services = new Map();
  const widgetsByPlugin = new Map();
  const eventHandlers = new Map();

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

  function requireNamespacedContributionId(pluginId, id, label) {
    if (id !== pluginId && !id.startsWith(`${pluginId}.`)) {
      throw new Error(`${label} ${id} must be prefixed with plugin id ${pluginId}.`);
    }
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

  function publishStatus(pluginId, status) {
    const currentStatus = statuses.get(pluginId) || null;
    if (JSON.stringify(currentStatus) === JSON.stringify(status)) {
      return;
    }

    statuses.set(pluginId, status);

    if (typeof globalScope.dispatchEvent === "function" && typeof globalScope.CustomEvent === "function") {
      globalScope.dispatchEvent(new globalScope.CustomEvent("dashtop:plugin-status-changed", {
        detail: {
          pluginId,
          status
        }
      }));
    }
  }

  function normalizePaneDefinition(pluginId, definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error(`Plugin ${pluginId} pane definition must be an object.`);
    }

    const id = requireId(definition.id, "Pane");
    requireNamespacedContributionId(pluginId, id, "Pane");
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

  function normalizeProjectNavBadgeDefinition(pluginId, definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error(`Plugin ${pluginId} project nav badge definition must be an object.`);
    }

    const id = requireId(definition.id, "Project nav badge");
    requireNamespacedContributionId(pluginId, id, "Project nav badge");

    if (typeof definition.render !== "function") {
      throw new Error(`Project nav badge ${id} must provide render.`);
    }

    return {
      ...definition,
      id,
      pluginId
    };
  }

  function normalizeSettingsSection(pluginId, section, kind) {
    if (!section || typeof section !== "object") {
      throw new Error(`Plugin ${pluginId} ${kind} settings section must be an object.`);
    }

    const id = requireId(section.id, `${kind} settings section`);
    requireNamespacedContributionId(pluginId, id, `${kind} settings section`);
    const title = normalizeText(section.title || section.name);
    const fields = Array.isArray(section.fields)
      ? section.fields.map((field) => ({
          ...field,
          key: requireId(field.key, "Project settings field"),
          label: normalizeText(field.label || field.title || field.key),
          type: normalizeText(field.type || "text"),
          valueType: normalizeText(field.valueType || field.type || "text"),
          placeholder: normalizeText(field.placeholder),
          required: field.required === true
        }))
      : [];

    if (!title) {
      throw new Error(`${kind} settings section ${id} title is required.`);
    }

    if (!fields.length) {
      throw new Error(`${kind} settings section ${id} must provide fields.`);
    }

    return {
      ...section,
      id,
      pluginId,
      title,
      fields
    };
  }

  function normalizeGlobalSettingsSection(pluginId, section) {
    return normalizeSettingsSection(pluginId, section, "Global");
  }

  function normalizeProjectSettingsSection(pluginId, section) {
    return normalizeSettingsSection(pluginId, section, "Project");
  }

  function createContext(manifest) {
    const pluginId = manifest.id;

    return Object.freeze({
      plugin: manifest,
      status: Object.freeze({
        set(status) {
          publishStatus(pluginId, {
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
      projectNavBadges: Object.freeze({
        register(definition) {
          const normalized = normalizeProjectNavBadgeDefinition(pluginId, definition);
          if (projectNavBadges.has(normalized.id)) {
            throw new Error(`Project nav badge already registered: ${normalized.id}`);
          }

          projectNavBadges.set(normalized.id, normalized);
          return normalized;
        }
      }),
      settings: Object.freeze({
        registerGlobalSection(section) {
          const normalized = normalizeGlobalSettingsSection(pluginId, section);
          if (globalSettingsSections.has(normalized.id)) {
            throw new Error(`Global settings section already registered: ${normalized.id}`);
          }

          globalSettingsSections.set(normalized.id, normalized);
          return normalized;
        },
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

          const widgetId = requireId(definition?.id, "Widget");
          requireNamespacedContributionId(pluginId, widgetId, "Widget");
          const registered = globalScope.DashtopWidgetRegistry.register({
            ...definition,
            provider: manifest.name,
            pluginId
          });
          widgetsByPlugin.set(pluginId, [
            ...(widgetsByPlugin.get(pluginId) || []),
            registered.id
          ]);
          return registered;
        }
      }),
      services: Object.freeze({
        provide(serviceId, implementation) {
          const id = requireId(serviceId, "Service");
          requireNamespacedContributionId(pluginId, id, "Service");

          if (!implementation || typeof implementation !== "object") {
            throw new Error(`Service ${id} implementation must be an object.`);
          }

          if (services.has(id)) {
            throw new Error(`Service already registered: ${id}`);
          }

          const service = Object.freeze({
            id,
            pluginId,
            implementation
          });
          services.set(id, service);
          return implementation;
        },
        get(serviceId) {
          return services.get(String(serviceId || ""))?.implementation || null;
        },
        list() {
          return [...services.values()].map((service) => ({
            id: service.id,
            pluginId: service.pluginId
          }));
        }
      }),
      events: Object.freeze({
        on(eventName, handler) {
          const name = requireId(eventName, "Event");
          if (typeof handler !== "function") {
            throw new Error(`Event ${name} handler must be a function.`);
          }

          const nextHandlers = [
            ...(eventHandlers.get(name) || []),
            { pluginId, handler }
          ];
          eventHandlers.set(name, nextHandlers);

          return () => {
            eventHandlers.set(
              name,
              (eventHandlers.get(name) || []).filter((entry) => entry.handler !== handler)
            );
          };
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

    for (const [badgeId, badge] of projectNavBadges) {
      if (badge.pluginId === pluginId) {
        projectNavBadges.delete(badgeId);
      }
    }

    for (const [sectionId, section] of globalSettingsSections) {
      if (section.pluginId === pluginId) {
        globalSettingsSections.delete(sectionId);
      }
    }

    for (const [sectionId, section] of projectSettingsSections) {
      if (section.pluginId === pluginId) {
        projectSettingsSections.delete(sectionId);
      }
    }

    for (const [serviceId, service] of services) {
      if (service.pluginId === pluginId) {
        services.delete(serviceId);
      }
    }

    for (const [eventName, handlers] of eventHandlers) {
      const remainingHandlers = handlers.filter((handler) => handler.pluginId !== pluginId);
      if (remainingHandlers.length) {
        eventHandlers.set(eventName, remainingHandlers);
      } else {
        eventHandlers.delete(eventName);
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
    try {
      if (typeof plugin.runtime.activate === "function") {
        plugin.runtime.activate(context);
      } else {
        context.status.set({ state: "ready" });
      }
      plugin.active = true;
    } catch (error) {
      removePluginContributions(plugin.manifest.id);
      plugin.active = false;
      statuses.set(plugin.manifest.id, {
        state: "error",
        summary: error.message,
        details: {},
        actions: []
      });
      throw error;
    }
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

  function reload(pluginId) {
    const plugin = plugins.get(String(pluginId || ""));
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    if (!plugin.enabled) {
      return {
        ...plugin.manifest,
        enabled: plugin.enabled,
        active: plugin.active
      };
    }

    deactivatePlugin(plugin);
    plugin.enabled = true;
    activatePlugin(plugin);
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

  function listProjectNavBadges() {
    return [...projectNavBadges.values()];
  }

  function listGlobalSettingsSections() {
    return [...globalSettingsSections.values()];
  }

  function listProjectSettingsSections() {
    return [...projectSettingsSections.values()];
  }

  function getService(serviceId) {
    return services.get(String(serviceId || ""))?.implementation || null;
  }

  function listServices() {
    return [...services.values()].map((service) => ({
      id: service.id,
      pluginId: service.pluginId
    }));
  }

  function emit(eventName, payload = {}) {
    const name = String(eventName || "").trim();
    if (!name) {
      return;
    }

    for (const { pluginId, handler } of eventHandlers.get(name) || []) {
      const scopedPayload = typeof payload.forPlugin === "function"
        ? { ...payload, ...payload.forPlugin(pluginId) }
        : payload;
      handler(scopedPayload);
    }
  }

  function getStatus(pluginId) {
    return statuses.get(String(pluginId || "")) || null;
  }

  globalScope.DashtopPluginRegistry = Object.freeze({
    register,
    list,
    setEnabled,
    reload,
    applyEnabledState,
    listPanes,
    listProjectNavBadges,
    listGlobalSettingsSections,
    listProjectSettingsSections,
    getService,
    listServices,
    emit,
    getStatus
  });
})(window);
