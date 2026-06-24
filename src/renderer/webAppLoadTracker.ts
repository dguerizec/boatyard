type WebAppLoadPayload = {
  key?: string;
  url?: string;
};

function normalizeComparableUrl(url: unknown) {
  try {
    return new URL(String(url || "")).toString();
  } catch {
    return String(url || "");
  }
}

function matchesWebAppLoad(payload: WebAppLoadPayload | null | undefined, key: string, expectedUrl = "") {
  if (!payload || payload.key !== key) {
    return false;
  }

  if (!expectedUrl) {
    return true;
  }

  return normalizeComparableUrl(payload.url) === normalizeComparableUrl(expectedUrl);
}

export function createWebAppLoadTracker() {
  const loadedWebAppKeys = new Set<string>();
  const loadedWebAppUrlsByKey = new Map<string, string>();
  const webAppLoadWaiters = new Set<(payload: WebAppLoadPayload) => void>();

  function markLoaded(payload: WebAppLoadPayload) {
    const { key, url } = payload;
    if (!key || !url) {
      return;
    }

    loadedWebAppKeys.add(key);
    loadedWebAppUrlsByKey.set(key, url);
    for (const waiter of [...webAppLoadWaiters]) {
      waiter(payload);
    }
  }

  function markLoadedKey(key: string) {
    if (key) {
      loadedWebAppKeys.add(key);
    }
  }

  function hasLoadedKey(key: string) {
    return loadedWebAppKeys.has(key);
  }

  function hasLoadedWebApp(key: string, expectedUrl = "") {
    const loadedUrl = loadedWebAppUrlsByKey.get(key);
    if (!loadedUrl) {
      return false;
    }

    return matchesWebAppLoad({ key, url: loadedUrl }, key, expectedUrl);
  }

  function waitForLoad(key: string, expectedUrl = "", timeoutMs = 6000) {
    if (!key || hasLoadedWebApp(key, expectedUrl)) {
      return Promise.resolve(true);
    }

    return new Promise<boolean>((resolve) => {
      let timeout: ReturnType<typeof setTimeout> | null = null;
      let waiter: ((payload: WebAppLoadPayload) => void) | null = null;
      const cleanup = (loaded: boolean) => {
        if (timeout) {
          clearTimeout(timeout);
        }
        if (waiter) {
          webAppLoadWaiters.delete(waiter);
        }
        resolve(loaded);
      };
      waiter = (payload) => {
        if (matchesWebAppLoad(payload, key, expectedUrl)) {
          cleanup(true);
        }
      };

      webAppLoadWaiters.add(waiter);
      timeout = setTimeout(() => cleanup(false), timeoutMs);
    });
  }

  return Object.freeze({
    hasLoadedKey,
    markLoaded,
    markLoadedKey,
    waitForLoad
  });
}
