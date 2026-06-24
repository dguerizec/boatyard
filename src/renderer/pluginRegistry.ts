(function registerPluginRegistry(globalScope: PluginRegistryWindow) {
  const plugins = new Map<string, RegisteredPlugin>();
  const statuses = new Map<string, PluginStatus>();
  const panes = new Map<string, PluginPaneDefinition>();
  const projectNavBadges = new Map<string, PluginProjectNavBadgeDefinition>();
  const globalSettingsSections = new Map<string, PluginSettingsSection>();
  const projectSettingsSections = new Map<string, PluginSettingsSection>();
  const services = new Map<string, PluginService>();
  const widgetsByPlugin = new Map<string, string[]>();
  const eventHandlers = new Map<string, PluginEventHandler[]>();

  function isRecord(value: unknown): value is PluginRegistryRecord {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeText(value: unknown): string {
    return String(value || "").trim();
  }

  function requireId(value: unknown, label: string): string {
    const id = normalizeText(value);
    if (!id) {
      throw new Error(`${label} id is required.`);
    }

    return id;
  }

  function requireNamespacedContributionId(pluginId: string, id: string, label: string): void {
    if (id !== pluginId && !id.startsWith(`${pluginId}.`)) {
      throw new Error(`${label} ${id} must be prefixed with plugin id ${pluginId}.`);
    }
  }

  function isPluginPaneKind(value: string): value is PluginPaneDefinition["kind"] {
    return value === "wcv" || value === "dom";
  }

  function normalizeManifest(manifest: PluginRegistryRecord): PluginManifest {
    if (!isRecord(manifest)) {
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

  function publishStatus(pluginId: string, status: PluginStatus): void {
    const currentStatus = statuses.get(pluginId) || null;
    if (JSON.stringify(currentStatus) === JSON.stringify(status)) {
      return;
    }

    statuses.set(pluginId, status);

    if (typeof globalScope.dispatchEvent === "function" && typeof globalScope.CustomEvent === "function") {
      globalScope.dispatchEvent(new globalScope.CustomEvent("boatyard:plugin-status-changed", {
        detail: {
          pluginId,
          status
        }
      }));
    }
  }

  function normalizePaneDefinition(pluginId: string, definition: PluginPaneDefinitionInput): PluginPaneDefinition {
    if (!isRecord(definition)) {
      throw new Error(`Plugin ${pluginId} pane definition must be an object.`);
    }

    const id = requireId(definition.id, "Pane");
    requireNamespacedContributionId(pluginId, id, "Pane");
    const title = normalizeText(definition.title || definition.name);
    const requestedKind = normalizeText(definition.kind || "wcv");

    if (!title) {
      throw new Error(`Pane ${id} title is required.`);
    }

    if (!isPluginPaneKind(requestedKind)) {
      throw new Error(`Pane ${id} kind must be wcv or dom.`);
    }

    if (
      requestedKind === "wcv" &&
      typeof definition.resolveUrl !== "function" &&
      typeof definition.resolveWebApps !== "function"
    ) {
      throw new Error(`WCV pane ${id} must provide resolveUrl or resolveWebApps.`);
    }

    if (requestedKind === "dom" && typeof definition.render !== "function") {
      throw new Error(`DOM pane ${id} must provide render.`);
    }

    return {
      ...definition,
      id,
      pluginId,
      title,
      kind: requestedKind,
      scope: normalizeText(definition.scope || "project"),
      webAppId: normalizeText(definition.webAppId || id),
      key: normalizeText(definition.key || definition.webAppId || id)
    };
  }

  function normalizeProjectNavBadgeDefinition(
    pluginId: string,
    definition: PluginProjectNavBadgeDefinitionInput
  ): PluginProjectNavBadgeDefinition {
    if (!isRecord(definition)) {
      throw new Error(`Plugin ${pluginId} project nav badge definition must be an object.`);
    }

    const id = requireId(definition.id, "Project nav badge");
    requireNamespacedContributionId(pluginId, id, "Project nav badge");

    if (typeof definition.render !== "function") {
      throw new Error(`Project nav badge ${id} must provide render.`);
    }

    const { render } = definition;
    return {
      ...definition,
      id,
      pluginId,
      render
    };
  }

  function normalizeSettingsField(field: unknown, kind: string): PluginSettingsFieldDefinition {
    if (!isRecord(field)) {
      throw new Error(`${kind} settings field must be an object.`);
    }

    return {
      ...field,
      key: requireId(field.key, "Project settings field"),
      label: normalizeText(field.label || field.title || field.key),
      type: normalizeText(field.type || "text"),
      valueType: normalizeText(field.valueType || field.type || "text"),
      placeholder: normalizeText(field.placeholder),
      required: field.required === true
    };
  }

  function normalizeSettingsSection(pluginId: string, section: PluginRegistryRecord, kind: string): PluginSettingsSection {
    if (!isRecord(section)) {
      throw new Error(`Plugin ${pluginId} ${kind} settings section must be an object.`);
    }

    const id = requireId(section.id, `${kind} settings section`);
    requireNamespacedContributionId(pluginId, id, `${kind} settings section`);
    const title = normalizeText(section.title || section.name);
    const fields = Array.isArray(section.fields)
      ? section.fields.map((field) => normalizeSettingsField(field, kind))
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

  function normalizeGlobalSettingsSection(pluginId: string, section: PluginRegistryRecord): PluginSettingsSection {
    return normalizeSettingsSection(pluginId, section, "Global");
  }

  function normalizeProjectSettingsSection(pluginId: string, section: PluginRegistryRecord): PluginSettingsSection {
    return normalizeSettingsSection(pluginId, section, "Project");
  }

  function createContext(manifest: PluginManifest): PluginRegistryContext {
    const pluginId = manifest.id;

    return Object.freeze({
      plugin: manifest,
      status: Object.freeze({
        set(status: Partial<PluginStatus>) {
          publishStatus(pluginId, {
            state: normalizeText(status?.state || "ready"),
            summary: normalizeText(status?.summary),
            details: status?.details && typeof status.details === "object" ? { ...status.details } : {},
            actions: Array.isArray(status?.actions) ? [...status.actions] : []
          });
        },
        get(): PluginStatus | null {
          return statuses.get(pluginId) || null;
        }
      }),
      panes: Object.freeze({
        register(definition: PluginPaneDefinitionInput): PluginPaneDefinition {
          const normalized = normalizePaneDefinition(pluginId, definition);
          if (panes.has(normalized.id)) {
            throw new Error(`Pane already registered: ${normalized.id}`);
          }

          panes.set(normalized.id, normalized);
          return normalized;
        }
      }),
      projectNavBadges: Object.freeze({
        register(definition: PluginProjectNavBadgeDefinitionInput): PluginProjectNavBadgeDefinition {
          const normalized = normalizeProjectNavBadgeDefinition(pluginId, definition);
          if (projectNavBadges.has(normalized.id)) {
            throw new Error(`Project nav badge already registered: ${normalized.id}`);
          }

          projectNavBadges.set(normalized.id, normalized);
          return normalized;
        }
      }),
      settings: Object.freeze({
        registerGlobalSection(section: PluginRegistryRecord): PluginSettingsSection {
          const normalized = normalizeGlobalSettingsSection(pluginId, section);
          if (globalSettingsSections.has(normalized.id)) {
            throw new Error(`Global settings section already registered: ${normalized.id}`);
          }

          globalSettingsSections.set(normalized.id, normalized);
          return normalized;
        },
        registerProjectSection(section: PluginRegistryRecord): PluginSettingsSection {
          const normalized = normalizeProjectSettingsSection(pluginId, section);
          if (projectSettingsSections.has(normalized.id)) {
            throw new Error(`Project settings section already registered: ${normalized.id}`);
          }

          projectSettingsSections.set(normalized.id, normalized);
          return normalized;
        }
      }),
      widgets: Object.freeze({
        register(definition: WidgetDefinitionInput): WidgetDefinition {
          if (!globalScope.BoatyardWidgetRegistry) {
            throw new Error("Widget registry is unavailable.");
          }

          const widgetId = requireId(definition?.id, "Widget");
          requireNamespacedContributionId(pluginId, widgetId, "Widget");
          const registered = globalScope.BoatyardWidgetRegistry.register({
            ...definition,
            provider: manifest.name,
            pluginId
          });
          widgetsByPlugin.set(pluginId, [
            ...(widgetsByPlugin.get(pluginId) || []),
            registered.id
          ]);
          return registered;
        },
        registerAlias(alias: unknown, targetId: unknown): WidgetAlias {
          if (!globalScope.BoatyardWidgetRegistry) {
            throw new Error("Widget registry is unavailable.");
          }

          const normalizedAlias = requireId(alias, "Widget alias");
          const normalizedTargetId = requireId(targetId, "Widget alias target");
          requireNamespacedContributionId(pluginId, normalizedTargetId, "Widget alias target");
          const registered = globalScope.BoatyardWidgetRegistry.registerAlias(normalizedAlias, normalizedTargetId);
          widgetsByPlugin.set(pluginId, [
            ...(widgetsByPlugin.get(pluginId) || []),
            registered.alias
          ]);
          return registered;
        }
      }),
      services: Object.freeze({
        provide(serviceId: unknown, implementation: PluginRegistryRecord): PluginRegistryRecord {
          const id = requireId(serviceId, "Service");
          requireNamespacedContributionId(pluginId, id, "Service");

          if (!isRecord(implementation)) {
            throw new Error(`Service ${id} implementation must be an object.`);
          }

          if (services.has(id)) {
            throw new Error(`Service already registered: ${id}`);
          }

          const service: PluginService = Object.freeze({
            id,
            pluginId,
            implementation
          });
          services.set(id, service);
          return implementation;
        },
        get<TService extends PluginRegistryRecord = PluginRegistryRecord>(serviceId: unknown): TService | null {
          return (services.get(String(serviceId || ""))?.implementation || null) as TService | null;
        },
        list(): Array<{ id: string; pluginId: string }> {
          return [...services.values()].map((service) => ({
            id: service.id,
            pluginId: service.pluginId
          }));
        }
      }),
      events: Object.freeze({
        on(eventName: unknown, handler: unknown): () => void {
          const name = requireId(eventName, "Event");
          if (typeof handler !== "function") {
            throw new Error(`Event ${name} handler must be a function.`);
          }

          const eventHandler = handler as (payload: PluginRegistryRecord) => void;
          const nextHandlers = [
            ...(eventHandlers.get(name) || []),
            { pluginId, handler: eventHandler }
          ];
          eventHandlers.set(name, nextHandlers);

          return () => {
            eventHandlers.set(
              name,
              (eventHandlers.get(name) || []).filter((entry) => entry.handler !== eventHandler)
            );
          };
        }
      })
    });
  }

  function removePluginContributions(pluginId: string): void {
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

    if (globalScope.BoatyardWidgetRegistry) {
      for (const widgetId of widgetsByPlugin.get(pluginId) || []) {
        globalScope.BoatyardWidgetRegistry.unregister(widgetId);
        globalScope.BoatyardWidgetRegistry.unregisterAlias?.(widgetId);
      }
    }
    widgetsByPlugin.delete(pluginId);
  }

  function activatePlugin(plugin: RegisteredPlugin): void {
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
        summary: error instanceof Error ? error.message : String(error),
        details: {},
        actions: []
      });
      throw error;
    }
  }

  function deactivatePlugin(plugin: RegisteredPlugin): void {
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

  function register(manifestInput: PluginRegistryRecord, runtime: PluginRuntime = {}): RegisteredPlugin {
    const manifest = normalizeManifest(manifestInput);

    if (plugins.has(manifest.id)) {
      throw new Error(`Plugin already registered: ${manifest.id}`);
    }

    const plugin: RegisteredPlugin = {
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

  function list(): PluginListEntry[] {
    return [...plugins.values()].map((plugin) => ({
      ...plugin.manifest,
      enabled: plugin.enabled,
      active: plugin.active
    }));
  }

  function pluginListEntry(plugin: RegisteredPlugin): PluginListEntry {
    return {
      ...plugin.manifest,
      enabled: plugin.enabled,
      active: plugin.active
    };
  }

  function setEnabled(pluginId: unknown, enabled: unknown): PluginListEntry {
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
    return pluginListEntry(plugin);
  }

  function reload(pluginId: unknown): PluginListEntry {
    const plugin = plugins.get(String(pluginId || ""));
    if (!plugin) {
      throw new Error(`Unknown plugin: ${pluginId}`);
    }

    if (!plugin.enabled) {
      return pluginListEntry(plugin);
    }

    deactivatePlugin(plugin);
    plugin.enabled = true;
    activatePlugin(plugin);
    return pluginListEntry(plugin);
  }

  function applyEnabledState(enabledByPlugin: PluginRegistryRecord = {}): void {
    for (const plugin of plugins.values()) {
      try {
        setEnabled(plugin.manifest.id, enabledByPlugin[plugin.manifest.id] !== false);
      } catch (error) {
        console.error(`Could not apply enabled state for plugin ${plugin.manifest.id}:`, error);
      }
    }
  }

  function listPanes(filter: PluginPaneListFilter = {}): PluginPaneDefinition[] {
    return [...panes.values()]
      .filter((pane) => !filter.scope || pane.scope === filter.scope)
      .filter((pane) => !filter.kind || pane.kind === filter.kind);
  }

  function listProjectNavBadges(): PluginProjectNavBadgeDefinition[] {
    return [...projectNavBadges.values()];
  }

  function listGlobalSettingsSections(): PluginSettingsSection[] {
    return [...globalSettingsSections.values()];
  }

  function listProjectSettingsSections(): PluginSettingsSection[] {
    return [...projectSettingsSections.values()];
  }

  function getService<TService extends PluginRegistryRecord = PluginRegistryRecord>(serviceId: unknown): TService | null {
    return (services.get(String(serviceId || ""))?.implementation || null) as TService | null;
  }

  function listServices(): Array<{ id: string; pluginId: string }> {
    return [...services.values()].map((service) => ({
      id: service.id,
      pluginId: service.pluginId
    }));
  }

  function emit(eventName: unknown, payload: PluginRegistryRecord = {}): void {
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

  function getStatus(pluginId: unknown): PluginStatus | null {
    return statuses.get(String(pluginId || "")) || null;
  }

  globalScope.BoatyardPluginRegistry = Object.freeze({
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
