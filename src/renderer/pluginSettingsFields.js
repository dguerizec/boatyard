"use strict";

(function registerPluginSettingsFields(globalScope) {
  function resolveFieldDefault(field = {}, context = {}) {
    const defaultValue = typeof field.defaultValue === "function"
      ? field.defaultValue(context)
      : field.defaultValue;
    return String(defaultValue || "");
  }

  function readFieldValue(field = {}, input, options = {}) {
    const rawValue = String(input?.value || "").trim() ||
      String(input?.dataset?.defaultValue || "");

    if (!rawValue) {
      if (field.required) {
        throw new Error(`${field.label} is required.`);
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
