export type PaneCleanupHost = HTMLElement & { boatyardCleanup?: () => void };

export function cleanupPaneLayout(root: Element) {
  const hosts = [...root.querySelectorAll<PaneCleanupHost>(".webapp-host")];
  if (root.matches(".webapp-host")) {
    hosts.unshift(root as PaneCleanupHost);
  }
  for (const host of hosts) {
    const cleanup = host.boatyardCleanup;
    delete host.boatyardCleanup;
    try {
      cleanup?.();
    } catch (error) {
      console.error("Could not clean up pane:", error);
    }
  }
}

export function clearPaneContainer(container: HTMLElement) {
  cleanupPaneLayout(container);
  container.replaceChildren();
}
