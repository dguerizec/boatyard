type PluginSettingsField = {
  defaultValue?: unknown | ((context: Record<string, unknown>) => unknown);
  required?: boolean;
  label?: string;
  valueType?: string;
};

type PluginSettingsInput = {
  value?: unknown;
  dataset?: {
    defaultValue?: unknown;
  };
};

type PluginSettingsReadOptions = {
  normalizeUrl?: (value: string) => string;
};

type PluginSettingsFieldsApi = {
  readFieldValue: (
    field?: PluginSettingsField,
    input?: PluginSettingsInput | null,
    options?: PluginSettingsReadOptions
  ) => string;
  resolveFieldDefault: (field?: PluginSettingsField, context?: Record<string, unknown>) => string;
};

type PluginSettingsFieldsGlobal = typeof globalThis & {
  BoatyardPluginSettingsFields?: PluginSettingsFieldsApi;
};

(function registerPluginSettingsFields(globalScope: PluginSettingsFieldsGlobal) {
  function resolveFieldDefault(field: PluginSettingsField = {}, context: Record<string, unknown> = {}) {
    const defaultValue = typeof field.defaultValue === "function"
      ? field.defaultValue(context)
      : field.defaultValue;
    return String(defaultValue || "");
  }

  function readFieldValue(
    field: PluginSettingsField = {},
    input?: PluginSettingsInput | null,
    options: PluginSettingsReadOptions = {}
  ) {
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
