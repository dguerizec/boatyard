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

export type SettingsSaveMode = "manual" | "blur";

type SettingsShellOptions = {
  ariaLabel?: string;
  className?: string;
  groups: SettingsSectionGroup[];
  initialSectionId?: string;
  onDiscard?: () => void;
  onSaveComplete?: () => void;
  onSectionChange?: (sectionId: string) => void;
  saveMode?: SettingsSaveMode;
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
  saveMode = "manual",
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
  const controllerElements = new Map<SettingsFormController, HTMLElement[]>();
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
        controllerElements.set(controller, [
          ...(controllerElements.get(controller) || []),
          element
        ]);
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
  actionBar.classList.toggle("auto-save", saveMode === "blur");

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
  actionBar.append(changeState);
  if (saveMode === "manual") {
    actionBar.append(actionButtons);
  }

  const initialStates = new Map(
    [...controllerSections.keys()].map((controller) => [
      controller,
      serializeSettingsState(controller.getState())
    ])
  );
  let saving = false;
  let displayedDirtyState = false;
  let autoSaveTimer: number | null = null;
  const pendingAutoSaveControllers = new Set<SettingsFormController>();

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
    changeLabel.textContent = saving
      ? "Saving changes..."
      : dirty
        ? `${dirtyCount} unsaved ${dirtyCount === 1 ? "section" : "sections"}`
        : saveMode === "blur" ? "Changes save automatically" : "All changes saved";
    savedDot.classList.toggle("dirty", dirty);
    savedLabel.textContent = saving
      ? "Saving..."
      : dirty ? `${dirtyCount} pending` : "All changes saved";
    discardButton.disabled = saving || !dirty;
    saveButton.disabled = saving || !dirty;
  }

  async function saveChanges(requestedControllers?: SettingsFormController[]) {
    if (saving) {
      return;
    }

    const dirtyControllerSet = new Set(getDirtyControllers());
    const dirtyControllers = (requestedControllers || [...dirtyControllerSet])
      .filter((controller) => dirtyControllerSet.has(controller));
    if (!dirtyControllers.length) {
      return;
    }

    saving = true;
    saveButton.textContent = "Saving...";
    refreshChangeState();

    try {
      for (const controller of dirtyControllers) {
        const savedState = serializeSettingsState(controller.getState());
        try {
          await controller.save();
          initialStates.set(controller, savedState);
        } catch (error) {
          const sectionId = controllerSections.get(controller);
          if (sectionId) {
            selectSection(sectionId);
          }
          throw error;
        }
      }

      onSaveComplete?.();
    } catch (error) {
      console.error("Could not save settings:", error);
    } finally {
      saving = false;
      saveButton.textContent = "Save changes";
      refreshChangeState();
      if (pendingAutoSaveControllers.size && autoSaveTimer === null) {
        scheduleAutoSave([]);
      }
    }
  }

  function scheduleAutoSave(controllers: SettingsFormController[]) {
    for (const controller of controllers) {
      pendingAutoSaveControllers.add(controller);
    }
    if (saveMode !== "blur" || autoSaveTimer !== null) {
      return;
    }

    autoSaveTimer = window.setTimeout(() => {
      autoSaveTimer = null;
      if (saving) {
        return;
      }

      const controllersToSave = [...pendingAutoSaveControllers];
      pendingAutoSaveControllers.clear();
      void saveChanges(controllersToSave);
    }, 0);
  }

  function getControllersForTarget(target: EventTarget | null) {
    if (!(target instanceof Node)) {
      return [];
    }

    return [...controllerElements]
      .filter(([, elements]) => elements.some((element) => element.contains(target)))
      .map(([controller]) => controller);
  }

  function refreshFromStateChange(event?: Event) {
    refreshChangeState();
    if (saveMode === "blur" && !shell.matches(":focus-within")) {
      const targetControllers = getControllersForTarget(event?.target || null);
      scheduleAutoSave(targetControllers.length ? targetControllers : getDirtyControllers());
    }
  }

  shell.addEventListener("input", refreshChangeState);
  shell.addEventListener("change", refreshChangeState);
  shell.addEventListener(SETTINGS_STATE_CHANGED_EVENT, refreshFromStateChange);
  shell.addEventListener("focusout", (event) => {
    if (saveMode === "blur") {
      scheduleAutoSave(getControllersForTarget(event.target));
    }
  });
  shell.addEventListener(SETTINGS_SAVE_REQUEST_EVENT, () => {
    void saveChanges();
  });
  const observer = new MutationObserver(() => refreshFromStateChange());
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
