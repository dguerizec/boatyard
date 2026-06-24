type WidgetRegistryWindow = Window & {
  BoatyardWidgetRegistry?: WidgetRegistryApi;
};

(function registerWidgetRegistry(globalScope: WidgetRegistryWindow) {
  const widgets = new Map<string, WidgetDefinition>();
  const aliases = new Map<string, string>();
  const allowedStatuses = new Set<WidgetStatus>(["stable", "experimental"]);

  function normalizeText(value: unknown): string {
    return String(value || "").trim();
  }

  function normalizeScopes(definition: WidgetDefinitionInput): string[] {
    const source = Array.isArray(definition.scopes)
      ? definition.scopes
      : [definition.scope || "project"];
    const scopes = source
      .map(normalizeText)
      .filter((scope, index, values) => scope && values.indexOf(scope) === index);

    return scopes.length ? scopes : ["project"];
  }

  function normalizeGridSize(size: Partial<WidgetGridSize> | undefined, fallback: WidgetGridSize): WidgetGridSize {
    const source = size && typeof size === "object" ? size : fallback;
    return {
      columns: Math.max(
        1,
        Math.round(Number(source.columns) || fallback.columns),
      ),
      rows: Math.max(1, Math.round(Number(source.rows) || fallback.rows)),
    };
  }

  function normalizeLayout(layout: WidgetLayoutInput = {}): WidgetLayout {
    const defaultSize = normalizeGridSize(layout.default, {
      columns: 1,
      rows: 2,
    });
    const normalized: WidgetLayout = {
      default: defaultSize,
      min: normalizeGridSize(layout.min, { columns: 1, rows: 1 }),
    };

    if (layout.max) {
      normalized.max = normalizeGridSize(layout.max, defaultSize);
    }

    return normalized;
  }

  function normalizeWidgetDefinition(definition: WidgetDefinitionInput): WidgetDefinition {
    if (!definition || typeof definition !== "object") {
      throw new Error("Widget definition must be an object.");
    }

    const id = normalizeText(definition.id);
    const name = normalizeText(definition.name || definition.title);
    const scopes = normalizeScopes(definition);
    const rawStatus = normalizeText(definition.status);
    const status = allowedStatuses.has(rawStatus as WidgetStatus)
      ? rawStatus as WidgetStatus
      : "experimental";

    if (!id) {
      throw new Error("Widget id is required.");
    }

    if (!name) {
      throw new Error(`Widget ${id} name is required.`);
    }

    if (
      typeof definition.create !== "function" &&
      typeof definition.createElement !== "function"
    ) {
      throw new Error(`Widget ${id} must provide create or createElement.`);
    }

    return {
      ...definition,
      id,
      name,
      title: normalizeText(definition.title || name),
      scope: scopes[0],
      scopes,
      category: normalizeText(definition.category || "General"),
      status,
      description: normalizeText(definition.description),
      provider: normalizeText(definition.provider || "Boatyard"),
      layout: normalizeLayout(definition.layout),
      requires: Array.isArray(definition.requires) ? definition.requires : [],
    };
  }

  function register(definition: WidgetDefinitionInput): WidgetDefinition {
    const normalized = normalizeWidgetDefinition(definition);

    if (widgets.has(normalized.id)) {
      throw new Error(`Widget already registered: ${normalized.id}`);
    }

    widgets.set(normalized.id, normalized);
    return normalized;
  }

  function list(filter: WidgetListFilter = {}): WidgetDefinition[] {
    return [...widgets.values()]
      .filter((widget) => !filter.scope || widget.scopes.includes(filter.scope))
      .filter((widget) => !filter.status || widget.status === filter.status);
  }

  function get(id: unknown): WidgetDefinition | null {
    return widgets.get(resolveId(id)) || null;
  }

  function unregister(id: unknown): boolean {
    const normalizedId = String(id || "");
    for (const [alias, targetId] of aliases) {
      if (alias === normalizedId || targetId === normalizedId) {
        aliases.delete(alias);
      }
    }
    return widgets.delete(normalizedId);
  }

  function registerAlias(alias: unknown, targetId: unknown): WidgetAlias {
    const normalizedAlias = normalizeText(alias);
    const normalizedTargetId = normalizeText(targetId);

    if (!normalizedAlias) {
      throw new Error("Widget alias is required.");
    }

    if (!normalizedTargetId) {
      throw new Error(`Widget alias ${normalizedAlias} target is required.`);
    }

    aliases.set(normalizedAlias, normalizedTargetId);
    return { alias: normalizedAlias, targetId: normalizedTargetId };
  }

  function unregisterAlias(alias: unknown): boolean {
    return aliases.delete(String(alias || ""));
  }

  function resolveId(id: unknown): string {
    const normalizedId = String(id || "").trim();
    return aliases.get(normalizedId) || normalizedId;
  }

  function listAliases(): WidgetAlias[] {
    return [...aliases.entries()].map(([alias, targetId]) => ({ alias, targetId }));
  }

  globalScope.BoatyardWidgetRegistry = Object.freeze({
    register,
    registerAlias,
    list,
    get,
    resolveId,
    listAliases,
    unregister,
    unregisterAlias,
  });
})(window as WidgetRegistryWindow);
