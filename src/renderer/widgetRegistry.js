"use strict";

(function registerWidgetRegistry(globalScope) {
  const widgets = new Map();
  const aliases = new Map();
  const allowedStatuses = new Set(["stable", "experimental"]);

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function normalizeScopes(definition) {
    const source = Array.isArray(definition.scopes)
      ? definition.scopes
      : [definition.scope || "project"];
    const scopes = source
      .map(normalizeText)
      .filter((scope, index, values) => scope && values.indexOf(scope) === index);

    return scopes.length ? scopes : ["project"];
  }

  function normalizeGridSize(size, fallback) {
    const source = size && typeof size === "object" ? size : fallback;
    return {
      columns: Math.max(
        1,
        Math.round(Number(source.columns) || fallback.columns),
      ),
      rows: Math.max(1, Math.round(Number(source.rows) || fallback.rows)),
    };
  }

  function normalizeLayout(layout = {}) {
    const defaultSize = normalizeGridSize(layout.default, {
      columns: 1,
      rows: 2,
    });
    const normalized = {
      default: defaultSize,
      min: normalizeGridSize(layout.min, { columns: 1, rows: 1 }),
    };

    if (layout.max) {
      normalized.max = normalizeGridSize(layout.max, defaultSize);
    }

    return normalized;
  }

  function normalizeWidgetDefinition(definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error("Widget definition must be an object.");
    }

    const id = normalizeText(definition.id);
    const name = normalizeText(definition.name || definition.title);
    const scopes = normalizeScopes(definition);
    const status = allowedStatuses.has(definition.status)
      ? definition.status
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

  function register(definition) {
    const normalized = normalizeWidgetDefinition(definition);

    if (widgets.has(normalized.id)) {
      throw new Error(`Widget already registered: ${normalized.id}`);
    }

    widgets.set(normalized.id, normalized);
    return normalized;
  }

  function list(filter = {}) {
    return [...widgets.values()]
      .filter((widget) => !filter.scope || widget.scopes.includes(filter.scope))
      .filter((widget) => !filter.status || widget.status === filter.status);
  }

  function get(id) {
    return widgets.get(resolveId(id)) || null;
  }

  function unregister(id) {
    const normalizedId = String(id || "");
    for (const [alias, targetId] of aliases) {
      if (alias === normalizedId || targetId === normalizedId) {
        aliases.delete(alias);
      }
    }
    return widgets.delete(normalizedId);
  }

  function registerAlias(alias, targetId) {
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

  function unregisterAlias(alias) {
    return aliases.delete(String(alias || ""));
  }

  function resolveId(id) {
    const normalizedId = String(id || "").trim();
    return aliases.get(normalizedId) || normalizedId;
  }

  function listAliases() {
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
})(window);
