import type { WebAppDefinition } from "./rendererTypes.js";

export type PaneTypeCatalogChild<TWebApp extends WebAppDefinition = WebAppDefinition> = {
  label: string;
  webApp: TWebApp;
};

export type PaneTypeCatalogGroup<TWebApp extends WebAppDefinition = WebAppDefinition> = {
  children: PaneTypeCatalogChild<TWebApp>[];
  label: string;
  webApp: TWebApp;
};

export function getPaneMenuWebApps<TWebApp extends WebAppDefinition>(webApps: TWebApp[]): TWebApp[] {
  return webApps.filter((webApp) => webApp.showInMenu !== false);
}

function getMenuLabel(webApp: WebAppDefinition): string {
  return String(webApp.label || webApp.id || "");
}

function parseGroupedWebAppLabel(webApp: WebAppDefinition) {
  const match = getMenuLabel(webApp).match(/^([^:]{2,40}):\s*(.+)$/);
  if (!match) {
    return null;
  }

  return {
    group: match[1].trim(),
    label: match[2].trim()
  };
}

function getChildLabel(parentLabel: string, child: WebAppDefinition): string {
  const label = getMenuLabel(child);
  const parsed = parseGroupedWebAppLabel(child);
  return parsed?.group === parentLabel ? parsed.label : label;
}

export function buildPaneTypeCatalog<TWebApp extends WebAppDefinition>(
  webApps: TWebApp[]
): PaneTypeCatalogGroup<TWebApp>[] {
  const menuWebApps = getPaneMenuWebApps(webApps);
  const rootWebApps = menuWebApps.filter((webApp) => !webApp.parentWebAppId);
  const rootByLabel = new Map(rootWebApps.map((webApp) => [getMenuLabel(webApp), webApp]));
  const childrenByParentId = new Map<string, PaneTypeCatalogChild<TWebApp>[]>();
  const groupedRootWebApps = new WeakSet<TWebApp>();
  const prefixChildrenByParentId = new Map<string, PaneTypeCatalogChild<TWebApp>[]>();
  const virtualPrefixChildren = new Map<string, PaneTypeCatalogChild<TWebApp>[]>();
  const virtualPrefixByWebApp = new WeakMap<TWebApp, string>();

  for (const webApp of menuWebApps.filter((candidate) => candidate.parentWebAppId)) {
    const parentWebAppId = webApp.parentWebAppId;
    if (!parentWebAppId) {
      continue;
    }

    const children = childrenByParentId.get(parentWebAppId) || [];
    children.push({
      label: getMenuLabel(webApp),
      webApp
    });
    childrenByParentId.set(parentWebAppId, children);
  }

  for (const webApp of rootWebApps) {
    const parsed = parseGroupedWebAppLabel(webApp);
    if (!parsed) {
      continue;
    }

    const parentWebApp = rootByLabel.get(parsed.group);
    if (parentWebApp && parentWebApp !== webApp && parentWebApp.id) {
      const children = prefixChildrenByParentId.get(parentWebApp.id) || [];
      children.push({
        label: parsed.label,
        webApp
      });
      prefixChildrenByParentId.set(parentWebApp.id, children);
      groupedRootWebApps.add(webApp);
      continue;
    }

    if (parsed.group === "URL") {
      const children = virtualPrefixChildren.get(parsed.group) || [];
      children.push({
        label: parsed.label,
        webApp
      });
      virtualPrefixChildren.set(parsed.group, children);
      virtualPrefixByWebApp.set(webApp, parsed.group);
      groupedRootWebApps.add(webApp);
    }
  }

  const groups: PaneTypeCatalogGroup<TWebApp>[] = [];
  const emittedVirtualPrefixes = new Set<string>();

  for (const webApp of rootWebApps) {
    if (groupedRootWebApps.has(webApp)) {
      const virtualPrefix = virtualPrefixByWebApp.get(webApp);
      if (virtualPrefix && !emittedVirtualPrefixes.has(virtualPrefix)) {
        groups.push({
          label: virtualPrefix,
          webApp: {
            icon: virtualPrefix === "URL" ? "link" : undefined,
            id: `menu:${virtualPrefix.toLowerCase()}`,
            label: virtualPrefix,
            menuOnly: true
          } as unknown as TWebApp,
          children: virtualPrefixChildren.get(virtualPrefix) || []
        });
        emittedVirtualPrefixes.add(virtualPrefix);
      }
      continue;
    }

    const label = getMenuLabel(webApp);
    const webAppId = webApp.id || "";
    groups.push({
      label,
      webApp,
      children: [
        ...(webAppId ? childrenByParentId.get(webAppId) || [] : []).map((child) => ({
          ...child,
          label: getChildLabel(label, child.webApp)
        })),
        ...(webAppId ? prefixChildrenByParentId.get(webAppId) || [] : [])
      ]
    });
  }

  const rootIds = new Set(rootWebApps.map((webApp) => webApp.id).filter(Boolean));
  for (const [parentId, children] of childrenByParentId) {
    if (rootIds.has(parentId)) {
      continue;
    }

    groups.push(...children.map((child) => ({
      label: child.label,
      webApp: child.webApp,
      children: []
    })));
  }

  return groups;
}
