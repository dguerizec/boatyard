// @ts-check
"use strict";

/**
 * @typedef {{ columns: number, rows: number }} WidgetGridSize
 * @typedef {{ default?: Partial<WidgetGridSize>, min?: Partial<WidgetGridSize>, max?: Partial<WidgetGridSize> }} WidgetLayoutInput
 * @typedef {{ default: WidgetGridSize, min: WidgetGridSize, max?: WidgetGridSize }} WidgetLayout
 * @typedef {{
 *   id?: unknown,
 *   name?: unknown,
 *   title?: unknown,
 *   scope?: unknown,
 *   scopes?: unknown[],
 *   category?: unknown,
 *   status?: unknown,
 *   description?: unknown,
 *   provider?: unknown,
 *   layout?: WidgetLayoutInput,
 *   requires?: unknown,
 *   create?: unknown,
 *   createElement?: unknown,
 *   [key: string]: unknown
 * }} WidgetDefinitionInput
 * @typedef {WidgetDefinitionInput & {
 *   id: string,
 *   name: string,
 *   title: string,
 *   scope: string,
 *   scopes: string[],
 *   category: string,
 *   status: "stable" | "experimental",
 *   description: string,
 *   provider: string,
 *   layout: WidgetLayout,
 *   requires: unknown[]
 * }} WidgetDefinition
 * @typedef {{ scope?: string, status?: "stable" | "experimental" }} WidgetListFilter
 * @typedef {{ alias: string, targetId: string }} WidgetAlias
 * @typedef {{
 *   register(definition: WidgetDefinitionInput): WidgetDefinition,
 *   registerAlias(alias: unknown, targetId: unknown): WidgetAlias,
 *   list(filter?: WidgetListFilter): WidgetDefinition[],
 *   get(id: unknown): WidgetDefinition | null,
 *   resolveId(id: unknown): string,
 *   listAliases(): WidgetAlias[],
 *   unregister(id: unknown): boolean,
 *   unregisterAlias(alias: unknown): boolean
 * }} WidgetRegistryApi
 */

/**
 * @param {Window & { BoatyardWidgetRegistry?: WidgetRegistryApi }} globalScope
 */
(function registerWidgetRegistry(globalScope) {
  /** @type {Map<string, WidgetDefinition>} */
  const widgets = new Map();
  /** @type {Map<string, string>} */
  const aliases = new Map();
  /** @type {Set<WidgetDefinition["status"]>} */
  const allowedStatuses = new Set(["stable", "experimental"]);

  /**
   * @param {unknown} value
   * @returns {string}
   */
  function normalizeText(value) {
    return String(value || "").trim();
  }

  /**
   * @param {WidgetDefinitionInput} definition
   * @returns {string[]}
   */
  function normalizeScopes(definition) {
    const source = Array.isArray(definition.scopes)
      ? definition.scopes
      : [definition.scope || "project"];
    const scopes = source
      .map(normalizeText)
      .filter((scope, index, values) => scope && values.indexOf(scope) === index);

    return scopes.length ? scopes : ["project"];
  }

  /**
   * @param {Partial<WidgetGridSize> | undefined} size
   * @param {WidgetGridSize} fallback
   * @returns {WidgetGridSize}
   */
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

  /**
   * @param {WidgetLayoutInput} layout
   * @returns {WidgetLayout}
   */
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

  /**
   * @param {WidgetDefinitionInput} definition
   * @returns {WidgetDefinition}
   */
  function normalizeWidgetDefinition(definition) {
    if (!definition || typeof definition !== "object") {
      throw new Error("Widget definition must be an object.");
    }

    const id = normalizeText(definition.id);
    const name = normalizeText(definition.name || definition.title);
    const scopes = normalizeScopes(definition);
    const rawStatus = normalizeText(definition.status);
    const status = allowedStatuses.has(/** @type {WidgetDefinition["status"]} */ (rawStatus))
      ? /** @type {WidgetDefinition["status"]} */ (rawStatus)
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

  /**
   * @param {WidgetDefinitionInput} definition
   * @returns {WidgetDefinition}
   */
  function register(definition) {
    const normalized = normalizeWidgetDefinition(definition);

    if (widgets.has(normalized.id)) {
      throw new Error(`Widget already registered: ${normalized.id}`);
    }

    widgets.set(normalized.id, normalized);
    return normalized;
  }

  /**
   * @param {WidgetListFilter} filter
   * @returns {WidgetDefinition[]}
   */
  function list(filter = {}) {
    return [...widgets.values()]
      .filter((widget) => !filter.scope || widget.scopes.includes(filter.scope))
      .filter((widget) => !filter.status || widget.status === filter.status);
  }

  /**
   * @param {unknown} id
   * @returns {WidgetDefinition | null}
   */
  function get(id) {
    return widgets.get(resolveId(id)) || null;
  }

  /**
   * @param {unknown} id
   * @returns {boolean}
   */
  function unregister(id) {
    const normalizedId = String(id || "");
    for (const [alias, targetId] of aliases) {
      if (alias === normalizedId || targetId === normalizedId) {
        aliases.delete(alias);
      }
    }
    return widgets.delete(normalizedId);
  }

  /**
   * @param {unknown} alias
   * @param {unknown} targetId
   * @returns {WidgetAlias}
   */
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

  /**
   * @param {unknown} alias
   * @returns {boolean}
   */
  function unregisterAlias(alias) {
    return aliases.delete(String(alias || ""));
  }

  /**
   * @param {unknown} id
   * @returns {string}
   */
  function resolveId(id) {
    const normalizedId = String(id || "").trim();
    return aliases.get(normalizedId) || normalizedId;
  }

  /**
   * @returns {WidgetAlias[]}
   */
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
})(/** @type {Window & { BoatyardWidgetRegistry?: WidgetRegistryApi }} */ (window));
