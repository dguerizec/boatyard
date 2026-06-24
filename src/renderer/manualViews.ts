type ManualEntry = {
  body: string;
  title: string;
};

type ManualSection = {
  entries?: ManualEntry[];
  id: string;
  summary?: string;
  title: string;
};

type ManualContent = {
  description?: string;
  sections?: ManualSection[];
  title?: string;
};

type ManualSurfaceOptions = {
  includeIntroAction?: boolean;
};

type ManualViewsOptions = {
  closeWidgetAddMenu: () => void;
  dashboardGrid: HTMLElement;
  getManual: () => ManualContent;
  hideWebApps: () => void;
  openOnboardingTour: (options?: { force?: boolean }) => unknown;
  resetVisibleWebAppHosts: () => void;
  workspace: HTMLElement;
  workspaceKicker: HTMLElement;
  workspaceSummary: HTMLElement;
  workspaceTitle: HTMLElement;
};

function createManualSection(section: ManualSection) {
  const card = document.createElement("article");
  card.className = "manual-section";
  card.id = `manual-${section.id}`;

  const heading = document.createElement("div");
  heading.className = "manual-section-heading";

  const title = document.createElement("h3");
  title.textContent = section.title;

  const summary = document.createElement("p");
  summary.textContent = section.summary || "";
  heading.append(title, summary);

  const entries = document.createElement("div");
  entries.className = "manual-entry-list";

  for (const entry of section.entries || []) {
    const item = document.createElement("section");
    item.className = "manual-entry";

    const itemTitle = document.createElement("h4");
    itemTitle.textContent = entry.title;

    const itemBody = document.createElement("p");
    itemBody.textContent = entry.body;
    item.append(itemTitle, itemBody);
    entries.append(item);
  }

  card.append(heading, entries);
  return card;
}

export function createManualViews({
  closeWidgetAddMenu,
  dashboardGrid,
  getManual,
  hideWebApps,
  openOnboardingTour,
  resetVisibleWebAppHosts,
  workspace,
  workspaceKicker,
  workspaceSummary,
  workspaceTitle
}: ManualViewsOptions) {
  function createManualSurface({ includeIntroAction = true }: ManualSurfaceOptions = {}) {
    const manual = getManual();
    const content = document.createElement("div");
    content.className = "manual-content";

    const intro = document.createElement("section");
    intro.className = "manual-intro";

    const introTitle = document.createElement("h3");
    introTitle.textContent = "Working with Boatyard";

    const introBody = document.createElement("p");
    introBody.textContent = "Use this manual as an operational reference while configuring projects, arranging panes, and enabling plugins.";

    intro.append(introTitle, introBody);

    if (includeIntroAction) {
      const introActions = document.createElement("div");
      introActions.className = "manual-actions";

      const tourButton = document.createElement("button");
      tourButton.className = "primary-button";
      tourButton.type = "button";
      tourButton.textContent = "Start guided tour";
      tourButton.addEventListener("click", () => openOnboardingTour({ force: true }));
      introActions.append(tourButton);
      intro.append(introActions);
    }

    content.append(intro);

    for (const section of manual.sections || []) {
      content.append(createManualSection(section));
    }

    return content;
  }

  function renderManualPage() {
    const manual = getManual();
    closeWidgetAddMenu();
    resetVisibleWebAppHosts();
    hideWebApps();
    workspace.classList.remove("project-mode");
    workspaceKicker.textContent = "Help";
    workspaceTitle.textContent = manual.title || "";
    workspaceSummary.textContent = manual.description || "";
    dashboardGrid.innerHTML = "";
    dashboardGrid.className = "manual-page";
    dashboardGrid.style.gridTemplateColumns = "";

    const nav = document.createElement("nav");
    nav.className = "manual-nav";
    nav.setAttribute("aria-label", "Manual sections");

    const navTitle = document.createElement("h3");
    navTitle.textContent = "Contents";
    nav.append(navTitle);

    for (const section of manual.sections || []) {
      const link = document.createElement("a");
      link.href = `#manual-${section.id}`;
      link.textContent = section.title;
      nav.append(link);
    }

    const note = document.createElement("p");
    note.className = "manual-hosting-note";
    note.textContent = "Public documentation hosting will use the future Boatyard documentation domain.";
    nav.append(note);

    dashboardGrid.append(nav, createManualSurface());
  }

  return Object.freeze({
    createManualSurface,
    renderManualPage
  });
}
