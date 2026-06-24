import type { SplitNode } from "./paneLayoutState.js";
import type {
  RendererPaneLayoutNode,
  RendererPaneNode,
  RendererProject,
  WebAppDefinition
} from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type { WidgetPane } from "./widgetSurfaceTypes.js";

type WebAppMenuElement = HTMLDivElement & {
  cleanup?: () => void;
};

  type WebAppBounds = {
    x: number;
    y: number;
    width: number;
    height: number;
  };

  type MenuPaneNode = RendererPaneNode;

  type MenuSplitNode = SplitNode;

  type MenuWebApp = WebAppDefinition & {
    homeTab?: boolean;
    homeTabId?: string;
    id?: string;
    key?: string;
    kind?: string;
    label?: unknown;
    parentLabel?: unknown;
    parentWebAppId?: string;
    url?: string;
    widgetPane?: WidgetPane;
  };

  type VisibleWebAppEntry = {
    host: Element | null;
    paneId: string;
    webApp: MenuWebApp;
  };

  type WebAppOpenPayload = {
    url?: string;
    sourceBounds?: unknown;
    sourceUrl?: string;
    sourceWebAppKey?: string;
  };

  type WidgetPaneTabsOptions = {
    editing?: boolean;
  };

  type WebAppOpenFormControls = HTMLFormControlsCollection & {
    webAppOpenTarget: HTMLInputElement;
  };

  type WebAppOpenRule = {
    label?: string;
    pattern?: string;
    scope?: string;
    target?: string;
  };

  type WebAppOpenChoice = WebAppOpenRule & {
    persist?: boolean;
  };

  type OrderedWebAppMenuItem = {
    depth: number;
    webApp: MenuWebApp;
  };

  type WebAppMenusOptions = {
    webAppOpenSplitRatio: number;
    getCurrentWebAppUrl: (webApp: MenuWebApp) => string | undefined;
    getSettings: () => UnknownRecord & { webAppOpenRules?: WebAppOpenRule[] };
    getProjectById: (projectId?: string) => RendererProject | null;
    getProjectWidgetPanes: (project: RendererProject) => UnknownRecord[];
    getVisibleWebAppEntryByKey: (key?: string) => VisibleWebAppEntry | null;
    getVisibleWebAppEntryByUrl: (url?: string) => VisibleWebAppEntry | null;
    getVisibleWebAppProject: () => RendererProject | null;
    getProjectPaneLayout: (project: RendererProject) => RendererPaneLayoutNode;
    getWebAppHostBounds: (host?: Element | null) => WebAppBounds | null;
    findPaneNode: (layout: RendererPaneLayoutNode | null | undefined, paneId?: string) => RendererPaneNode | null;
    createSplitNode: (
      project: RendererProject,
      direction: string,
      first: RendererPaneLayoutNode,
      selectedWebAppId?: string | null
    ) => MenuSplitNode;
    replacePaneNode: (layout: RendererPaneLayoutNode, paneId: string, replacement: RendererPaneLayoutNode) => RendererPaneLayoutNode;
    setPaneLayout: (projectId: string | undefined, layout: RendererPaneLayoutNode) => unknown;
    setSelectedWebAppForPane: (paneId: string, webAppId?: string) => unknown;
    setSelectedWebAppForProject: (projectId: string | undefined, webAppId?: string) => unknown;
    setCurrentWebAppUrl: (key: string, url: string) => void;
    persistPaneLayout: (project: RendererProject) => void;
    renderWorkspaceDashboard: (project: RendererProject) => void;
    updateWebAppHomeTab: (projectId: string, tab: UnknownRecord) => Promise<unknown>;
    updateSettings: (values: UnknownRecord) => Promise<unknown>;
    updateProject: (projectId: string, values: UnknownRecord) => Promise<unknown>;
    invokeWebApp: (action: string, ...payload: unknown[]) => Promise<unknown>;
    openExternal: (url: string) => unknown | Promise<unknown>;
    showOverlayDialog: (dialog: HTMLDialogElement, options?: UnknownRecord) => Promise<boolean>;
    normalizePayloadBounds: (bounds: unknown) => WebAppBounds | null;
    freezeWebAppsForOverlay: (options?: unknown) => Promise<unknown>;
    restoreWebAppsAfterOverlay: () => void | Promise<unknown>;
    closeTerminalTabMenu: () => void;
    clamp: (value: number, min: number, max: number) => number;
    isGlobalWorkspace: (project: RendererProject) => boolean;
    isWebAppLoaded: (key?: string) => boolean;
  };

  function asErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

