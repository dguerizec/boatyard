"use strict";

(function () {
  function createOnboardingTour({
    elements,
    onboardingVersion,
    getManual,
    getViewState,
    selectGlobalForTour,
    getGlobalWorkspace,
    getProjectWebApps,
    getProjectPaneLayout,
    getSelectedWebApp,
    findPaneNode,
    findFirstPaneNode,
    collectPaneNodes,
    countPaneNodes,
    createSplitNode,
    replacePaneNode,
    setPaneLayout,
    getPaneLayout,
    setSelectedWebAppForPane,
    getSelectedWebAppForPane,
    setSelectedWebAppForProject,
    getSelectedWebAppForProject,
    deleteSelectedWebAppForPane,
    deleteSelectedWebAppForProject,
    getVisibleWebAppEntries,
    renderWorkspaceDashboard,
    closeWebAppTabMenu,
    openWebAppTabMenuFromButton,
    waitForWebAppLoad,
    syncWebAppView,
    freezeWebAppsForOverlay,
    restoreWebAppsAfterOverlay,
    nextAnimationFrame,
    updateOnboarding,
    updatePaneLayout
  }) {
    const { addProjectButton, projectList } = elements;
    let onboardingDemoProjectVisible = false;
    let onboardingTourActive = false;

    function clearOnboardingHighlight() {
      document.querySelector(".onboarding-highlight")?.classList.remove("onboarding-highlight");
    }

    function removeOnboardingDemoProject() {
      onboardingDemoProjectVisible = false;
      document.querySelector(".onboarding-demo-project")?.remove();
      document.querySelector(".onboarding-hidden-empty")?.classList.remove("onboarding-hidden-empty");
    }

    function ensureOnboardingDemoProject() {
      onboardingDemoProjectVisible = true;
      const existing = document.querySelector(".onboarding-demo-project");
      if (existing) {
        return existing;
      }

      const emptyCopy = projectList.querySelector(".empty-copy");
      emptyCopy?.classList.add("onboarding-hidden-empty");

      const row = document.createElement("div");
      row.className = "project-nav-row onboarding-demo-project";

      const button = document.createElement("button");
      button.className = "nav-item";
      button.type = "button";

      const titleRow = document.createElement("div");
      titleRow.className = "project-nav-title";

      const projectName = document.createElement("span");
      projectName.className = "project-nav-name";
      projectName.textContent = "Demo project";
      titleRow.append(projectName);

      const projectSlug = document.createElement("small");
      projectSlug.textContent = "demo-project";
      button.append(titleRow, projectSlug);

      const settingsButton = document.createElement("button");
      settingsButton.className = "project-settings-button";
      settingsButton.type = "button";
      settingsButton.title = "Demo project settings";
      settingsButton.setAttribute("aria-label", "Demo project settings");
      settingsButton.textContent = "⚙";

      row.append(button, settingsButton);
      projectList.append(row);
      return row;
    }

    function getDefaultOnboardingPaneWebAppId(project, paneId) {
      return getProjectWebApps(project, paneId).find((webApp) => webApp.id !== "manual")?.id || "manual";
    }

    function ensureOnboardingSplitPane() {
      const project = getGlobalWorkspace();
      let layout = getProjectPaneLayout(project);

      if (countPaneNodes(layout) < 2) {
        const sourcePane = findFirstPaneNode(layout);
        if (!sourcePane) {
          return;
        }

        const currentWebAppId =
          getSelectedWebAppForPane(sourcePane.id) ||
          sourcePane.selectedWebAppId ||
          getSelectedWebAppForProject(project.id) ||
          "widgets:widgets-0";
        const replacement = createSplitNode(project, "vertical", { ...sourcePane });
        const splitWebAppId = getDefaultOnboardingPaneWebAppId(project, replacement.second.id);
        replacement.first.selectedWebAppId = currentWebAppId;
        replacement.second.selectedWebAppId = splitWebAppId;
        setPaneLayout(project.id, replacePaneNode(layout, sourcePane.id, replacement));
        setSelectedWebAppForPane(replacement.first.id, currentWebAppId);
        setSelectedWebAppForPane(replacement.second.id, splitWebAppId);
        layout = replacement;
      }

      const panes = collectPaneNodes(layout);
      const targetPane = panes.at(-1);
      if (!targetPane) {
        return null;
      }

      if ((getSelectedWebAppForPane(targetPane.id) || targetPane.selectedWebAppId) === "manual") {
        const webAppId = getDefaultOnboardingPaneWebAppId(project, targetPane.id);
        targetPane.selectedWebAppId = webAppId;
        setSelectedWebAppForPane(targetPane.id, webAppId);
      }

      renderWorkspaceDashboard(project);
      return targetPane;
    }

    function ensureOnboardingManualPane() {
      const project = getGlobalWorkspace();
      const manualPane = ensureOnboardingSplitPane();
      if (!manualPane) {
        return;
      }

      manualPane.selectedWebAppId = "manual";
      setSelectedWebAppForPane(manualPane.id, "manual");
      setSelectedWebAppForProject(project.id, "manual");
      renderWorkspaceDashboard(project);
    }

    function getVisibleManualWebApp() {
      for (const { webApp } of getVisibleWebAppEntries()) {
        if (webApp.id === "manual") {
          return webApp;
        }
      }

      return null;
    }

    async function openOnboardingPaneDropdown() {
      const project = getGlobalWorkspace();
      const panes = [...document.querySelectorAll(".webapp-pane")];
      const pane = panes.at(-1);
      const button = pane?.querySelector(".webapp-tab-picker");
      const paneId = pane?.dataset.paneId;
      const paneNode = paneId ? findPaneNode(getProjectPaneLayout(project), paneId) : null;
      if (!button || !paneNode) {
        return [];
      }

      const webApps = getProjectWebApps(project, paneNode.id);
      const selectedWebApp = getSelectedWebApp(project, paneNode.id, webApps);
      button.setAttribute("aria-expanded", "true");
      await openWebAppTabMenuFromButton(button, project, paneNode, selectedWebApp, webApps);
      document.querySelector(".webapp-tab-menu-item[data-web-app-id=\"manual\"]")?.focus();
      return selectedWebApp?.key ? [selectedWebApp.key] : [];
    }

    async function restoreOnboardingGlobalLayout(layout) {
      if (!layout) {
        return;
      }

      const project = getGlobalWorkspace();
      for (const pane of collectPaneNodes(getPaneLayout(project.id))) {
        deleteSelectedWebAppForPane(pane.id);
      }

      setPaneLayout(project.id, structuredClone(layout));
      deleteSelectedWebAppForProject(project.id);
      for (const pane of collectPaneNodes(layout)) {
        if (pane.selectedWebAppId) {
          setSelectedWebAppForPane(pane.id, pane.selectedWebAppId);
        }
      }

      try {
        await updatePaneLayout(project.id, layout);
      } catch (error) {
        console.error("Could not restore onboarding pane layout:", error);
      }

      if (getViewState().currentView === "global") {
        renderWorkspaceDashboard(project);
      }
    }

    function findOnboardingTarget(selector) {
      if (!selector) {
        return null;
      }

      const target = document.querySelector(selector);
      if (target) {
        return target;
      }

      if (selector === ".project-settings-button") {
        return document.querySelector(".project-nav-row") || addProjectButton;
      }

      return null;
    }

    async function persistOnboardingComplete() {
      try {
        await updateOnboarding({
          completedVersion: onboardingVersion,
          completedAt: new Date().toISOString()
        });
      } catch (error) {
        console.error("Could not persist onboarding state:", error);
      }
    }

    async function openOnboardingTour(options = {}) {
      const manual = getManual();
      const steps = manual.onboarding || [];
      if (!steps.length) {
        return;
      }

      if (options.startView !== false && getViewState().currentView !== "global") {
        selectGlobalForTour();
      }

      onboardingTourActive = true;
      const originalGlobalLayout = structuredClone(getProjectPaneLayout(getGlobalWorkspace()));

      const dialog = document.createElement("dialog");
      dialog.className = "onboarding-dialog";
      dialog.setAttribute("aria-label", "Boatyard guided tour");

      const spotlight = document.createElement("div");
      spotlight.className = "onboarding-spotlight";
      spotlight.setAttribute("aria-hidden", "true");

      const spotlightHole = document.createElement("div");
      spotlightHole.className = "onboarding-spotlight-hole";
      spotlight.append(spotlightHole);

      const panel = document.createElement("div");
      panel.className = "onboarding-panel";

      const header = document.createElement("div");
      header.className = "onboarding-header";

      const title = document.createElement("h3");
      const counter = document.createElement("span");
      header.append(title, counter);

      const body = document.createElement("p");
      body.className = "onboarding-body";

      const actions = document.createElement("div");
      actions.className = "onboarding-actions";

      const skipButton = document.createElement("button");
      skipButton.className = "secondary-button";
      skipButton.type = "button";
      skipButton.textContent = options.force ? "Close" : "Skip";

      const previousButton = document.createElement("button");
      previousButton.className = "secondary-button";
      previousButton.type = "button";
      previousButton.textContent = "Back";

      const nextButton = document.createElement("button");
      nextButton.className = "primary-button";
      nextButton.type = "button";

      actions.append(skipButton, previousButton, nextButton);
      panel.append(header, body, actions);
      dialog.append(panel);
      document.body.append(spotlight);
      document.body.append(dialog);

      let currentStep = 0;
      let highlightedTarget = null;
      let dialogClosed = false;

      function updateSpotlight(target) {
        if (!target) {
          spotlightHole.hidden = true;
          return;
        }

        const rect = target.getBoundingClientRect();
        const padding = 8;
        spotlightHole.hidden = false;
        spotlightHole.style.left = `${Math.max(8, rect.left - padding)}px`;
        spotlightHole.style.top = `${Math.max(8, rect.top - padding)}px`;
        spotlightHole.style.width = `${Math.max(1, rect.width + padding * 2)}px`;
        spotlightHole.style.height = `${Math.max(1, rect.height + padding * 2)}px`;
      }

      async function renderStep() {
        clearOnboardingHighlight();
        const step = steps[currentStep];
        const isManualStep = step.target === ".webapp-pane[data-web-app-id=\"manual\"] .webapp-tab-picker";
        const isPaneDropdownStep = step.target === ".webapp-tab-menu-item[data-web-app-id=\"manual\"]";
        const shouldPrepareBehindTour = (isManualStep || isPaneDropdownStep) && dialog.open;
        let manualLoadPromise = Promise.resolve(true);

        if (!isPaneDropdownStep) {
          closeWebAppTabMenu();
        }

        if (shouldPrepareBehindTour) {
          dialog.style.visibility = "hidden";
          spotlight.hidden = true;
          await restoreWebAppsAfterOverlay();
        }

        title.textContent = step.title;
        counter.textContent = `${currentStep + 1} / ${steps.length}`;
        body.textContent = step.body;
        previousButton.disabled = currentStep === 0;
        nextButton.textContent = currentStep === steps.length - 1 ? "Finish" : "Next";

        if (step.target?.startsWith(".onboarding-demo-project")) {
          ensureOnboardingDemoProject();
        }

        if (isPaneDropdownStep) {
          ensureOnboardingSplitPane();
        }

        if (isManualStep) {
          ensureOnboardingManualPane();
          const manualWebApp = getVisibleManualWebApp();
          manualLoadPromise = waitForWebAppLoad(manualWebApp?.key, manualWebApp?.url);
        }

        await nextAnimationFrame();
        await nextAnimationFrame();
        if (isPaneDropdownStep) {
          await syncWebAppView();
          await openOnboardingPaneDropdown();
          await nextAnimationFrame();
        }
        if (isManualStep) {
          await syncWebAppView();
          await manualLoadPromise;
          await nextAnimationFrame();
        }
        if (dialogClosed) {
          return;
        }
        await freezeWebAppsForOverlay();
        dialog.style.visibility = "";
        spotlight.hidden = false;

        const target = findOnboardingTarget(step.target);
        highlightedTarget = target;
        if (target) {
          target.classList.add("onboarding-highlight");
          target.scrollIntoView({ block: "nearest", inline: "nearest" });
          requestAnimationFrame(() => updateSpotlight(target));
        } else {
          updateSpotlight(null);
        }
      }

      async function closeDialog({ complete = false } = {}) {
        if (dialogClosed) {
          return;
        }
        dialogClosed = true;
        clearOnboardingHighlight();
        if (complete) {
          await persistOnboardingComplete();
        }
        dialog.close();
        dialog.remove();
        spotlight.remove();
        removeOnboardingDemoProject();
        await restoreOnboardingGlobalLayout(originalGlobalLayout);
        onboardingTourActive = false;
        await restoreWebAppsAfterOverlay();
        window.removeEventListener("resize", handleSpotlightViewportChange);
        window.removeEventListener("scroll", handleSpotlightViewportChange, true);
        window.removeEventListener("keydown", handleOnboardingKeydown);
      }

      function handleSpotlightViewportChange() {
        updateSpotlight(highlightedTarget?.isConnected ? highlightedTarget : null);
      }

      function handleOnboardingKeydown(event) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog({ complete: !options.force });
        }
      }

      skipButton.addEventListener("click", () => {
        closeDialog({ complete: !options.force });
      });

      previousButton.addEventListener("click", () => {
        currentStep = Math.max(0, currentStep - 1);
        renderStep();
      });

      nextButton.addEventListener("click", () => {
        if (currentStep >= steps.length - 1) {
          closeDialog({ complete: true });
          return;
        }

        currentStep += 1;
        renderStep();
      });

      window.addEventListener("resize", handleSpotlightViewportChange);
      window.addEventListener("scroll", handleSpotlightViewportChange, true);
      window.addEventListener("keydown", handleOnboardingKeydown);

      await renderStep();
      dialog.show();
      nextButton.focus();
    }

    return {
      ensureOnboardingDemoProject,
      isDemoProjectVisible: () => onboardingDemoProjectVisible,
      isTourActive: () => onboardingTourActive,
      openOnboardingTour
    };
  }

  window.BoatyardOnboardingTour = {
    create: createOnboardingTour
  };
})();
