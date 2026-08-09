import type { WebAppPaneNavigation, WebAppPaneNavigationItem } from "./rendererTypes.js";

function normalizeComparableUrl(value: unknown) {
  return String(value || "").replace(/\/+$/g, "");
}

function matchesUrlPattern(url: string, pattern: string) {
  try {
    return new RegExp(pattern).test(url);
  } catch {
    return false;
  }
}

export function shouldUseCompactPaneBrowserControls(navigation?: WebAppPaneNavigation) {
  return Boolean(navigation?.items.length && navigation.showAddressBar === false);
}

export function isPaneNavigationItemActive(
  item: WebAppPaneNavigationItem,
  selectedWebAppId: string,
  currentUrl: string
) {
  const targetWebAppId = item.webAppId || selectedWebAppId;
  if (targetWebAppId !== selectedWebAppId) {
    return false;
  }

  if (item.activeUrlPatterns?.length) {
    return item.activeUrlPatterns.some((pattern) => matchesUrlPattern(currentUrl, pattern));
  }

  if (item.url) {
    return normalizeComparableUrl(currentUrl) === normalizeComparableUrl(item.url);
  }

  return true;
}

export function syncPaneNavigationButtonUrl(button: HTMLButtonElement, currentUrl: string) {
  let activeUrlPatterns: string[] = [];
  try {
    const parsed = JSON.parse(button.dataset.activeUrlPatterns || "[]");
    activeUrlPatterns = Array.isArray(parsed)
      ? parsed.map((pattern) => String(pattern || "")).filter(Boolean)
      : [];
  } catch {
    activeUrlPatterns = [];
  }

  const isActive = isPaneNavigationItemActive({
    activeUrlPatterns,
    id: button.dataset.navigationItemId || "",
    label: button.textContent || "",
    url: button.dataset.targetUrl || "",
    webAppId: button.dataset.targetWebAppId || ""
  }, button.dataset.selectedWebAppId || "", currentUrl);
  button.classList.toggle("active", isActive);
  button.setAttribute("aria-current", isActive ? "page" : "false");
  return isActive;
}
