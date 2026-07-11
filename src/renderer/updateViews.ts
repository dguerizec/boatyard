type UpdateViewsRestartResult = {
  pathConfigured?: boolean;
};

  type UpdateViewsPreparedUpdate = {
    currentVersion?: string;
    latestVersion?: string;
    prepared?: boolean;
    updateAvailable?: boolean;
  };

  type UpdateViewsInfo = {
    currentVersion?: string;
    preparedUpdate?: UpdateViewsPreparedUpdate | null;
    install?: {
      supported?: boolean;
      pathConfigured?: boolean;
    };
  };

  type UpdateViewsChangelogFeature = {
    title: string;
    body: string;
    version?: string;
  };

  type UpdateViewsChangelogRelease = {
    version: string;
    date: string;
    features: UpdateViewsChangelogFeature[];
  };

  type UpdateViewsChangelog = {
    currentVersion?: string;
    toVersion?: string;
    features?: UpdateViewsChangelogFeature[];
    releases?: Partial<UpdateViewsChangelogRelease>[];
  };

  type UpdateViewsBoatyardBridge = {
    getUpdateInfo?: () => Promise<UpdateViewsInfo>;
    prepareUpdate?: () => Promise<UpdateViewsPreparedUpdate>;
    restartToUpdate: (update: UpdateViewsPreparedUpdate) => Promise<UpdateViewsRestartResult>;
    getPendingChangelog?: () => Promise<UpdateViewsChangelog>;
    getChangelogHistory?: () => Promise<UpdateViewsChangelog>;
    dismissChangelog?: () => Promise<unknown>;
  };

  type UpdateViewsOverlayOptions = {
    freeze?: string;
    freezeMargin?: number;
  };

  type UpdateViewsOptions = {
    boatyard: UpdateViewsBoatyardBridge;
    createToolIcon: (name: string) => Node;
    onSidebarUpdateNoticeChange?: (visible: boolean) => void;
    showOverlayDialog: (dialog: HTMLDialogElement, options?: UpdateViewsOverlayOptions) => unknown;
    sidebarUpdateNotice: HTMLElement;
    updatePollIntervalMs: number;
  };

  type UpdateViewsChangelogDialogOptions = {
    mode?: "history";
  };

  type UpdateViewsCardUpdater = (result: UpdateViewsPreparedUpdate | null, checkedAt?: Date) => void;

  function getErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

