import { createToolIcon } from "./toolIcons.js";

export type GlobalSettingsSectionGroup = "boatyard" | "extensions" | "system";

export type GlobalSettingsSection = {
  badge?: string;
  description: string;
  elements: HTMLElement[];
  group: GlobalSettingsSectionGroup;
  icon: string;
  id: string;
  keywords?: string[];
  label: string;
};

type GlobalSettingsShellOptions = {
  initialSectionId?: string;
  onSectionChange?: (sectionId: string) => void;
  sections: GlobalSettingsSection[];
};

const GROUP_LABELS: Record<GlobalSettingsSectionGroup, string> = {
  boatyard: "Boatyard",
  extensions: "Extensions",
  system: "System"
};

function normalizeSearchValue(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function filterGlobalSettingsSectionIds(
  sections: GlobalSettingsSection[],
  query: unknown
) {
  const normalizedQuery = normalizeSearchValue(query);
  if (!normalizedQuery) {
    return sections.map((section) => section.id);
  }

  return sections
    .filter((section) => (
      [section.label, section.description, ...(section.keywords || [])]
        .some((value) => normalizeSearchValue(value).includes(normalizedQuery))
    ))
    .map((section) => section.id);
}

function createNavigationButton(section: GlobalSettingsSection) {
  const button = document.createElement("button");
  button.className = "global-settings-nav-button";
  button.type = "button";
  button.dataset.sectionId = section.id;
  button.append(createToolIcon(section.icon));

  const label = document.createElement("span");
  label.textContent = section.label;
  button.append(label);

  if (section.badge) {
    const badge = document.createElement("span");
    badge.className = "global-settings-nav-badge";
    badge.textContent = section.badge;
    button.append(badge);
  }

  return button;
}

export function createGlobalSettingsShell({
  sections,
  initialSectionId,
  onSectionChange
}: GlobalSettingsShellOptions) {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  let activeSectionId = sectionById.has(String(initialSectionId || ""))
    ? String(initialSectionId)
    : sections[0]?.id || "";

  const shell = document.createElement("section");
  shell.className = "global-settings-shell";

  const index = document.createElement("aside");
  index.className = "global-settings-index";

  const searchLabel = document.createElement("label");
  searchLabel.className = "global-settings-search";

  const searchIcon = createToolIcon("search");
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.placeholder = "Find a setting...";
  searchInput.setAttribute("aria-label", "Find a setting");

  const shortcut = document.createElement("span");
  shortcut.className = "global-settings-search-shortcut";
  shortcut.textContent = "Ctrl K";
  searchLabel.append(searchIcon, searchInput, shortcut);

  const navigation = document.createElement("nav");
  navigation.className = "global-settings-nav";
  navigation.setAttribute("aria-label", "Global settings categories");

  const buttonsById = new Map<string, HTMLButtonElement>();
  for (const group of Object.keys(GROUP_LABELS) as GlobalSettingsSectionGroup[]) {
    const groupSections = sections.filter((section) => section.group === group);
    if (!groupSections.length) {
      continue;
    }

    const groupLabel = document.createElement("p");
    groupLabel.className = "global-settings-nav-group";
    groupLabel.dataset.settingsGroup = group;
    groupLabel.textContent = GROUP_LABELS[group];
    navigation.append(groupLabel);

    for (const section of groupSections) {
      const button = createNavigationButton(section);
      buttonsById.set(section.id, button);
      navigation.append(button);
    }
  }

  const emptySearch = document.createElement("p");
  emptySearch.className = "global-settings-search-empty";
  emptySearch.textContent = "No settings category matches this search.";
  emptySearch.hidden = true;

  index.append(searchLabel, navigation, emptySearch);

  const stage = document.createElement("div");
  stage.className = "global-settings-stage";

  const header = document.createElement("header");
  header.className = "global-settings-stage-header";

  const heading = document.createElement("div");
  const title = document.createElement("h3");
  const description = document.createElement("p");
  heading.append(title, description);

  const savedState = document.createElement("span");
  savedState.className = "global-settings-saved-state";
  const savedDot = document.createElement("span");
  savedDot.className = "global-settings-saved-dot";
  savedState.append(savedDot, "Stored locally");
  header.append(heading, savedState);

  const content = document.createElement("div");
  content.className = "global-settings-content";

  const pagesById = new Map<string, HTMLElement>();
  for (const section of sections) {
    const page = document.createElement("section");
    page.className = "global-settings-category-page";
    page.dataset.sectionId = section.id;
    page.hidden = true;
    page.append(...section.elements);
    pagesById.set(section.id, page);
    content.append(page);
  }

  function selectSection(sectionId: string) {
    const section = sectionById.get(sectionId);
    if (!section) {
      return;
    }

    activeSectionId = section.id;
    title.textContent = section.label;
    description.textContent = section.description;

    for (const [id, button] of buttonsById) {
      const active = id === activeSectionId;
      button.classList.toggle("active", active);
      button.setAttribute("aria-current", active ? "page" : "false");
    }

    for (const [id, page] of pagesById) {
      page.hidden = id !== activeSectionId;
    }

    content.scrollTop = 0;
    onSectionChange?.(activeSectionId);
  }

  for (const [sectionId, button] of buttonsById) {
    button.addEventListener("click", () => selectSection(sectionId));
  }

  function filterNavigation() {
    const matchingIds = new Set(filterGlobalSettingsSectionIds(sections, searchInput.value));

    for (const [sectionId, button] of buttonsById) {
      button.hidden = !matchingIds.has(sectionId);
    }

    for (const group of Object.keys(GROUP_LABELS) as GlobalSettingsSectionGroup[]) {
      const groupLabel = navigation.querySelector<HTMLElement>(`[data-settings-group="${group}"]`);
      if (groupLabel) {
        groupLabel.hidden = !sections.some(
          (section) => section.group === group && matchingIds.has(section.id)
        );
      }
    }

    emptySearch.hidden = matchingIds.size > 0;
    if (searchInput.value.trim() && matchingIds.size === 1) {
      selectSection([...matchingIds][0]);
    }
  }

  searchInput.addEventListener("input", filterNavigation);
  shell.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
    }
  });

  stage.append(header, content);
  shell.append(index, stage);
  selectSection(activeSectionId);

  return Object.freeze({
    element: shell,
    getActiveSectionId: () => activeSectionId,
    selectSection
  });
}
