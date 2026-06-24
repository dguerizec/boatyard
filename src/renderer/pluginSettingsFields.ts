export function resolveFieldDefault(field: PluginSettingsField = {}, context: Record<string, unknown> = {}) {
    const defaultValue = typeof field.defaultValue === "function"
      ? field.defaultValue(context)
      : field.defaultValue;
    return String(defaultValue || "");
}

export function readFieldValue(
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

export function registerPluginSettingsFields(globalScope: PluginSettingsFieldsGlobal): PluginSettingsFieldsApi {
  const api = Object.freeze({
    readFieldValue,
    resolveFieldDefault
  });

  globalScope.BoatyardPluginSettingsFields = api;
  return api;
}
