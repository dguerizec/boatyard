type WebAppOpenRule = {
  pattern?: string;
  target?: string;
  scope?: string;
  label?: string;
};

  type WebAppOpenRuleDialogOptions = {
    onSave?: (rule: WebAppOpenRule) => void;
    onRemove?: () => void;
  };

  type PluginFieldApiSetOptions = {
    ifUnedited?: boolean;
    markEdited?: boolean;
  };

  type PluginSettingsOptions = {
    onSaved?: () => void;
  };

const globalScope: GlobalSettingsViewsGlobal = window;

export function createGlobalSettingsViews({
    boatyard,
    applyFormControl,
    applyFormControls,
    getInstalledWidgets,
    getPluginGlobalSettingsSections,
    getGlobalPluginConfig,
    readPluginSettingsFieldValue,
    showOverlayDialog,
    renderGlobalSettingsPage,
    updatePluginEnabled,
    updateGlobalPluginConfig
  }) {
    function createGlobalProjectsSettingsForm({ settings, onSubmit }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";

      const form = document.createElement("form");
      form.className = "project-form";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Projects global settings";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Configure defaults shared by project forms and tooling.";
      heading.append(headingTitle, headingCopy);

      const projectsBasePathLabel = document.createElement("label");
      projectsBasePathLabel.textContent = "Projects base path";

      const projectsBasePathInput = document.createElement("input");
      projectsBasePathInput.name = "projectsBasePath";
      projectsBasePathInput.type = "text";
      projectsBasePathInput.autocomplete = "off";
      projectsBasePathInput.placeholder = "/workspace/projects";
      projectsBasePathInput.value = settings.projectsBasePath;

      const projectsBasePathControl = document.createElement("div");
      projectsBasePathControl.className = "path-picker";

      const browseButton = document.createElement("button");
      browseButton.className = "secondary-button";
      browseButton.type = "button";
      browseButton.textContent = "Browse";
      browseButton.addEventListener("click", async () => {
        error.textContent = "";
        error.hidden = true;

        try {
          const selectedPath = await boatyard.selectProjectsBasePath(projectsBasePathInput.value);
          if (selectedPath) {
            projectsBasePathInput.value = selectedPath;
          }
        } catch (selectError) {
          error.textContent = selectError.message;
          error.hidden = false;
        }
      });

      projectsBasePathControl.append(projectsBasePathInput, browseButton);
      projectsBasePathLabel.append(projectsBasePathControl);

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save projects settings";

      actions.append(submitButton);
      form.append(heading, projectsBasePathLabel, error, actions);
      applyFormControls(form);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;

        try {
          await onSubmit({
            projectsBasePath: projectsBasePathInput.value
          });
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });

      shell.append(form);
      requestAnimationFrame(() => projectsBasePathInput.focus());
      return shell;
    }

    function createGlobalPresentationSettingsForm({ settings, onSubmit }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";

      const form = document.createElement("form");
      form.className = "project-form";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Presentation";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Tune how Boatyard displays webapp overlays.";
      heading.append(headingTitle, headingCopy);

      const blurLabel = document.createElement("label");
      blurLabel.className = "switch-row";

      const blurCopy = document.createElement("span");
      blurCopy.className = "switch-copy";
      blurCopy.innerHTML = "<strong>Blur webapp screenshots</strong><small>Apply blur to frozen WCV screenshots while a menu or overlay is open.</small>";

      const blurSwitch = document.createElement("input");
      blurSwitch.name = "blurWebAppOverlays";
      blurSwitch.type = "checkbox";
      blurSwitch.checked = settings.blurWebAppOverlays;

      const switchTrack = document.createElement("span");
      switchTrack.className = "switch-track";
      switchTrack.setAttribute("aria-hidden", "true");

      blurLabel.append(blurCopy, blurSwitch, switchTrack);

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save presentation";

      actions.append(submitButton);
      form.append(heading, blurLabel, error, actions);
      applyFormControls(form);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;

        try {
          await onSubmit({
            blurWebAppOverlays: blurSwitch.checked
          });
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    function createGlobalTerminalSettingsForm({ settings, onSubmit }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";

      const form = document.createElement("form");
      form.className = "project-form";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Terminal";

      heading.append(headingTitle);

      const terminalEnvLabel = document.createElement("label");
      terminalEnvLabel.textContent = "Environment variables";

      const terminalEnvInput = document.createElement("textarea");
      terminalEnvInput.name = "terminalEnv";
      terminalEnvInput.autocomplete = "off";
      terminalEnvInput.rows = 4;
      terminalEnvInput.placeholder = "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never";
      terminalEnvInput.value = settings.terminalEnv || "";
      terminalEnvLabel.append(terminalEnvInput);

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save terminal";

      actions.append(submitButton);
      form.append(heading, terminalEnvLabel, error, actions);
      applyFormControls(form);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;

        try {
          await onSubmit({
            terminalEnv: terminalEnvInput.value
          });
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    function createGlobalPasswordManagerSettingsForm({ settings, onSubmit }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page password-manager-settings";

      const form = document.createElement("form");
      form.className = "project-form";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Password manager";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Optional local autofill for webapp panes.";
      heading.append(headingTitle, headingCopy);

      const disclaimer = document.createElement("div");
      disclaimer.className = "password-manager-disclaimer";
      disclaimer.innerHTML = `
        <strong>Security disclaimer</strong>
        <span>Boatyard will store passwords locally, encrypted for the current OS user. This is a minimal convenience feature for trusted local use, not a hardened replacement for a dedicated password manager.</span>
      `;

      const enableLabel = document.createElement("label");
      enableLabel.className = "switch-row";

      const enableCopy = document.createElement("span");
      enableCopy.className = "switch-copy";
      enableCopy.innerHTML = "<strong>Enable local password manager</strong><small>Autofill and save credentials for webapp login forms after confirmation.</small>";

      const enableSwitch = document.createElement("input");
      enableSwitch.name = "passwordManagerEnabled";
      enableSwitch.type = "checkbox";
      enableSwitch.checked = settings.passwordManagerEnabled === true;

      const switchTrack = document.createElement("span");
      switchTrack.className = "switch-track";
      switchTrack.setAttribute("aria-hidden", "true");
      enableLabel.append(enableCopy, enableSwitch, switchTrack);

      const acceptLabel = document.createElement("label");
      acceptLabel.className = "checkbox-row";

      const acceptCheckbox = document.createElement("input");
      acceptCheckbox.name = "passwordManagerDisclaimerAccepted";
      acceptCheckbox.type = "checkbox";
      acceptCheckbox.checked = settings.passwordManagerDisclaimerAccepted === true;

      const acceptCopy = document.createElement("span");
      acceptCopy.textContent = "I understand this is a minimal local password manager and accept the risk.";
      acceptLabel.append(acceptCheckbox, acceptCopy);

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save password settings";

      actions.append(submitButton);
      form.append(heading, disclaimer, enableLabel, acceptLabel, error, actions);
      applyFormControls(form);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;

        if (enableSwitch.checked && !acceptCheckbox.checked) {
          error.textContent = "Accept the security disclaimer before enabling the password manager.";
          error.hidden = false;
          return;
        }

        try {
          await onSubmit({
            passwordManagerEnabled: enableSwitch.checked,
            passwordManagerDisclaimerAccepted: acceptCheckbox.checked
          });
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    const WEBAPP_OPEN_TARGET_LABELS = {
      "same-pane": "Same pane",
      "split-pane": "Split pane",
      external: "External browser"
    };

    const WEBAPP_OPEN_SCOPE_LABELS = {
      exact: "Exact URL",
      host: "Host",
      "path-prefix": "Path prefix"
    };

    function createWebAppOpenRuleSelect(name, labelText, options, selectedValue) {
      const label = document.createElement("label");
      label.className = "field";

      const span = document.createElement("span");
      span.textContent = labelText;

      const select = document.createElement("select");
      select.name = name;
      for (const [value, text] of Object.entries(options)) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = String(text);
        option.selected = selectedValue === value;
        select.append(option);
      }

      label.append(span, select);
      return { label, select };
    }

    function createWebAppOpenRuleListItem(rule, index, { onEdit, onRemove }) {
      const item = document.createElement("article");
      item.className = "webapp-open-rule-item";

      const editButton = document.createElement("button");
      editButton.className = "webapp-open-rule-edit";
      editButton.type = "button";
      editButton.addEventListener("click", () => onEdit(index));

      const pattern = document.createElement("code");
      pattern.textContent = rule.pattern || "Untitled rule";

      const meta = document.createElement("span");
      meta.className = "webapp-open-rule-meta";
      const label = rule.label ? ` · ${rule.label}` : "";
      meta.textContent = `${WEBAPP_OPEN_TARGET_LABELS[rule.target] || rule.target} · ${WEBAPP_OPEN_SCOPE_LABELS[rule.scope] || rule.scope}${label}`;

      editButton.append(pattern, meta);

      const removeButton = document.createElement("button");
      removeButton.className = "project-url-remove";
      removeButton.type = "button";
      removeButton.title = "Remove rule";
      removeButton.setAttribute("aria-label", "Remove rule");
      removeButton.textContent = "X";
      removeButton.addEventListener("click", () => onRemove(index));

      item.append(editButton, removeButton);
      return item;
    }

    function openWebAppOpenRuleSettingsDialog(
      rule: WebAppOpenRule = {},
      { onSave, onRemove }: WebAppOpenRuleDialogOptions = {}
    ) {
      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog webapp-open-rule-dialog";

      const form = document.createElement("form");
      form.className = "plugin-settings-dialog-panel";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = rule.pattern ? "Edit URL opening rule" : "Add URL opening rule";

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());
      header.append(title, closeButton);

      const patternLabel = document.createElement("label");
      patternLabel.className = "field";
      const patternText = document.createElement("span");
      patternText.textContent = "URL pattern";
      const patternInput = document.createElement("input");
      patternInput.name = "openRulePattern";
      patternInput.type = "text";
      patternInput.autocomplete = "off";
      patternInput.placeholder = "https://accounts.google.com";
      patternInput.value = rule.pattern || "";
      applyFormControl(patternInput);
      patternLabel.append(patternText, patternInput);

      const { label: targetLabel, select: targetSelect } = createWebAppOpenRuleSelect(
        "openRuleTarget",
        "Open target",
        WEBAPP_OPEN_TARGET_LABELS,
        rule.target || "same-pane"
      );

      const { label: scopeLabel, select: scopeSelect } = createWebAppOpenRuleSelect(
        "openRuleScope",
        "Rule scope",
        WEBAPP_OPEN_SCOPE_LABELS,
        rule.scope || "exact"
      );

      const labelLabel = document.createElement("label");
      labelLabel.className = "field";
      const labelText = document.createElement("span");
      labelText.textContent = "Label";
      const labelInput = document.createElement("input");
      labelInput.name = "openRuleLabel";
      labelInput.type = "text";
      labelInput.autocomplete = "off";
      labelInput.placeholder = "Optional label";
      labelInput.value = rule.label || "";
      applyFormControl(labelInput);
      labelLabel.append(labelText, labelInput);

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const deleteButton = document.createElement("button");
      deleteButton.className = "danger-button";
      deleteButton.type = "button";
      deleteButton.textContent = "Remove";
      deleteButton.hidden = !onRemove;
      deleteButton.addEventListener("click", async () => {
        deleteButton.disabled = true;
        try {
          await onRemove();
          dialog.close();
        } catch (removeError) {
          error.textContent = removeError.message;
          error.hidden = false;
        } finally {
          deleteButton.disabled = false;
        }
      });

      const cancelButton = document.createElement("button");
      cancelButton.className = "secondary-button";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", () => dialog.close());

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save";

      actions.append(deleteButton, cancelButton, submitButton);
      form.append(header, patternLabel, targetLabel, scopeLabel, labelLabel, error, actions);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
        submitButton.disabled = true;

        const nextRule = {
          pattern: patternInput.value.trim(),
          target: targetSelect.value,
          scope: scopeSelect.value,
          label: labelInput.value.trim()
        };

        if (!nextRule.pattern) {
          error.textContent = "URL pattern is required.";
          error.hidden = false;
          submitButton.disabled = false;
          return;
        }

        try {
          await onSave(nextRule);
          dialog.close();
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        } finally {
          submitButton.disabled = false;
        }
      });

      dialog.append(form);
      void showOverlayDialog(dialog, {
        freeze: "overlap",
        removeOnClose: true
      }).then((shown) => {
        if (!shown) {
          return;
        }
        patternInput.focus();
        patternInput.select();
      });
    }

    function createGlobalWebAppOpenRulesSettingsForm({ settings, onSubmit }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";

      const panel = document.createElement("div");
      panel.className = "project-form";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Webapp URL opening";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Manage saved rules created by Open with dialogs.";
      heading.append(headingTitle, headingCopy);

      const list = document.createElement("div");
      list.className = "webapp-open-rule-list";
      let rules = [...(settings.webAppOpenRules || [])];

      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;

      async function saveRules(nextRules) {
        error.textContent = "";
        error.hidden = true;
        await onSubmit({
          webAppOpenRules: nextRules.filter((rule) => rule.pattern?.trim())
        });
      }

      function renderRules() {
        list.innerHTML = "";

        if (rules.length === 0) {
          const empty = document.createElement("p");
          empty.className = "webapp-open-rule-empty";
          empty.textContent = "No saved URL opening rules.";
          list.append(empty);
          return;
        }

        rules.forEach((rule, index) => {
          list.append(createWebAppOpenRuleListItem(rule, index, {
            onEdit: (ruleIndex) => {
              openWebAppOpenRuleSettingsDialog(rules[ruleIndex], {
                onSave: (nextRule) => {
                  const nextRules = rules.map((currentRule, currentIndex) => (
                    currentIndex === ruleIndex ? nextRule : currentRule
                  ));
                  return saveRules(nextRules);
                },
                onRemove: () => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
              });
            },
            onRemove: (ruleIndex) => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
          }));
        });
      }

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const addButton = document.createElement("button");
      addButton.className = "secondary-button";
      addButton.type = "button";
      addButton.textContent = "Add rule";
      addButton.addEventListener("click", () => {
        openWebAppOpenRuleSettingsDialog({}, {
          onSave: (nextRule) => saveRules([...rules, nextRule])
        });
      });

      actions.append(addButton);
      panel.append(heading, list, error, actions);
      renderRules();

      shell.append(panel);
      return shell;
    }

    function createGlobalWidgetsSettingsView() {
      const shell = document.createElement("section");
      shell.className = "project-form-page widgets-settings-page";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Widgets";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Installed widget plugins available to Boatyard.";
      heading.append(headingTitle, headingCopy);

      const list = document.createElement("div");
      list.className = "installed-widget-list";

      for (const widget of getInstalledWidgets()) {
        const item = document.createElement("article");
        item.className = "installed-widget-item";

        const titleRow = document.createElement("div");
        titleRow.className = "installed-widget-title";

        const title = document.createElement("h4");
        title.textContent = widget.name;

        const status = document.createElement("span");
        status.className = `widget-status ${widget.status}`;
        status.textContent = widget.status;

        titleRow.append(title, status);

        const description = document.createElement("p");
        description.textContent = widget.description || "No description provided.";

        const meta = document.createElement("div");
        meta.className = "installed-widget-meta";

        for (const value of [...widget.scopes, widget.category, widget.provider]) {
          const chip = document.createElement("span");
          chip.textContent = value;
          meta.append(chip);
        }

        item.append(titleRow, description, meta);
        list.append(item);
      }

      shell.append(heading, list);
      return shell;
    }

    function createGlobalPluginsSettingsView() {
      const shell = document.createElement("section");
      shell.className = "project-form-page plugins-settings-page";

      const heading = document.createElement("div");
      heading.className = "form-heading";

      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Plugins";

      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Installed plugins and their Boatyard contributions.";
      heading.append(headingTitle, headingCopy);

      const list = document.createElement("div");
      list.className = "installed-plugin-list";

      for (const plugin of globalScope.BoatyardPluginRegistry?.list() || []) {
        const status = globalScope.BoatyardPluginRegistry.getStatus(plugin.id);
        const globalSettingsSections = getPluginGlobalSettingsSections()
          .filter((section) => section.pluginId === plugin.id);
        const item = document.createElement("article");
        item.className = "installed-plugin-item";

        const titleRow = document.createElement("div");
        titleRow.className = "installed-widget-title";

        const title = document.createElement("h4");
        title.textContent = plugin.name;

        const statusBadge = document.createElement("span");
        statusBadge.className = `plugin-status ${status?.state || "unknown"}`;
        statusBadge.textContent = status?.state || "unknown";

        titleRow.append(title, statusBadge);

        const description = document.createElement("p");
        description.textContent = status?.summary || plugin.description || "No plugin status provided.";

        const meta = document.createElement("div");
        meta.className = "installed-widget-meta";

        const contributionCounts = [
          ["widgets", plugin.contributes?.widgets?.length || 0],
          ["panes", plugin.contributes?.panes?.length || 0],
          ["global settings", plugin.contributes?.globalSettings?.length || globalSettingsSections.length],
          ["project settings", plugin.contributes?.projectSettings?.length || 0],
          ["services", plugin.contributes?.services?.length || 0],
          ["tools", plugin.contributes?.tools?.length || 0]
        ];

        for (const value of [plugin.id, `v${plugin.version}`, ...contributionCounts.map(([label, count]) => `${count} ${label}`)]) {
          const chip = document.createElement("span");
          chip.textContent = value;
          meta.append(chip);
        }

        const controls = document.createElement("label");
        controls.className = "plugin-toggle-row";

        const controlCopy = document.createElement("span");
        controlCopy.textContent = plugin.enabled ? "Enabled" : "Disabled";

        const toggle = document.createElement("input");
        toggle.type = "checkbox";
        toggle.checked = plugin.enabled !== false;
        toggle.addEventListener("change", async () => {
          await updatePluginEnabled(plugin.id, toggle.checked);
          renderGlobalSettingsPage();
        });

        const switchTrack = document.createElement("span");
        switchTrack.className = "switch-track";
        switchTrack.setAttribute("aria-hidden", "true");

        controls.append(controlCopy, toggle, switchTrack);

        const settingsButton = document.createElement("button");
        settingsButton.className = "plugin-settings-button";
        settingsButton.type = "button";
        settingsButton.title = `${plugin.name} settings`;
        settingsButton.setAttribute("aria-label", `${plugin.name} settings`);
        settingsButton.textContent = "⚙";
        settingsButton.hidden = !globalSettingsSections.length;
        settingsButton.addEventListener("click", () => {
          openGlobalPluginSettingsDialog(plugin, globalSettingsSections);
        });

        const reloadButton = document.createElement("button");
        reloadButton.className = "plugin-reload-button";
        reloadButton.type = "button";
        reloadButton.textContent = "Reload";
        reloadButton.disabled = plugin.enabled === false;
        reloadButton.addEventListener("click", () => {
          try {
            globalScope.BoatyardPluginRegistry.reload(plugin.id);
          } catch (error) {
            console.error(`Could not reload plugin ${plugin.id}:`, error);
          }
          renderGlobalSettingsPage();
        });

        const titleActions = document.createElement("div");
        titleActions.className = "installed-plugin-actions";
        titleActions.append(settingsButton, reloadButton, controls);

        titleRow.append(titleActions);
        item.append(titleRow, description, meta);

        list.append(item);
      }

      if (!list.children.length) {
        const empty = document.createElement("p");
        empty.className = "settings-empty-state";
        empty.textContent = "No plugins installed.";
        list.append(empty);
      }

      shell.append(heading, list);
      return shell;
    }

    function openGlobalPluginSettingsDialog(plugin, sections) {
      const dialog = document.createElement("dialog");
      dialog.className = "plugin-settings-dialog";

      const panel = document.createElement("div");
      panel.className = "plugin-settings-dialog-panel";

      const header = document.createElement("header");
      header.className = "plugin-settings-dialog-header";

      const title = document.createElement("h3");
      title.textContent = `${plugin.name} settings`;

      const closeButton = document.createElement("button");
      closeButton.className = "icon-button";
      closeButton.type = "button";
      closeButton.title = "Close";
      closeButton.setAttribute("aria-label", "Close");
      closeButton.textContent = "X";
      closeButton.addEventListener("click", () => dialog.close());

      header.append(title, closeButton);
      panel.append(header);

      for (const section of sections) {
        panel.append(createGlobalPluginSettingsForm(section, {
          onSaved() {
            dialog.close();
            renderGlobalSettingsPage();
          }
        }));
      }

      dialog.append(panel);
      void showOverlayDialog(dialog, {
        freeze: "overlap",
        removeOnClose: true
      });
    }

    function createGlobalPluginSettingsForm(section, options: PluginSettingsOptions = {}) {
      const form = document.createElement("form");
      form.className = "plugin-global-settings-form";

      const pluginConfig = getGlobalPluginConfig(section.pluginId);
      const inputs = new Map();

      for (const field of section.fields) {
        const label = document.createElement("label");
        label.textContent = field.label;

        const input = document.createElement("input");
        input.name = field.key;
        input.type = field.type || "text";
        input.autocomplete = "off";
        input.placeholder = field.placeholder || "";
        input.readOnly = field.readOnly === true;
        const defaultValue = globalScope.BoatyardPluginSettingsFields.resolveFieldDefault(field);
        input.dataset.defaultValue = String(defaultValue || "");
        input.value = pluginConfig[field.key] || input.dataset.defaultValue;
        label.append(input);
        if (field.description) {
          const description = document.createElement("small");
          description.className = "plugin-settings-field-description";
          description.textContent = field.description;
          label.append(description);
        }
        const fieldState = { field, input, action: null };

        if (field.action) {
          const action = document.createElement("div");
          action.className = "field-action";
          action.hidden = field.action.hidden !== false;

          const actionMessage = document.createElement("span");
          actionMessage.textContent = field.action.message || "";

          const actionButton = document.createElement("button");
          actionButton.className = "secondary-button";
          actionButton.type = "button";
          actionButton.textContent = field.action.label || "Run";
          actionButton.addEventListener("click", async () => {
            if (typeof field.action.run !== "function") {
              return;
            }

            error.hidden = true;
            error.textContent = "";
            actionButton.disabled = true;
            const originalLabel = actionButton.textContent;
            actionButton.textContent = field.action.pendingLabel || "Working...";

            try {
              await field.action.run({
                globalConfig: pluginConfig,
                fields: createPluginFieldApi(inputs)
              });
            } catch (actionError) {
              error.textContent = actionError.message;
              error.hidden = false;
            } finally {
              actionButton.disabled = false;
              actionButton.textContent = originalLabel;
            }
          });

          action.append(actionMessage, actionButton);
          label.append(action);
          fieldState.action = { element: action, message: actionMessage, button: actionButton };
        }

        inputs.set(field.key, fieldState);
        form.append(label);
      }

      const error = document.createElement("p");
      error.className = "form-error";
      error.hidden = true;

      const actions = document.createElement("div");
      actions.className = "form-actions";

      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save";

      actions.append(submitButton);
      form.append(error, actions);
      applyFormControls(form);

      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.hidden = true;
        error.textContent = "";

        try {
          const values = {};
          for (const [key, { field, input }] of inputs) {
            if (field.persist === false) {
              continue;
            }

            values[key] = readPluginSettingsFieldValue(field, input);
          }

          await updateGlobalPluginConfig(section.pluginId, values);
          if (typeof options.onSaved === "function") {
            options.onSaved();
          } else {
            renderGlobalSettingsPage();
          }
        } catch (submitError) {
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });

      return form;
    }

    function createPluginFieldApi(inputs) {
      return Object.freeze({
        getValue(key) {
          return inputs.get(key)?.input.value || "";
        },
        setValue(key, value, options: PluginFieldApiSetOptions = {}) {
          const input = inputs.get(key)?.input;
          if (!input) {
            return false;
          }

          if (options.ifUnedited && input.dataset.edited) {
            return false;
          }

          input.value = String(value || "");
          if (options.markEdited) {
            input.dataset.edited = "true";
          }
          return true;
        },
        isEdited(key) {
          return inputs.get(key)?.input.dataset.edited === "true";
        },
        setDefaultValue(key, value) {
          const input = inputs.get(key)?.input;
          if (!input) {
            return false;
          }

          const nextValue = String(value || "");
          input.dataset.defaultValue = nextValue;
          input.placeholder = nextValue || inputs.get(key)?.field.placeholder || "";
          return true;
        },
        setActionVisible(key, visible) {
          const action = inputs.get(key)?.action;
          if (!action) {
            return false;
          }

          action.element.hidden = !visible;
          return true;
        },
        setActionMessage(key, message) {
          const action = inputs.get(key)?.action;
          if (!action) {
            return false;
          }

          action.message.textContent = String(message || "");
          return true;
        }
      });
    }

    return {
      createGlobalPasswordManagerSettingsForm,
      createGlobalPluginsSettingsView,
      createGlobalPresentationSettingsForm,
      createGlobalProjectsSettingsForm,
      createGlobalTerminalSettingsForm,
      createGlobalWebAppOpenRulesSettingsForm,
      createGlobalWidgetsSettingsView
    };
}