export function createWebAppMenus({
    webAppOpenSplitRatio,
    getCurrentWebAppUrl,
    getSettings,
    getProjectById,
    getProjectWidgetPanes,
    getVisibleWebAppEntryByKey,
    getVisibleWebAppEntryByUrl,
    getVisibleWebAppProject,
    getProjectPaneLayout,
    getWebAppHostBounds,
    findPaneNode,
    createSplitNode,
    replacePaneNode,
    setPaneLayout,
    setSelectedWebAppForPane,
    setSelectedWebAppForProject,
    setCurrentWebAppUrl,
    persistPaneLayout,
    renderWorkspaceDashboard,
    updateWebAppHomeTab,
    updateSettings,
    updateProject,
    invokeWebApp,
    openExternal,
    showOverlayDialog,
    normalizePayloadBounds,
    freezeWebAppsForOverlay,
    restoreWebAppsAfterOverlay,
    closeTerminalTabMenu,
    clamp,
    isGlobalWorkspace,
    isWebAppLoaded
  }: WebAppMenusOptions) {
    let openWebAppTabMenu: WebAppMenuElement | null = null;

    function getWebAppOpenUrlLabel(url: unknown) {
      try {
      const parsedUrl = new URL(String(url || ""));
        return parsedUrl.hostname || "Link";
      } catch {
        return "Link";
      }
    }

    function createTransientWebApp(url: string, label = "", parentWebApp: MenuWebApp | null = null): MenuWebApp {
      return {
        id: `transient:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
        label: label || getWebAppOpenUrlLabel(url),
        parentLabel: String(parentWebApp?.label || ""),
        parentWebAppId: parentWebApp?.id || "",
        url
      };
    }

    function createWebAppHomeTabId() {
      return `home:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`;
    }

    function getParentWebAppForDerivedTab(webApp: MenuWebApp) {
      if ((webApp?.transient || webApp?.homeTab) && webApp.parentWebAppId) {
        return {
          id: webApp.parentWebAppId,
          label: webApp.parentLabel || ""
        };
      }

      return webApp;
    }

    async function saveCurrentUrlAsWebAppHomeTab(
      project: RendererProject,
      paneNode: MenuPaneNode,
      selectedWebApp: MenuWebApp
    ) {
      const currentUrl = getCurrentWebAppUrl(selectedWebApp);
      if (!currentUrl) {
        return false;
      }

      const parentWebApp = getParentWebAppForDerivedTab(selectedWebApp);
      if (!parentWebApp?.id) {
        return false;
      }

      const nextTab = {
        id: selectedWebApp.homeTabId || createWebAppHomeTabId(),
        parentWebAppId: parentWebApp.id,
        parentLabel: parentWebApp.label || "",
        label: getWebAppOpenUrlLabel(currentUrl),
        url: currentUrl
      };

      await updateWebAppHomeTab(project.id || "", nextTab);
      paneNode.selectedWebAppId = nextTab.id;
      setSelectedWebAppForPane(paneNode.id, nextTab.id);
      setSelectedWebAppForProject(project.id, nextTab.id);
      setCurrentWebAppUrl(`${paneNode.id}:home:${nextTab.id}`, currentUrl);

      const updatedProject = getProjectById(project.id) || project;
      persistPaneLayout(updatedProject);
      renderWorkspaceDashboard(updatedProject);
      return true;
    }

    function openUrlInSplitPaneFromEntry(sourceEntry: VisibleWebAppEntry | null, url: string, label = "") {
      const project = sourceEntry ? getVisibleWebAppProject() : null;
      if (!sourceEntry || !project) {
        return false;
      }

      const existingEntry = getVisibleWebAppEntryByUrl(url);
      if (existingEntry) {
        return true;
      }

      const layout = getProjectPaneLayout(project);
      const sourcePaneNode = findPaneNode(layout, sourceEntry.paneId) as MenuPaneNode | null;
      if (!sourcePaneNode) {
        return false;
      }

      const sourceWebAppId = sourceEntry.webApp.id;
      const sourceBounds = getWebAppHostBounds(sourceEntry.host);
      const splitDirection = sourceBounds && sourceBounds.height > 0 && sourceBounds.width / sourceBounds.height <= 1
        ? "horizontal"
        : "vertical";
      const replacement = createSplitNode(
        project,
        splitDirection,
        { ...sourcePaneNode, selectedWebAppId: sourceWebAppId },
        null
      );
      replacement.ratio = webAppOpenSplitRatio;
      const transientWebApp = createTransientWebApp(url, label, sourceEntry.webApp);
      const replacementPane = findPaneNode(replacement.second, replacement.second.id);
      if (!replacementPane) {
        return false;
      }

      replacementPane.transientWebApp = transientWebApp;
      replacementPane.selectedWebAppId = transientWebApp.id;

      setPaneLayout(project.id, replacePaneNode(layout, sourceEntry.paneId, replacement));
      setSelectedWebAppForPane(sourceEntry.paneId, sourceWebAppId);
      setSelectedWebAppForPane(replacementPane.id, replacementPane.selectedWebAppId);

      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
      return true;
    }

    function getWebAppOpenRulePattern(url: string, scope?: string) {
      const parsedUrl = new URL(String(url || ""));
      if (scope === "host") {
        return parsedUrl.host;
      }

      if (scope === "path-prefix") {
        return `${parsedUrl.origin}${parsedUrl.pathname}`;
      }

      return parsedUrl.toString();
    }

    function upsertWebAppOpenRule(rules: WebAppOpenRule[], nextRule: WebAppOpenRule) {
      return [
        ...rules.filter((rule: WebAppOpenRule) => !(rule.scope === nextRule.scope && rule.pattern === nextRule.pattern)),
        nextRule
      ];
    }

    async function applyWebAppOpenChoice(payload: WebAppOpenPayload, choice: WebAppOpenChoice) {
      const url = normalizeAddressInput(payload.url);

      if (choice.target === "external") {
        await openExternal(url);
      } else if (choice.target === "split-pane") {
        const sourceEntry = getVisibleWebAppEntryByKey(payload.sourceWebAppKey) ||
          getVisibleWebAppEntryByUrl(payload.sourceUrl);
        if (!openUrlInSplitPaneFromEntry(sourceEntry, url, choice.label || "")) {
          const opened = await invokeWebApp("navigateWebApp", payload.sourceWebAppKey, "open", url);
          if (!opened) {
            await openExternal(url);
          }
        }
      } else {
        await invokeWebApp("navigateWebApp", payload.sourceWebAppKey, "open", url);
      }

      if (!choice.persist) {
        return;
      }

      const settings = getSettings();
      const nextRule = {
        pattern: getWebAppOpenRulePattern(url, choice.scope),
        scope: choice.scope,
        target: choice.target,
        label: choice.label || ""
      };
      await updateSettings({
        webAppOpenRules: upsertWebAppOpenRule(settings.webAppOpenRules || [], nextRule)
      });
    }

    function createRadioOption(
      name: string,
      value: string,
      labelText: string,
      descriptionText: string,
      checked = false
    ) {
      const label = document.createElement("label");
      label.className = "webapp-open-option";

      const input = document.createElement("input");
      input.type = "radio";
      input.name = name;
      input.value = value;
      input.checked = checked;

      const copy = document.createElement("span");
      copy.innerHTML = `<strong>${labelText}</strong><small>${descriptionText}</small>`;

      label.append(input, copy);
      return { label, input };
    }

    async function openWebAppOpenUrlDialog(payload: WebAppOpenPayload = {}) {
      let url = "";
      try {
        url = normalizeAddressInput(payload.url);
      } catch {
        return;
      }

      const sourceEntry = getVisibleWebAppEntryByKey(payload.sourceWebAppKey);
      const sourceWebApp = sourceEntry?.webApp || null;
      const sourceBounds = normalizePayloadBounds(payload.sourceBounds) || getWebAppHostBounds(sourceEntry?.host) || null;

      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog webapp-open-dialog";
      dialog.style.visibility = "hidden";
      if (sourceBounds) {
        dialog.classList.add("anchored");
        dialog.style.left = `${Math.round(sourceBounds.x + (sourceBounds.width / 2))}px`;
        dialog.style.top = `${Math.round(sourceBounds.y + (sourceBounds.height / 2))}px`;
      }

      const panel = document.createElement("form");
      panel.className = "plugin-settings-dialog-panel webapp-open-dialog-panel";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = "Open URL";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

      const summary = document.createElement("div");
      summary.className = "webapp-open-summary";
      const source = document.createElement("span");
      source.textContent = sourceWebApp ? `From ${sourceWebApp.label}` : "From webapp";
      const urlText = document.createElement("code");
      urlText.textContent = url;
      summary.append(source, urlText);

      const targetGroup = document.createElement("div");
      targetGroup.className = "webapp-open-options";
      const samePane = createRadioOption(
        "webAppOpenTarget",
        "same-pane",
        "Same pane",
        "Navigate the current webapp pane to this URL.",
        true
      );
      const splitPane = createRadioOption(
        "webAppOpenTarget",
        "split-pane",
        "Split pane",
        "Open this URL in a new pane next to the current one."
      );
      const external = createRadioOption(
        "webAppOpenTarget",
        "external",
        "External browser",
        "Open this URL outside Boatyard."
      );
      targetGroup.append(samePane.label, splitPane.label, external.label);

      const persistLabel = document.createElement("label");
      persistLabel.className = "webapp-open-persist";
      const persistInput = document.createElement("input");
      persistInput.type = "checkbox";
      persistInput.name = "persistRule";
      const persistCopy = document.createElement("span");
      persistCopy.innerHTML = "<strong>Always use this method</strong><small>Save a rule in global settings.</small>";
      persistLabel.append(persistInput, persistCopy);

      const scopeLabel = document.createElement("label");
      scopeLabel.className = "webapp-open-scope";
      const scopeText = document.createElement("span");
      scopeText.textContent = "Rule scope";
      const scopeSelect = document.createElement("select");
      scopeSelect.name = "ruleScope";
      for (const [value, label] of [
        ["exact", "Exact URL"],
        ["host", "This host"],
        ["path-prefix", "This path prefix"]
      ]) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        scopeSelect.append(option);
      }
      scopeLabel.append(scopeText, scopeSelect);
      scopeLabel.hidden = true;

      persistInput.addEventListener("change", () => {
        scopeLabel.hidden = !persistInput.checked;
      });

      const error = document.createElement("p");
      error.className = "form-error";
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";
      const cancelButton = document.createElement("button");
      cancelButton.className = "secondary-button";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => dialog.close());
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Open";
      actions.append(cancelButton, submitButton);

      panel.append(header, summary, targetGroup, persistLabel, scopeLabel, error, actions);
      panel.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.hidden = true;
        submitButton.disabled = true;

        try {
          const elements = panel.elements as WebAppOpenFormControls;
          await applyWebAppOpenChoice(payload, {
            target: elements.webAppOpenTarget.value,
            persist: persistInput.checked,
            scope: scopeSelect.value,
            label: String(sourceWebApp?.label || "")
          });
          dialog.close();
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        } finally {
          submitButton.disabled = false;
        }
      });

      dialog.append(panel);
      await showOverlayDialog(dialog, {
        freeze: "overlap",
        removeOnClose: true,
        freezeMargin: 16
      });
    }

    function normalizeAddressInput(rawUrl: unknown) {
      const trimmed = String(rawUrl || "").trim();

      if (!trimmed) {
        throw new Error("URL is required.");
      }

      const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed);
      const isLocalhost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/.test(trimmed);
      return hasProtocol ? trimmed : `${isLocalhost ? "http" : "https"}://${trimmed}`;
    }

    function selectWebApp(project: RendererProject, paneNode: MenuPaneNode, webApp: MenuWebApp) {
      setSelectedWebAppForPane(paneNode.id, webApp.id);
      paneNode.selectedWebAppId = webApp.id;
      setSelectedWebAppForProject(project.id, webApp.id);
      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    async function renameWidgetPane(
      project: RendererProject,
      widgetPane: NonNullable<MenuWebApp["widgetPane"]>,
      nextLabel: unknown
    ) {
      const currentLabel = widgetPane.label || "Widgets";
      const normalizedLabel = String(nextLabel || "").trim();
      if (!normalizedLabel || normalizedLabel === currentLabel) {
        return;
      }

      const widgetPanes = getProjectWidgetPanes(project).map((pane: UnknownRecord) => (
        pane.id === widgetPane.id
          ? { ...pane, label: normalizedLabel }
          : pane
      ));
      await updateProject(project.id || "", { widgetPanes });
      renderWorkspaceDashboard(getProjectById(project.id) || project);
    }

    function editWidgetPaneLabel(
      project: RendererProject,
      widgetPane: NonNullable<MenuWebApp["widgetPane"]>,
      button: HTMLButtonElement
    ) {
      const editor = document.createElement("input");
      editor.className = "widget-pane-tab widget-pane-tab-editor";
      editor.type = "text";
      editor.value = widgetPane.label || "Widgets";
      editor.setAttribute("aria-label", "Widget page name");

      let finished = false;
      const finish = async (shouldSave: boolean) => {
        if (finished) {
          return;
        }
        finished = true;

        const nextLabel = editor.value;
        editor.replaceWith(button);
        if (!shouldSave) {
          return;
        }

        try {
          await renameWidgetPane(project, widgetPane, nextLabel);
        } catch (error) {
          console.error("Could not rename widget pane:", error);
        }
      };

      editor.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          finish(true);
        } else if (event.key === "Escape") {
          event.preventDefault();
          finish(false);
        }
      });
      editor.addEventListener("blur", () => finish(true));

      button.replaceWith(editor);
      editor.focus();
      editor.select();
    }

    function createWidgetPaneTabs(
      project: RendererProject,
      paneNode: MenuPaneNode,
      selectedWebApp: MenuWebApp,
      webApps: MenuWebApp[],
      options: WidgetPaneTabsOptions = {}
    ) {
      const widgetWebApps = webApps.filter((webApp: MenuWebApp) => webApp.kind === "widgets");
      const list = document.createElement("div");
      list.className = "widget-pane-tabs";
      list.setAttribute("role", "tablist");
      list.setAttribute("aria-label", "Widget pages");

      for (const webApp of widgetWebApps) {
        if (options.editing && webApp.id !== selectedWebApp.id) {
          continue;
        }

        const button = document.createElement("button");
        button.className = "widget-pane-tab";
        button.type = "button";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(webApp.id === selectedWebApp.id));
        button.textContent = String(webApp.label || "");
        button.addEventListener("click", () => {
          if (webApp.id !== selectedWebApp.id) {
            selectWebApp(project, paneNode, webApp);
          }
        });
        if (!isGlobalWorkspace(project)) {
          button.title = "Double-click to rename widget page";
          button.addEventListener("dblclick", (event) => {
            event.preventDefault();
            event.stopPropagation();
            if (webApp.widgetPane) {
              editWidgetPaneLabel(project, webApp.widgetPane, button);
            }
          });
        }
        list.append(button);
      }

      return list;
    }

    function closeWebAppTabMenu() {
      if (!openWebAppTabMenu) {
        return;
      }

      openWebAppTabMenu.cleanup?.();
      openWebAppTabMenu.remove();
      openWebAppTabMenu = null;
      restoreWebAppsAfterOverlay();
    }

    async function openWebAppTabMenuFromButton(
      button: HTMLButtonElement,
      project: RendererProject,
      paneNode: MenuPaneNode,
      selectedWebApp: MenuWebApp,
      webApps: MenuWebApp[]
    ) {
      closeWebAppTabMenu();
      closeTerminalTabMenu();

      const rect = button.getBoundingClientRect();
      await freezeWebAppsForOverlay({
        keys: selectedWebApp?.key ? [selectedWebApp.key] : []
      });

      const menu = document.createElement("div") as WebAppMenuElement;
      menu.className = "webapp-tab-menu";
      menu.setAttribute("role", "menu");

      menu.style.top = `${Math.round(rect.bottom + 6)}px`;
      menu.style.left = `${Math.round(Math.min(rect.left, window.innerWidth - 220))}px`;

      const rootWebApps = webApps.filter((webApp: MenuWebApp) => !webApp.parentWebAppId);
      const childWebAppsByParentId = new Map<string, MenuWebApp[]>();
      for (const webApp of webApps.filter((candidate: MenuWebApp) => candidate.parentWebAppId)) {
        const parentWebAppId = webApp.parentWebAppId;
        if (!parentWebAppId) {
          continue;
        }
        const children = childWebAppsByParentId.get(parentWebAppId) || [];
        children.push(webApp);
        childWebAppsByParentId.set(parentWebAppId, children);
      }
      const orderedWebApps: OrderedWebAppMenuItem[] = [];
      for (const webApp of rootWebApps) {
        orderedWebApps.push({
          webApp,
          depth: 0
        });
        const webAppId = webApp.id;
        for (const childWebApp of webAppId ? childWebAppsByParentId.get(webAppId) || [] : []) {
          orderedWebApps.push({
            webApp: childWebApp,
            depth: 1
          });
        }
      }
      for (const [parentId, children] of childWebAppsByParentId) {
        if (rootWebApps.some((webApp) => webApp.id === parentId)) {
          continue;
        }
        for (const webApp of children) {
          orderedWebApps.push({
            webApp,
            depth: 0
          });
        }
      }

      for (const { webApp, depth } of orderedWebApps) {
        const item = document.createElement("button");
        item.className = "webapp-tab-menu-item";
        item.classList.toggle("child", depth > 0);
        item.classList.toggle("loaded", isWebAppLoaded(webApp.key));
        item.type = "button";
        item.dataset.webAppId = webApp.id || "";
        item.setAttribute("role", "menuitem");
        item.setAttribute("aria-current", String(webApp.id === selectedWebApp.id));
        item.setAttribute("data-load-state", isWebAppLoaded(webApp.key) ? "Loaded" : "Not loaded");
        item.textContent = depth > 0 && webApp.parentLabel
          ? `${webApp.parentLabel} -> ${webApp.label}`
          : String(webApp.label || "");
        item.addEventListener("click", () => {
          closeWebAppTabMenu();
          selectWebApp(project, paneNode, webApp);
        });
        menu.append(item);
      }

      document.body.append(menu);
      openWebAppTabMenu = menu;

      function onPointerDown(event: PointerEvent) {
        if (!menu.contains(event.target as Node | null) && event.target !== button) {
          closeWebAppTabMenu();
        }
      }

      function onKeyDown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          closeWebAppTabMenu();
        }
      }

      menu.cleanup = () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
        button.setAttribute("aria-expanded", "false");
      };

      setTimeout(() => {
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
      }, 0);

      menu.querySelector("button")?.focus();
    }

    async function openWebAppHomeMenu(
      event: MouseEvent,
      project: RendererProject,
      paneNode: MenuPaneNode,
      selectedWebApp: MenuWebApp
    ) {
      event.preventDefault();
      const sourceButton = event.currentTarget;
      closeWebAppTabMenu();
      closeTerminalTabMenu();
      await freezeWebAppsForOverlay({
        keys: selectedWebApp?.key ? [selectedWebApp.key] : []
      });

      const menu = document.createElement("div") as WebAppMenuElement;
      menu.className = "webapp-tab-menu";
      menu.setAttribute("role", "menu");

      const menuWidth = 260;
      const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
      const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 48));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      const item = document.createElement("button");
      item.className = "webapp-tab-menu-item";
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = selectedWebApp.homeTab ? "Update this tab home" : "Save current URL as sub-tab";
      item.addEventListener("click", () => {
        closeWebAppTabMenu();
        saveCurrentUrlAsWebAppHomeTab(project, paneNode, selectedWebApp).catch((error: unknown) => {
          console.error("Could not save webapp home tab:", error);
        });
      });
      menu.append(item);

      document.body.append(menu);
      openWebAppTabMenu = menu;

      function onPointerDown(pointerEvent: PointerEvent) {
        if (!menu.contains(pointerEvent.target as Node | null) && pointerEvent.target !== sourceButton) {
          closeWebAppTabMenu();
        }
      }

      function onKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key === "Escape") {
          closeWebAppTabMenu();
        }
      }

      menu.cleanup = () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };

      setTimeout(() => {
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
      }, 0);

      item.focus();
    }

    async function openWebAppRefreshMenu(event: MouseEvent, selectedWebApp: MenuWebApp) {
      event.preventDefault();
      const sourceButton = event.currentTarget;
      closeWebAppTabMenu();
      closeTerminalTabMenu();
      await freezeWebAppsForOverlay({
        keys: selectedWebApp?.key ? [selectedWebApp.key] : []
      });

      const menu = document.createElement("div") as WebAppMenuElement;
      menu.className = "webapp-tab-menu";
      menu.setAttribute("role", "menu");

      const menuWidth = 180;
      const left = clamp(event.clientX, 12, Math.max(12, window.innerWidth - menuWidth - 12));
      const top = clamp(event.clientY, 12, Math.max(12, window.innerHeight - 48));
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;

      const item = document.createElement("button");
      item.className = "webapp-tab-menu-item";
      item.type = "button";
      item.setAttribute("role", "menuitem");
      item.textContent = "Hard reload";
      item.addEventListener("click", () => {
        closeWebAppTabMenu();
        invokeWebApp("navigateWebApp", selectedWebApp.key, "hard-refresh").catch((error: unknown) => {
          console.error("Could not hard reload webapp:", error);
        });
      });
      menu.append(item);

      document.body.append(menu);
      openWebAppTabMenu = menu;

      function onPointerDown(pointerEvent: PointerEvent) {
        if (!menu.contains(pointerEvent.target as Node | null) && pointerEvent.target !== sourceButton) {
          closeWebAppTabMenu();
        }
      }

      function onKeyDown(keyEvent: KeyboardEvent) {
        if (keyEvent.key === "Escape") {
          closeWebAppTabMenu();
        }
      }

      menu.cleanup = () => {
        document.removeEventListener("pointerdown", onPointerDown);
        document.removeEventListener("keydown", onKeyDown);
      };

      setTimeout(() => {
        document.addEventListener("pointerdown", onPointerDown);
        document.addEventListener("keydown", onKeyDown);
      }, 0);

      item.focus();
    }

    return {
      applyWebAppOpenChoice,
      closeWebAppTabMenu,
      createWidgetPaneTabs,
      normalizeAddressInput,
      openWebAppHomeMenu,
      openWebAppOpenUrlDialog,
      openWebAppRefreshMenu,
      openWebAppTabMenuFromButton,
      isWebAppTabMenuOpen: () => Boolean(openWebAppTabMenu)
    };
}
