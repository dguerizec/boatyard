export type ShareScreenSettings = { screenHidden: boolean; sharedProjectIds: string[] };

export function parseSharedProjectIds(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 10000 || value.some(id => typeof id !== "string" || !id || id.length > 512)) {
    throw new Error("Invalid shared projects.");
  }
  return [...new Set(value as string[])];
}

// A project key includes its configuration context so profiles cannot share by accident.
export function sharedProjectKey(contextId: string, projectId: string) { return `${contextId}:${projectId}`; }

export function canShareScreen(settings: ShareScreenSettings, contextId: string, navigation: { view?: string; projectId?: string | null }) {
  return !settings.screenHidden && navigation.view === "project" && Boolean(navigation.projectId)
    && settings.sharedProjectIds.includes(sharedProjectKey(contextId, navigation.projectId!));
}
