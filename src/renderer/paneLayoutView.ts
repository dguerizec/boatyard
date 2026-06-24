"use strict";

(function () {
  type PaneLayoutHost = HTMLDivElement & {
    boatyardCleanup?: () => void;
  };

  function createPaneLayoutView({
    minWidgetRailWidth,
    webAppSplitResizerSize,
    dashboardGrid,
    createToolIcon,
    paneLayoutState,
    getProjectWebApps,
    getProjectPaneLayout,
    getSelectedWebApp,
    getProjectWidgetLayout,
    getWidgetGridColumnCount,
    createWidgetPaneActions,
    createWidgetPaneSurface,
    createWidgetPaneTabs,
    isWebAppTabMenuOpen,
    closeWebAppTabMenu,
    openWebAppTabMenuFromButton,
    openWebAppHomeMenu,
    openWebAppRefreshMenu,
    createTerminalSurface,
    invokeWebApp,
    isPasswordManagerEnabled,
    isWebAppAutofillEnabled,
    syncWebAppAutofillButton,
    toggleWebAppAutofill,
    getCurrentWebAppUrl,
    setCurrentWebAppUrl,
    normalizeAddressInput,
    isGlobalWorkspace,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getAllProjectPluginConfig,
    openProjectWebApp,
    setVisibleWebAppHost,
    queueWebAppSync,
    renderWorkspaceDashboard,
    persistPaneLayout
  }) {
    function clearPaneExpansionPreview() {
      document.querySelectorAll(".webapp-split.pane-expand-preview").forEach((split) => {
        split.classList.remove("pane-expand-preview");
      });
    }

    function previewPaneExpansion(project, paneId, enabled) {
      clearPaneExpansionPreview();

      if (!enabled) {
        return;
      }

      const target = paneLayoutState.getPaneExpansionTarget(project, paneId);
      if (!target) {
        return;
      }

      const split = [...document.querySelectorAll<HTMLElement>(".webapp-split")]
        .find((candidate) => candidate.dataset.splitId === target.node.id);
      if (split) {
        split.classList.add("pane-expand-preview");
      }
    }

    function expandPane(project, paneId) {
      const target = paneLayoutState.getPaneExpansionTarget(project, paneId);

      if (!target) {
        return;
      }

      target.node.expandedChild = target.side;
      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    function shrinkPane(project, paneId) {
      const path = paneLayoutState.getPaneAncestorPath(getProjectPaneLayout(project), paneId) || [];
      const target = path.find(({ node, side }) => node.expandedChild === side);

      if (!target) {
        return;
      }

      delete target.node.expandedChild;
      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    function splitPane(project, paneId, direction) {
      const layout = getProjectPaneLayout(project);
      const webApps = getProjectWebApps(project, paneId);
      const currentWebAppId =
        paneLayoutState.getSelectedWebAppForPane(paneId) ||
        paneLayoutState.getSelectedWebAppForProject(project.id) ||
        webApps[0].id;
      const nextWebAppId = webApps.find((webApp) => webApp.id !== currentWebAppId)?.id || currentWebAppId;
      const replacement = paneLayoutState.createSplitNode(project, direction, { type: "pane", id: paneId }, nextWebAppId);
      replacement.first.selectedWebAppId = currentWebAppId;
      paneLayoutState.setPaneLayout(project.id, paneLayoutState.replacePaneNode(layout, paneId, replacement));
      paneLayoutState.setSelectedWebAppForPane(paneId, currentWebAppId);
      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    function closePane(project, paneId) {
      const layout = getProjectPaneLayout(project);

      if (paneLayoutState.countPaneNodes(layout) <= 1) {
        return;
      }

      const result = paneLayoutState.removePaneNode(layout, paneId);
      if (!result.removed) {
        return;
      }

      paneLayoutState.deleteSelectedWebAppForPane(paneId);
      paneLayoutState.setPaneLayout(project.id, result.node);
      persistPaneLayout(project);
      renderWorkspaceDashboard(project);
    }

    function createSplitResizer(project, splitNode) {
      const resizer = document.createElement("div");
      resizer.className = `webapp-split-resizer ${splitNode.direction}`;
      resizer.setAttribute("role", "separator");
      resizer.setAttribute("aria-orientation", splitNode.direction === "vertical" ? "vertical" : "horizontal");

      resizer.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const splitElement = resizer.parentElement;
        const rect = splitElement.getBoundingClientRect();
        const isVertical = splitNode.direction === "vertical";

        function onPointerMove(moveEvent) {
          const rawRatio = isVertical
            ? (moveEvent.clientX - rect.left) / rect.width
            : (moveEvent.clientY - rect.top) / rect.height;
          splitNode.ratio = Math.min(0.85, Math.max(0.15, rawRatio));
          applySplitRatio(splitElement, splitNode);
          queueWebAppSync();
        }

        function onPointerUp() {
          document.removeEventListener("pointermove", onPointerMove);
          document.removeEventListener("pointerup", onPointerUp);
          persistPaneLayout(project);
        }

        document.addEventListener("pointermove", onPointerMove);
        document.addEventListener("pointerup", onPointerUp);
      });

      return resizer;
    }

    function applySplitRatio(splitElement, splitNode) {
      const firstRatio = Math.round(splitNode.ratio * 1000) / 10;
      const secondRatio = Math.round((1 - splitNode.ratio) * 1000) / 10;
      const resizerOffset = webAppSplitResizerSize / 2;
      const first = `minmax(0, calc(${firstRatio}% - ${resizerOffset}px))`;
      const second = `minmax(0, calc(${secondRatio}% - ${resizerOffset}px))`;
      const resizer = `${webAppSplitResizerSize}px`;

      if (splitNode.direction === "vertical") {
        splitElement.style.gridTemplateColumns = `${first} ${resizer} ${second}`;
        splitElement.style.gridTemplateRows = "";
      } else {
        splitElement.style.gridTemplateColumns = "";
        splitElement.style.gridTemplateRows = `${first} ${resizer} ${second}`;
      }
    }

    function createWebAppPane(project, paneNode) {
      const webApps = getProjectWebApps(project, paneNode.id);
      const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps);
      const isTerminalPane = selectedWebApp.kind === "terminal";
      const isWidgetPane = selectedWebApp.kind === "widgets";
      const isDomPane = selectedWebApp.kind === "dom";
      const widgetFallbackWidth = isWidgetPane
        ? Math.max(minWidgetRailWidth, Math.round((dashboardGrid.getBoundingClientRect().width || window.innerWidth) / 2))
        : null;
      const widgetGridColumns = isWidgetPane ? getWidgetGridColumnCount(widgetFallbackWidth) : null;
      const widgetLayout = isWidgetPane ? getProjectWidgetLayout(project, widgetGridColumns, selectedWebApp.widgetPane.id) : null;
      const isWidgetEditing = Boolean(isWidgetPane && widgetLayout && !widgetLayout.locked);
      const pane = document.createElement("section");
      pane.className = "webapp-pane";
      pane.classList.toggle("widget-pane", isWidgetPane);
      pane.classList.toggle("editing", isWidgetEditing);
      pane.dataset.paneId = paneNode.id;
      pane.dataset.webAppId = selectedWebApp.id;
      if (selectedWebApp.kind) {
        pane.dataset.webAppKind = selectedWebApp.kind;
      }

      const header = document.createElement("div");
      header.className = "webapp-pane-header";

      const tabs = document.createElement("div");
      tabs.className = "webapp-tabs";
      tabs.setAttribute("role", "tablist");
      tabs.setAttribute("aria-label", "Project webapps");

      const tabPickerButton = document.createElement("button");
      tabPickerButton.className = "webapp-tab webapp-tab-picker";
      tabPickerButton.type = "button";
      tabPickerButton.setAttribute("role", "tab");
      tabPickerButton.setAttribute("aria-selected", "true");
      tabPickerButton.setAttribute("aria-haspopup", "menu");
      tabPickerButton.setAttribute("aria-expanded", "false");
      tabPickerButton.textContent = isWidgetPane ? "Widgets" : selectedWebApp.label;
      tabPickerButton.addEventListener("click", () => {
        const isOpen = isWebAppTabMenuOpen();
        tabPickerButton.setAttribute("aria-expanded", String(!isOpen));

        if (isOpen) {
          closeWebAppTabMenu();
        } else {
          openWebAppTabMenuFromButton(tabPickerButton, project, paneNode, selectedWebApp, webApps);
        }
      });

      tabs.append(tabPickerButton);

      if (isWidgetPane) {
        tabs.append(createWidgetPaneTabs(project, paneNode, selectedWebApp, webApps, {
          editing: isWidgetEditing
        }));
      }

      if (!isTerminalPane && !isWidgetPane && !isDomPane) {
        const homeButton = document.createElement("button");
        homeButton.className = "webapp-tool-button";
        homeButton.type = "button";
        homeButton.title = "Go home";
        homeButton.setAttribute("aria-label", "Go home");
        homeButton.append(createToolIcon("home"));
        homeButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "home", selectedWebApp.url));
        homeButton.addEventListener("contextmenu", (event) => {
          openWebAppHomeMenu(event, project, paneNode, selectedWebApp);
        });

        const backButton = document.createElement("button");
        backButton.className = "webapp-tool-button";
        backButton.type = "button";
        backButton.title = "Go back";
        backButton.setAttribute("aria-label", "Go back");
        backButton.append(createToolIcon("arrowLeft"));
        backButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "back"));

        const forwardButton = document.createElement("button");
        forwardButton.className = "webapp-tool-button";
        forwardButton.type = "button";
        forwardButton.title = "Go forward";
        forwardButton.setAttribute("aria-label", "Go forward");
        forwardButton.append(createToolIcon("arrowRight"));
        forwardButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "forward"));

        const refreshButton = document.createElement("button");
        refreshButton.className = "webapp-tool-button";
        refreshButton.type = "button";
        refreshButton.title = "Refresh";
        refreshButton.setAttribute("aria-label", "Refresh");
        refreshButton.append(createToolIcon("refresh"));
        refreshButton.addEventListener("click", () => invokeWebApp("navigateWebApp", selectedWebApp.key, "refresh"));
        refreshButton.addEventListener("contextmenu", (event) => {
          openWebAppRefreshMenu(event, selectedWebApp);
        });

        const autofillButton = isPasswordManagerEnabled() ? document.createElement("button") : null;
        if (autofillButton) {
          autofillButton.className = "webapp-tool-button autofill";
          autofillButton.type = "button";
          autofillButton.dataset.webappKey = selectedWebApp.key;
          autofillButton.title = "Autofill credentials";
          autofillButton.setAttribute("aria-label", "Autofill credentials");
          autofillButton.append(createToolIcon("key"));
          syncWebAppAutofillButton(autofillButton, isWebAppAutofillEnabled(selectedWebApp));
          autofillButton.addEventListener("click", () => {
            toggleWebAppAutofill(selectedWebApp, autofillButton).catch((error) => {
              console.error("Could not update webapp autofill:", error);
            });
          });
        }

        const activeUrl = document.createElement("input");
        activeUrl.className = "webapp-url";
        activeUrl.type = "text";
        activeUrl.autocomplete = "off";
        activeUrl.spellcheck = false;
        activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
        activeUrl.dataset.webappKey = selectedWebApp.key;
        activeUrl.setAttribute("aria-label", "Current webapp URL");
        activeUrl.addEventListener("keydown", (event) => {
          if (event.key === "Enter") {
            event.preventDefault();

            try {
              const nextUrl = normalizeAddressInput(activeUrl.value);
              setCurrentWebAppUrl(selectedWebApp.key, nextUrl);
              activeUrl.value = nextUrl;
              invokeWebApp("navigateWebApp", selectedWebApp.key, "open", nextUrl);
            } catch {
              activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
            }
          } else if (event.key === "Escape") {
            activeUrl.value = getCurrentWebAppUrl(selectedWebApp);
            activeUrl.blur();
          }
        });

        tabs.append(
          homeButton,
          backButton,
          forwardButton,
          refreshButton,
          ...(autofillButton ? [autofillButton] : []),
          activeUrl
        );
      }

      const actions = document.createElement("div");
      actions.className = "webapp-actions";

      if (isWidgetPane) {
        actions.append(createWidgetPaneActions(project, selectedWebApp.widgetPane, widgetLayout, widgetGridColumns));
      }

      const terminalPaneTabs = isTerminalPane ? document.createElement("div") : null;
      if (terminalPaneTabs) {
        terminalPaneTabs.className = "pane-terminal-tabs-slot";
        tabs.append(terminalPaneTabs);
      }

      const expansionState = paneLayoutState.getPaneExpansionState(project, paneNode.id);
      const expandPaneButton = document.createElement("button");
      expandPaneButton.className = "webapp-tool-button";
      expandPaneButton.type = "button";
      expandPaneButton.title = "Expand pane";
      expandPaneButton.setAttribute("aria-label", "Expand pane");
      expandPaneButton.append(createToolIcon("expandPane"));
      expandPaneButton.disabled = !expansionState.canExpand;
      expandPaneButton.addEventListener("mouseenter", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
      expandPaneButton.addEventListener("mouseleave", clearPaneExpansionPreview);
      expandPaneButton.addEventListener("focus", () => previewPaneExpansion(project, paneNode.id, !expandPaneButton.disabled));
      expandPaneButton.addEventListener("blur", clearPaneExpansionPreview);
      expandPaneButton.addEventListener("click", () => expandPane(project, paneNode.id));

      const shrinkPaneButton = document.createElement("button");
      shrinkPaneButton.className = "webapp-tool-button";
      shrinkPaneButton.type = "button";
      shrinkPaneButton.title = "Shrink pane";
      shrinkPaneButton.setAttribute("aria-label", "Shrink pane");
      shrinkPaneButton.append(createToolIcon("shrinkPane"));
      shrinkPaneButton.disabled = !expansionState.canShrink;
      shrinkPaneButton.classList.toggle("active", expansionState.canShrink);
      shrinkPaneButton.addEventListener("click", () => shrinkPane(project, paneNode.id));

      const verticalSplitButton = document.createElement("button");
      verticalSplitButton.className = "webapp-tool-button split-vertical";
      verticalSplitButton.type = "button";
      verticalSplitButton.title = "Split vertically";
      verticalSplitButton.setAttribute("aria-label", "Split vertically");
      verticalSplitButton.append(createToolIcon("splitVertical"));
      verticalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "vertical"));

      const horizontalSplitButton = document.createElement("button");
      horizontalSplitButton.className = "webapp-tool-button split-horizontal";
      horizontalSplitButton.type = "button";
      horizontalSplitButton.title = "Split horizontally";
      horizontalSplitButton.setAttribute("aria-label", "Split horizontally");
      horizontalSplitButton.append(createToolIcon("splitHorizontal"));
      horizontalSplitButton.addEventListener("click", () => splitPane(project, paneNode.id, "horizontal"));

      const closePaneButton = document.createElement("button");
      closePaneButton.className = "webapp-tool-button danger";
      closePaneButton.type = "button";
      closePaneButton.title = "Close pane";
      closePaneButton.setAttribute("aria-label", "Close pane");
      closePaneButton.append(createToolIcon("close"));
      closePaneButton.disabled = paneLayoutState.countPaneNodes(getProjectPaneLayout(project)) <= 1;
      closePaneButton.addEventListener("click", () => closePane(project, paneNode.id));

      actions.append(expandPaneButton, shrinkPaneButton, verticalSplitButton, horizontalSplitButton, closePaneButton);
      header.append(tabs, actions);

      const host = document.createElement("div") as PaneLayoutHost;
      host.className = `webapp-host${isTerminalPane ? " terminal-pane-host" : ""}`;
      host.setAttribute("role", "region");
      host.setAttribute("aria-label", `${project.name} ${selectedWebApp.label}`);

      pane.append(header, host);

      if (isTerminalPane) {
        host.append(createTerminalSurface(project, {
          tagName: "div",
          className: "terminal-pane-surface terminal-widget",
          storageKey: `pane:${paneNode.id}`,
          tabsContainer: terminalPaneTabs
        }));
      } else if (isWidgetPane) {
        host.append(createWidgetPaneSurface(project, selectedWebApp.widgetPane));
      } else if (isDomPane) {
        const pluginPane = selectedWebApp.pluginPane;
        const cleanup = pluginPane.render(host, {
          project,
          projectId: project.id,
          projectConfig: isGlobalWorkspace(project) ? {} : getProjectPluginConfig(project.id, pluginPane.pluginId),
          globalPluginConfig: getGlobalPluginConfig(pluginPane.pluginId),
          allProjectPluginConfig: getAllProjectPluginConfig(project),
          openProjectWebApp(webAppId, url = "") {
            return openProjectWebApp(project.id, webAppId, url);
          }
        });
        if (typeof cleanup === "function") {
          host.boatyardCleanup = cleanup;
        }
      } else {
        setVisibleWebAppHost(paneNode.id, {
          webApp: selectedWebApp,
          host
        });
      }

      queueWebAppSync();
      return pane;
    }

    function createPaneLayout(project, node) {
      if (node.type === "pane") {
        return createWebAppPane(project, node);
      }

      if (node.expandedChild === "first" || node.expandedChild === "second") {
        return createPaneLayout(project, node[node.expandedChild]);
      }

      const split = document.createElement("div");
      split.className = `webapp-split ${node.direction}`;
      split.dataset.splitId = node.id;
      applySplitRatio(split, node);
      split.append(
        createPaneLayout(project, node.first),
        createSplitResizer(project, node),
        createPaneLayout(project, node.second)
      );
      return split;
    }

    return {
      createPaneLayout
    };
  }

  (window as unknown as PaneLayoutViewGlobal).BoatyardPaneLayoutView = Object.freeze({
    create: createPaneLayoutView
  });
})();
