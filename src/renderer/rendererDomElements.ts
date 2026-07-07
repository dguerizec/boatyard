function requireElement<T extends HTMLElement>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing required element: ${selector}`);
  }

  return element;
}

export const rendererDomElements = Object.freeze({
  addProjectButton: requireElement<HTMLButtonElement>("#add-project"),
  appShell: requireElement<HTMLElement>(".app-shell"),
  dashboardGrid: requireElement<HTMLElement>("#dashboard-grid"),
  globalNav: requireElement<HTMLElement>("#global-nav"),
  globalNavRow: requireElement<HTMLElement>("#global-nav-row"),
  globalSettingsButton: requireElement<HTMLButtonElement>("#global-settings"),
  globalViewButton: requireElement<HTMLButtonElement>("#global-view"),
  manualTourButton: requireElement<HTMLButtonElement>("#manual-tour"),
  pinnedProjects: requireElement<HTMLElement>("#pinned-projects"),
  projectCount: requireElement<HTMLElement>("#project-count"),
  projectList: requireElement<HTMLElement>("#project-list"),
  projectSearchInput: requireElement<HTMLInputElement>("#project-search"),
  sidebarRail: requireElement<HTMLButtonElement>("#sidebar-rail"),
  sidebarToggleButton: requireElement<HTMLButtonElement>("#sidebar-toggle"),
  sidebarUpdateNotice: requireElement<HTMLElement>("#sidebar-update-notice"),
  workspace: requireElement<HTMLElement>(".workspace"),
  workspaceKicker: requireElement<HTMLElement>("#workspace-kicker"),
  workspaceSummary: requireElement<HTMLElement>("#workspace-summary"),
  workspaceTitle: requireElement<HTMLElement>("#workspace-title")
});
