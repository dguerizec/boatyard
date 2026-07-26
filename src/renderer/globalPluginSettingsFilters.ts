export type GlobalPluginStatusGroup = "all" | "attention" | "disabled" | "error" | "ready";

type FilterablePlugin = {
  description?: unknown;
  id?: unknown;
  name?: unknown;
  statusState?: unknown;
  statusSummary?: unknown;
};

export function getGlobalPluginStatusGroup(statusState: unknown): Exclude<GlobalPluginStatusGroup, "all"> {
  const state = String(statusState || "unknown");
  if (state === "ready") {
    return "ready";
  }
  if (state === "disabled") {
    return "disabled";
  }
  if (state === "unavailable" || state === "error") {
    return "error";
  }
  return "attention";
}

export function matchesGlobalPluginFilter(
  plugin: FilterablePlugin,
  query: unknown,
  statusGroup: unknown
) {
  const normalizedQuery = String(query || "").trim().toLocaleLowerCase();
  const requestedStatus = String(statusGroup || "all");
  const pluginStatus = getGlobalPluginStatusGroup(plugin.statusState);
  if (requestedStatus !== "all" && pluginStatus !== requestedStatus) {
    return false;
  }

  if (!normalizedQuery) {
    return true;
  }

  return [
    plugin.id,
    plugin.name,
    plugin.description,
    plugin.statusSummary
  ].some((value) => String(value || "").toLocaleLowerCase().includes(normalizedQuery));
}
