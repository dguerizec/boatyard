type WebAppShowNavigationOptions = {
  configuredUrl: string;
  previousConfiguredUrl: string | null;
  restoredUrl: string | null;
  restoreUrl: boolean;
};

export function resolveWebAppShowNavigation({
  configuredUrl,
  previousConfiguredUrl,
  restoredUrl,
  restoreUrl
}: WebAppShowNavigationOptions) {
  if (!previousConfiguredUrl) {
    return restoreUrl ? restoredUrl || configuredUrl : configuredUrl;
  }

  if (!restoreUrl && previousConfiguredUrl !== configuredUrl) {
    return configuredUrl;
  }

  return null;
}
