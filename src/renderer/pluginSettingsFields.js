// @ts-check
"use strict";

/**
 * @typedef {{ defaultValue?: unknown | ((context: Record<string, unknown>) => unknown), required?: boolean, label?: string, valueType?: string }} PluginSettingsField
 * @typedef {{ value?: unknown, dataset?: { defaultValue?: unknown } }} PluginSettingsInput
 * @typedef {{ normalizeUrl?: (value: string) => string }} PluginSettingsReadOptions
 * @typedef {{ readFieldValue: typeof readFieldValue, resolveFieldDefault: typeof resolveFieldDefault }} PluginSettingsFieldsApi
 */

/**
 * @param {typeof globalThis & { BoatyardPluginSettingsFields?: PluginSettingsFieldsApi }} globalScope
 */
(function registerPluginSettingsFields(globalScope) {
  /**
   * @param {PluginSettingsField} field
   * @param {Record<string, unknown>} context
   * @returns {string}
   */
  function resolveFieldDefault(field = {}, context = {}) {
    const defaultValue = typeof field.defaultValue === "function"
      ? field.defaultValue(context)
      : field.defaultValue;
    return String(defaultValue || "");
  }

  /**
   * @param {PluginSettingsField} field
   * @param {PluginSettingsInput | null | undefined} input
   * @param {PluginSettingsReadOptions} options
   * @returns {string}
   */
  function readFieldValue(field = {}, input, options = {}) {
    const rawValue = String(input?.value || "").trim() ||
      String(input?.dataset?.defaultValue || "");

    if (!rawValue) {
      if (field.required) {
        throw new Error(`${field.label || "Field"} is required.`);
      }

      return "";
    }

    if (field.valueType === "url" && typeof options.normalizeUrl === "function") {
      return options.normalizeUrl(rawValue);
    }

    return rawValue;
  }

  const api = Object.freeze({
    readFieldValue,
    resolveFieldDefault
  });

  globalScope.BoatyardPluginSettingsFields = api;

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof window !== "undefined" ? window : globalThis);