export function createUpdateViews({
    boatyard,
    createToolIcon,
    onSidebarUpdateNoticeChange,
    showOverlayDialog,
    sidebarUpdateNotice,
    updatePollIntervalMs
  }: UpdateViewsOptions) {
    let preparedUpdate: UpdateViewsPreparedUpdate | null = null;
    let activeUpdateCardUpdater: UpdateViewsCardUpdater | null = null;
    let lastUpdateCheckResult: UpdateViewsPreparedUpdate | null = null;
    let lastUpdateCheckedAt: Date | null = null;
    let updatePollStarted = false;

    function formatVersionLabel(version?: string) {
      const normalized = String(version || "").trim();
      return normalized ? `v${normalized.replace(/^v/i, "")}` : "Unknown";
    }

    function formatUpdateCheckedAt(date = new Date()) {
      return date.toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit"
      });
    }

    function renderSidebarUpdateNotice() {
      sidebarUpdateNotice.innerHTML = "";

      if (!preparedUpdate) {
        sidebarUpdateNotice.hidden = true;
        onSidebarUpdateNoticeChange?.(false);
        return false;
      }

      sidebarUpdateNotice.hidden = false;
      onSidebarUpdateNoticeChange?.(true);

      const title = document.createElement("h2");
      title.textContent = "Update available";

      const version = document.createElement("p");
      version.textContent = `${formatVersionLabel(preparedUpdate.latestVersion)} is ready to install.`;

      const status = document.createElement("p");
      status.className = "sidebar-update-status";
      status.setAttribute("role", "status");
      status.textContent = lastUpdateCheckedAt
        ? `Downloaded at ${formatUpdateCheckedAt(lastUpdateCheckedAt)}`
        : "Downloaded and ready.";

      const restartButton = document.createElement("button");
      restartButton.className = "primary-button";
      restartButton.type = "button";
      restartButton.textContent = "Restart to upgrade";
      restartButton.addEventListener("click", async () => {
        if (!preparedUpdate) {
          return;
        }

        restartButton.disabled = true;
        restartButton.textContent = "Restarting...";
        status.textContent = "Installing and restarting...";

        try {
          const result = await boatyard.restartToUpdate(preparedUpdate);
          status.textContent = result.pathConfigured === false
            ? "Installed. Add the link directory to PATH; relaunching now..."
            : "Installed. Relaunching now...";
        } catch (error) {
          status.textContent = getErrorMessage(error);
          restartButton.disabled = false;
          restartButton.textContent = "Restart to upgrade";
        }
      });

      sidebarUpdateNotice.append(title, version, status, restartButton);
      return true;
    }

    function createGlobalUpdateCard() {
      const shell = document.createElement("section");
      shell.className = "project-form-page app-update-card";

      const content = document.createElement("div");
      content.className = "app-update-content";

      const titleGroup = document.createElement("div");
      titleGroup.className = "app-update-title";

      const title = document.createElement("h3");
      title.textContent = "Boatyard";

      const version = document.createElement("p");
      version.textContent = "Version";

      titleGroup.append(title, version);

      const status = document.createElement("p");
      status.className = "app-update-status";
      status.setAttribute("role", "status");
      status.textContent = "Ready";

      const actions = document.createElement("div");
      actions.className = "app-update-actions";

      const checkButton = document.createElement("button");
      checkButton.className = "secondary-button";
      checkButton.type = "button";
      checkButton.textContent = "Check for updates";

      const changelogButton = document.createElement("button");
      changelogButton.className = "secondary-button";
      changelogButton.type = "button";
      changelogButton.textContent = "Changelog";

      const updateButton = document.createElement("button");
      updateButton.className = "primary-button";
      updateButton.type = "button";
      updateButton.textContent = "Restart to update";
      updateButton.hidden = true;

      actions.append(checkButton, changelogButton, updateButton);
      content.append(titleGroup, status, actions);
      shell.append(content);

      const setBusy = (isBusy: boolean, label = "Checking...") => {
        checkButton.disabled = isBusy;
        changelogButton.disabled = isBusy;
        updateButton.disabled = isBusy;
        checkButton.textContent = isBusy ? label : "Check for updates";
      };

      const showPreparedUpdate = (update: UpdateViewsPreparedUpdate, checkedAt = new Date()) => {
        preparedUpdate = update;
        status.textContent = `${formatVersionLabel(update.latestVersion)} downloaded, restart required. Checked at ${formatUpdateCheckedAt(checkedAt)}`;
        updateButton.hidden = false;
        renderSidebarUpdateNotice();
      };

      const showUpdateResult = (result: UpdateViewsPreparedUpdate | null, checkedAt = new Date()) => {
        if (!result) {
          return;
        }

        version.textContent = `Current version ${formatVersionLabel(result.currentVersion)}`;

        if (result.updateAvailable) {
          if (result.prepared) {
            showPreparedUpdate(result, checkedAt);
          } else {
            preparedUpdate = null;
            updateButton.hidden = true;
            status.textContent = `Update available: ${formatVersionLabel(result.latestVersion)}, no installable AppImage found. Checked at ${formatUpdateCheckedAt(checkedAt)}`;
            renderSidebarUpdateNotice();
          }
        } else {
          preparedUpdate = null;
          updateButton.hidden = true;
          status.textContent = `Up to date. Checked at ${formatUpdateCheckedAt(checkedAt)}`;
          renderSidebarUpdateNotice();
        }
      };
      activeUpdateCardUpdater = showUpdateResult;

      boatyard.getUpdateInfo?.()
        .then((info) => {
          if (!info) {
            return;
          }
          version.textContent = `Current version ${formatVersionLabel(info.currentVersion)}`;
          if (info.preparedUpdate) {
            showPreparedUpdate(info.preparedUpdate, lastUpdateCheckedAt || new Date());
            return;
          }

          if (lastUpdateCheckResult) {
            showUpdateResult(lastUpdateCheckResult, lastUpdateCheckedAt || new Date());
            return;
          }

          if (info.install?.supported && info.install.pathConfigured === false) {
            status.textContent = "Install link directory is not in PATH";
          }
        })
        .catch((error) => {
          version.textContent = "Current version unavailable";
          status.textContent = getErrorMessage(error);
        });

      checkButton.addEventListener("click", async () => {
        setBusy(true, "Downloading...");
        status.textContent = "Checking and downloading updates...";
        updateButton.hidden = true;

        try {
          const result = await boatyard.prepareUpdate?.();
          if (!result) {
            throw new Error("Update preparation is unavailable.");
          }
          lastUpdateCheckedAt = new Date();
          lastUpdateCheckResult = result;
          showUpdateResult(result, lastUpdateCheckedAt);
        } catch (error) {
          status.textContent = getErrorMessage(error);
        } finally {
          setBusy(false);
        }
      });

      changelogButton.addEventListener("click", async () => {
        changelogButton.disabled = true;
        try {
          const changelog = await boatyard.getChangelogHistory?.();
          const opened = await openChangelogDialog(changelog, { mode: "history" });
          if (!opened) {
            status.textContent = "No changelog entries are available yet.";
          }
        } catch (error) {
          status.textContent = getErrorMessage(error);
        } finally {
          changelogButton.disabled = false;
        }
      });

      updateButton.addEventListener("click", async () => {
        if (!preparedUpdate) {
          return;
        }

        setBusy(true, "Restarting...");
        status.textContent = "Restarting to update...";

        try {
          const result = await boatyard.restartToUpdate(preparedUpdate);
          status.textContent = result.pathConfigured === false
            ? "Installed. Add the link directory to PATH; relaunching now..."
            : "Installed. Relaunching now...";
        } catch (error) {
          status.textContent = getErrorMessage(error);
          setBusy(false);
        }
      });

      return shell;
    }

    function getChangelogReleases(changelog?: UpdateViewsChangelog) {
      const releases = Array.isArray(changelog?.releases) ? changelog.releases : [];
      return releases
        .map((release) => ({
          version: String(release?.version || "").trim(),
          date: String(release?.date || "").trim(),
          features: Array.isArray(release?.features) ? release.features : []
        }))
        .filter((release) => release.version && release.features.length);
    }

    async function openChangelogDialog(changelog?: UpdateViewsChangelog, options: UpdateViewsChangelogDialogOptions = {}) {
      const historyMode = options.mode === "history";
      const releases = historyMode ? getChangelogReleases(changelog) : [];
      const features = historyMode
        ? releases[0]?.features.map((feature) => ({ ...feature, version: releases[0].version })) || []
        : Array.isArray(changelog?.features) ? changelog.features : [];

      if (!features.length) {
        return false;
      }

      const dialog = document.createElement("dialog");
      dialog.className = "changelog-dialog";
      dialog.setAttribute("aria-label", "Boatyard changelog");

      const panel = document.createElement("div");
      panel.className = "changelog-panel";

      const header = document.createElement("div");
      header.className = "changelog-header";

      const kicker = document.createElement("p");
      kicker.className = "kicker";
      kicker.textContent = historyMode
        ? `Current version ${formatVersionLabel(changelog?.currentVersion)}`
        : `Updated to ${formatVersionLabel(changelog?.toVersion)}`;

      const title = document.createElement("h3");
      title.textContent = historyMode ? "Changelog" : "What's new";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close changelog";
      closeButton.setAttribute("aria-label", "Close changelog");
      closeButton.append(createToolIcon("close"));

      const titleGroup = document.createElement("div");
      titleGroup.append(kicker, title);
      header.append(titleGroup, closeButton);

      const versionSelect = document.createElement("select");
      versionSelect.className = "changelog-version-select";
      versionSelect.setAttribute("aria-label", "Changelog version");

      if (historyMode) {
        for (const release of releases) {
          const option = document.createElement("option");
          option.value = release.version;
          option.textContent = release.date
            ? `${formatVersionLabel(release.version)} - ${release.date}`
            : formatVersionLabel(release.version);
          versionSelect.append(option);
        }
      }

      const featureVersion = document.createElement("p");
      featureVersion.className = "changelog-version";

      const featureTitle = document.createElement("h4");
      featureTitle.className = "changelog-feature-title";

      const featureBody = document.createElement("p");
      featureBody.className = "changelog-feature-body";

      const actions = document.createElement("div");
      actions.className = "changelog-actions";

      const skipButton = document.createElement("button");
      skipButton.className = "secondary-button";
      skipButton.type = "button";
      skipButton.textContent = historyMode ? "Close" : "Skip";

      const previousButton = document.createElement("button");
      previousButton.className = "secondary-button";
      previousButton.type = "button";
      previousButton.textContent = "Back";

      const counter = document.createElement("span");
      counter.className = "changelog-counter";

      const nextButton = document.createElement("button");
      nextButton.className = "primary-button";
      nextButton.type = "button";

      actions.append(skipButton, previousButton, counter, nextButton);
      if (historyMode) {
        panel.append(header, versionSelect, featureVersion, featureTitle, featureBody, actions);
      } else {
        panel.append(header, featureVersion, featureTitle, featureBody, actions);
      }
      dialog.append(panel);

      let currentFeature = 0;
      let currentFeatures = features;
      let currentReleaseVersion = historyMode ? releases[0]?.version || "" : "";
      let closed = false;

      async function closeDialog() {
        if (closed) {
          return;
        }
        closed = true;
        if (!historyMode) {
          try {
            await boatyard.dismissChangelog?.();
          } catch (error) {
            console.error("Could not dismiss changelog:", error);
          }
        }
        dialog.close();
        dialog.remove();
        window.removeEventListener("keydown", handleKeydown);
      }

      function renderFeature() {
        const feature = currentFeatures[currentFeature];
        featureVersion.textContent = `${formatVersionLabel(feature.version || currentReleaseVersion)} feature`;
        featureTitle.textContent = feature.title;
        featureBody.textContent = feature.body;
        previousButton.disabled = currentFeature === 0;
        counter.textContent = `${currentFeature + 1} / ${currentFeatures.length}`;
        nextButton.textContent = currentFeature === currentFeatures.length - 1 ? "Close" : "Next";
      }

      function selectRelease(version: string) {
        const release = releases.find((entry) => entry.version === version) || releases[0];
        if (!release) {
          return;
        }
        currentReleaseVersion = release.version;
        currentFeatures = release.features.map((feature) => ({ ...feature, version: release.version }));
        currentFeature = 0;
        renderFeature();
      }

      function handleKeydown(event: KeyboardEvent) {
        if (event.key === "Escape") {
          event.preventDefault();
          closeDialog();
        }
      }

      closeButton.addEventListener("click", closeDialog);
      skipButton.addEventListener("click", closeDialog);
      dialog.addEventListener("cancel", (event) => {
        event.preventDefault();
        closeDialog();
      });
      previousButton.addEventListener("click", () => {
        currentFeature = Math.max(0, currentFeature - 1);
        renderFeature();
      });
      nextButton.addEventListener("click", () => {
        if (currentFeature >= currentFeatures.length - 1) {
          closeDialog();
          return;
        }
        currentFeature += 1;
        renderFeature();
      });
      versionSelect.addEventListener("change", () => {
        selectRelease(versionSelect.value);
      });

      renderFeature();
      window.addEventListener("keydown", handleKeydown);
      const shown = await showOverlayDialog(dialog, {
        freeze: "overlap",
        freezeMargin: 16
      });
      if (!shown) {
        window.removeEventListener("keydown", handleKeydown);
        return false;
      }
      nextButton.focus();
      return true;
    }

    async function maybeOpenPendingChangelog() {
      if (typeof boatyard.getPendingChangelog !== "function") {
        return false;
      }

      try {
        const changelog = await boatyard.getPendingChangelog();
        return await openChangelogDialog(changelog);
      } catch (error) {
        console.error("Could not open changelog:", error);
        return false;
      }
    }

    async function pollForUpdates() {
      if (typeof boatyard.prepareUpdate !== "function") {
        return;
      }

      try {
        const result = await boatyard.prepareUpdate();
        lastUpdateCheckedAt = new Date();
        lastUpdateCheckResult = result;
        preparedUpdate = result?.prepared ? result : null;
        renderSidebarUpdateNotice();
        activeUpdateCardUpdater?.(result, lastUpdateCheckedAt);
      } catch (error) {
        console.warn(`Could not prepare update: ${getErrorMessage(error)}`);
      }
    }

    function startUpdatePolling() {
      if (updatePollStarted) {
        return;
      }

      updatePollStarted = true;
      void pollForUpdates();
      setInterval(pollForUpdates, updatePollIntervalMs);
    }

    async function loadPreparedUpdateNotice() {
      if (typeof boatyard.getUpdateInfo !== "function") {
        return;
      }

      try {
        const info = await boatyard.getUpdateInfo();
        if (info.preparedUpdate) {
          preparedUpdate = info.preparedUpdate;
          renderSidebarUpdateNotice();
        }
      } catch (error) {
        console.warn(`Could not load prepared update info: ${getErrorMessage(error)}`);
      }
    }

    return {
      createGlobalUpdateCard,
      loadPreparedUpdateNotice,
      maybeOpenPendingChangelog,
      openChangelogDialog,
      renderSidebarUpdateNotice,
      resetActiveUpdateCardUpdater() {
        activeUpdateCardUpdater = null;
      },
      startUpdatePolling
    };
}
