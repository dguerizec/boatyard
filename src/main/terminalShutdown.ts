type BeforeQuitEvent = {
  preventDefault(): void;
};

type TerminalShutdownService = {
  detachAll(): Promise<unknown> | unknown;
};

type TerminalShutdownCoordinatorOptions = {
  getServices: () => Iterable<TerminalShutdownService>;
  onError?: (error: unknown) => void;
  quit: () => void;
};

function createTerminalShutdownCoordinator({
  getServices,
  onError = () => {},
  quit
}: TerminalShutdownCoordinatorOptions) {
  let cleanupComplete = false;
  let cleanupPromise: Promise<void> | null = null;

  function beginCleanup(): Promise<void> {
    if (!cleanupPromise) {
      cleanupPromise = Promise.allSettled(
        [...new Set(getServices())].map((service) => Promise.resolve().then(() => service.detachAll()))
      ).then((results) => {
        for (const result of results) {
          if (result.status === "rejected") {
            onError(result.reason);
          }
        }
      }).finally(() => {
        cleanupComplete = true;
        quit();
      });
    }
    return cleanupPromise;
  }

  function handleBeforeQuit(event: BeforeQuitEvent): void {
    if (cleanupComplete) {
      return;
    }
    event.preventDefault();
    void beginCleanup();
  }

  return Object.freeze({
    beginCleanup,
    handleBeforeQuit,
    isCleanupComplete: () => cleanupComplete
  });
}

export { createTerminalShutdownCoordinator };
export type { BeforeQuitEvent, TerminalShutdownService };
