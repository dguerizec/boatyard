"use strict";

(function registerWidgetRegistry(globalScope) {
  const widgets = new Map();
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
    return widgets.get(String(id || "")) || null;
  }

  function unregister(id) {
    return widgets.delete(String(id || ""));
  }

  globalScope.BoatyardWidgetRegistry = Object.freeze({
    register,
    list,
    get,
    unregister,
  });
})(window);
