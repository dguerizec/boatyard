import { createToolIcon } from "./toolIcons.js";
import {
  SETTINGS_SAVE_REQUEST_EVENT,
  SETTINGS_STATE_CHANGED_EVENT,
  getSettingsFormController,
  serializeSettingsState,
  type SettingsFormController
} from "./settingsFormController.js";

export type SettingsSectionGroup = {
  id: string;
  label: string;
};

export type SettingsSection = {
  badge?: string;
  description: string;
  elements: HTMLElement[];
  group: string;
  icon: string;
  id: string;
  keywords?: string[];
  label: string;
};

type SettingsShellOptions = {
  ariaLabel?: string;
  className?: string;
  groups: SettingsSectionGroup[];
  initialSectionId?: string;
  onDiscard?: () => void;
  onSaveComplete?: () => void;
  onSectionChange?: (sectionId: string) => void;
  searchPlaceholder?: string;
  sections: SettingsSection[];
};

function normalizeSearchValue(value: unknown) {
  return String(value || "").trim().toLocaleLowerCase();
}

export function filterSettingsSectionIds(
  sections: SettingsSection[],
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

function createNavigationButton(section: SettingsSection) {
  const button = document.createElement("button");
  button.className = "settings-nav-button";
  button.type = "button";
  button.dataset.sectionId = section.id;
  button.append(createToolIcon(section.icon));

  const label = document.createElement("span");
  label.textContent = section.label;
  button.append(label);

  if (section.badge) {
    const badge = document.createElement("span");
    badge.className = "settings-nav-badge";
    badge.textContent = section.badge;
    button.append(badge);
  }

  return button;
}

export function createSettingsShell({
  ariaLabel = "Settings categories",
  className = "",
  groups,
  sections,
  initialSectionId,
  onDiscard,
  onSaveComplete,
  onSectionChange,
  searchPlaceholder = "Find a setting..."
}: SettingsShellOptions) {
  const sectionById = new Map(sections.map((section) => [section.id, section]));
  let activeSectionId = sectionById.has(String(initialSectionId || ""))
    ? String(initialSectionId)
    : sections[0]?.id || "";

  const shell = document.createElement("section");
  shell.className = ["settings-shell", className].filter(Boolean).join(" ");

  const index = document.createElement("aside");
  index.className = "settings-index";

  const searchLabel = document.createElement("label");
  searchLabel.className = "settings-search";

  const searchIcon = createToolIcon("search");
  const searchInput = document.createElement("input");
  searchInput.type = "search";
  searchInput.autocomplete = "off";
  searchInput.placeholder = searchPlaceholder;
  searchInput.setAttribute("aria-label", "Find a setting");

  const shortcut = document.createElement("span");
  shortcut.className = "settings-search-shortcut";
  shortcut.textContent = "Ctrl K";
  searchLabel.append(searchIcon, searchInput, shortcut);

  const navigation = document.createElement("nav");
  navigation.className = "settings-nav";
  navigation.setAttribute("aria-label", ariaLabel);

  const buttonsById = new Map<string, HTMLButtonElement>();
  for (const group of groups) {
    const groupSections = sections.filter((section) => section.group === group.id);
    if (!groupSections.length) {
      continue;
    }

    const groupLabel = document.createElement("p");
    groupLabel.className = "settings-nav-group";
    groupLabel.dataset.settingsGroup = group.id;
    groupLabel.textContent = group.label;
    navigation.append(groupLabel);

    for (const section of groupSections) {
      const button = createNavigationButton(section);
      buttonsById.set(section.id, button);
      navigation.append(button);
    }
  }

  const emptySearch = document.createElement("p");
  emptySearch.className = "settings-search-empty";
  emptySearch.textContent = "No settings category matches this search.";
  emptySearch.hidden = true;

  index.append(searchLabel, navigation, emptySearch);

  const stage = document.createElement("div");
  stage.className = "settings-stage";

  const header = document.createElement("header");
  header.className = "settings-stage-header";

  const heading = document.createElement("div");
  const title = document.createElement("h3");
  const description = document.createElement("p");
  heading.append(title, description);

  const savedState = document.createElement("span");
  savedState.className = "settings-saved-state";
  const savedDot = document.createElement("span");
  savedDot.className = "settings-saved-dot";
  const savedLabel = document.createElement("span");
  savedLabel.textContent = "All changes saved";
  savedState.append(savedDot, savedLabel);
  header.append(heading, savedState);

  const content = document.createElement("div");
  content.className = "settings-content";

  const pagesById = new Map<string, HTMLElement>();
  const controllerSections = new Map<SettingsFormController, string>();
  for (const section of sections) {
    const page = document.createElement("section");
    page.className = "settings-category-page";
    page.dataset.sectionId = section.id;
    page.hidden = true;
    page.append(...section.elements);
    for (const element of section.elements) {
      const controller = getSettingsFormController(element);
      if (controller) {
        controllerSections.set(controller, section.id);
      }
    }
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
    const matchingIds = new Set(filterSettingsSectionIds(sections, searchInput.value));

    for (const [sectionId, button] of buttonsById) {
      button.hidden = !matchingIds.has(sectionId);
    }

    for (const group of groups) {
      const groupLabel = navigation.querySelector<HTMLElement>(`[data-settings-group="${group.id}"]`);
      if (groupLabel) {
        groupLabel.hidden = !sections.some(
          (section) => section.group === group.id && matchingIds.has(section.id)
        );
      }
    }

    emptySearch.hidden = matchingIds.size > 0;
    if (searchInput.value.trim() && matchingIds.size === 1) {
      selectSection([...matchingIds][0]);
    }
  }

  searchInput.addEventListener("input", filterNavigation);

  const actionBar = document.createElement("footer");
  actionBar.className = "settings-action-bar";

  const changeState = document.createElement("div");
  changeState.className = "settings-change-state";
  const changeIcon = document.createElement("span");
  changeIcon.className = "settings-change-icon";
  changeIcon.append(createToolIcon("check"));
  const changeLabel = document.createElement("span");
  changeLabel.textContent = "All changes saved";
  changeState.append(changeIcon, changeLabel);

  const actionButtons = document.createElement("div");
  actionButtons.className = "settings-action-buttons";

  const discardButton = document.createElement("button");
  discardButton.className = "secondary-button";
  discardButton.type = "button";
  discardButton.textContent = "Discard";
  discardButton.disabled = true;

  const saveButton = document.createElement("button");
  saveButton.className = "primary-button";
  saveButton.type = "button";
  saveButton.textContent = "Save changes";
  saveButton.disabled = true;

  actionButtons.append(discardButton, saveButton);
  actionBar.append(changeState, actionButtons);

  const initialStates = new Map(
    [...controllerSections.keys()].map((controller) => [
      controller,
      serializeSettingsState(controller.getState())
    ])
  );
  let saving = false;
  let displayedDirtyState = false;

  function getDirtyControllers() {
    return [...controllerSections.keys()].filter((controller) => (
      serializeSettingsState(controller.getState()) !== initialStates.get(controller)
    ));
  }

  function refreshChangeState() {
    const dirtyCount = getDirtyControllers().length;
    const dirty = dirtyCount > 0;
    shell.classList.toggle("dirty", dirty);
    changeState.classList.toggle("dirty", dirty);
    if (dirty !== displayedDirtyState) {
      changeIcon.replaceChildren(createToolIcon(dirty ? "alert" : "check"));
      displayedDirtyState = dirty;
    }
    changeLabel.textContent = dirty
      ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "section" : "sections"}`
      : "All changes saved";
    savedDot.classList.toggle("dirty", dirty);
    savedLabel.textContent = dirty ? `${dirtyCount} pending` : "All changes saved";
    discardButton.disabled = saving || !dirty;
    saveButton.disabled = saving || !dirty;
  }

  async function saveChanges() {
    if (saving) {
      return;
    }

    const dirtyControllers = getDirtyControllers();
    if (!dirtyControllers.length) {
      return;
    }

    saving = true;
    saveButton.textContent = "Saving...";
    refreshChangeState();

    try {
      for (const controller of dirtyControllers) {
        try {
          await controller.save();
        } catch (error) {
          const sectionId = controllerSections.get(controller);
          if (sectionId) {
            selectSection(sectionId);
          }
          throw error;
        }
      }

      for (const controller of dirtyControllers) {
        initialStates.set(controller, serializeSettingsState(controller.getState()));
      }
      onSaveComplete?.();
    } catch (error) {
      console.error("Could not save settings:", error);
    } finally {
      saving = false;
      saveButton.textContent = "Save changes";
      refreshChangeState();
    }
  }

  shell.addEventListener("input", refreshChangeState);
  shell.addEventListener("change", refreshChangeState);
  shell.addEventListener(SETTINGS_STATE_CHANGED_EVENT, refreshChangeState);
  shell.addEventListener(SETTINGS_SAVE_REQUEST_EVENT, () => {
    void saveChanges();
  });
  const observer = new MutationObserver(refreshChangeState);
  observer.observe(content, { childList: true, subtree: true });

  discardButton.addEventListener("click", () => {
    if (!saving && getDirtyControllers().length) {
      onDiscard?.();
    }
  });
  saveButton.addEventListener("click", () => {
    void saveChanges();
  });

  stage.append(header, content, actionBar);
  shell.append(index, stage);
  selectSection(activeSectionId);
  refreshChangeState();

  return Object.freeze({
    element: shell,
    getActiveSectionId: () => activeSectionId,
    selectSection
  });
}
