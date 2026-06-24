import { createGlobalWebAppOpenRulesSettings } from "./globalWebAppOpenRulesSettings.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

  type PluginFieldApiSetOptions = {
    ifUnedited?: boolean;
    markEdited?: boolean;
  };

  type PluginSettingsOptions = {
    onSaved?: () => void;
  };

  type GlobalSettingsBoatyardBridge = BoatyardBridge & {
    selectProjectsBasePath?: (currentPath?: string) => Promise<string>;
  };

  type GlobalSettingsFormOptions = {
    settings: UnknownRecord;
    onSubmit: (values: UnknownRecord) => void | Promise<void>;
  };

  type GlobalSettingsViewsOptions = {
    boatyard: GlobalSettingsBoatyardBridge;
    applyFormControl: (control: HTMLElement) => void;
    applyFormControls: (container: HTMLElement) => void;
    getInstalledWidgets: () => unknown[];
    getPluginGlobalSettingsSections: () => unknown[];
    getGlobalPluginConfig: (pluginId: string) => UnknownRecord;
    readPluginSettingsFieldValue: (field: PluginGlobalSettingsField, input: HTMLInputElement) => unknown;
    showOverlayDialog: (dialog: HTMLDialogElement, options?: UnknownRecord) => Promise<boolean>;
    renderGlobalSettingsPage: () => void;
    updatePluginEnabled: (pluginId: string, enabled: boolean) => Promise<unknown>;
    updateGlobalPluginConfig: (pluginId: string, values: UnknownRecord) => Promise<unknown>;
  };

  type PluginFieldAction = {
    hidden?: boolean;
    label?: string;
    message?: string;
    pendingLabel?: string;
    run?: (context: { globalConfig: UnknownRecord; fields: PluginFieldApi }) => unknown | Promise<unknown>;
  };

  type PluginGlobalSettingsField = PluginSettingsFieldDefinition & {
    action?: PluginFieldAction;
    description?: string;
    persist?: boolean;
    readOnly?: boolean;
  };

  type PluginFieldState = {
    action: {
      button: HTMLButtonElement;
      element: HTMLDivElement;
      message: HTMLSpanElement;
    } | null;
    field: PluginGlobalSettingsField;
    input: HTMLInputElement;
  };

  type PluginFieldApi = {
    getValue(key: string): string;
    isEdited(key: string): boolean;
    setActionMessage(key: string, message: unknown): boolean;
    setActionVisible(key: string, visible: boolean): boolean;
    setDefaultValue(key: string, value: unknown): boolean;
    setValue(key: string, value: unknown, options?: PluginFieldApiSetOptions): boolean;
  };

  function asErrorMessage(error: unknown) {
    return error instanceof Error ? error.message : String(error);
  }

  function asWidgetDefinition(value: unknown): WidgetDefinition {
    return value as WidgetDefinition;
  }

  function asPluginSettingsSection(value: unknown): PluginSettingsSection {
    return value as PluginSettingsSection;
  }

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
  }: GlobalSettingsViewsOptions) {
    const webAppOpenRulesSettings = createGlobalWebAppOpenRulesSettings({
      applyFormControl,
      showOverlayDialog
    });

    function createGlobalProjectsSettingsForm({ settings, onSubmit }: GlobalSettingsFormOptions) {
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
      projectsBasePathInput.value = String(settings.projectsBasePath || "");

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
          if (typeof boatyard.selectProjectsBasePath !== "function") {
            throw new Error("Project path picker is unavailable.");
          }
          const selectedPath = await boatyard.selectProjectsBasePath(projectsBasePathInput.value);
          if (selectedPath) {
            projectsBasePathInput.value = selectedPath;
          }
        } catch (selectError) {
          error.textContent = asErrorMessage(selectError);
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
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });

      shell.append(form);
      requestAnimationFrame(() => projectsBasePathInput.focus());
      return shell;
    }

    function createGlobalPresentationSettingsForm({ settings, onSubmit }: GlobalSettingsFormOptions) {
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
      blurSwitch.checked = settings.blurWebAppOverlays !== false;

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
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    function createGlobalTerminalSettingsForm({ settings, onSubmit }: GlobalSettingsFormOptions) {
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
      terminalEnvInput.value = String(settings.terminalEnv || "");
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
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    function createGlobalPasswordManagerSettingsForm({ settings, onSubmit }: GlobalSettingsFormOptions) {
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
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });

      shell.append(form);
      return shell;
    }

    function createGlobalWebAppOpenRulesSettingsForm({ settings, onSubmit }: GlobalSettingsFormOptions) {
      return webAppOpenRulesSettings.createGlobalWebAppOpenRulesSettingsForm({ settings, onSubmit });
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

      for (const widget of getInstalledWidgets().map(asWidgetDefinition)) {
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
          .map(asPluginSettingsSection)
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

    function openGlobalPluginSettingsDialog(plugin: PluginListEntry, sections: PluginSettingsSection[]) {
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

    function createGlobalPluginSettingsForm(section: PluginSettingsSection, options: PluginSettingsOptions = {}) {
      const form = document.createElement("form");
      form.className = "plugin-global-settings-form";

      const pluginConfig = getGlobalPluginConfig(section.pluginId);
      const inputs = new Map<string, PluginFieldState>();

      for (const field of section.fields as PluginGlobalSettingsField[]) {
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
        input.value = String(pluginConfig[field.key] || input.dataset.defaultValue);
        label.append(input);
        if (field.description) {
          const description = document.createElement("small");
          description.className = "plugin-settings-field-description";
          description.textContent = field.description;
          label.append(description);
        }
        const fieldState: PluginFieldState = { field, input, action: null };

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
              error.textContent = asErrorMessage(actionError);
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
          const values: UnknownRecord = {};
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
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });

      return form;
    }

    function createPluginFieldApi(inputs: Map<string, PluginFieldState>): PluginFieldApi {
      return Object.freeze({
        getValue(key: string) {
          return inputs.get(key)?.input.value || "";
        },
        setValue(key: string, value: unknown, options: PluginFieldApiSetOptions = {}) {
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
        isEdited(key: string) {
          return inputs.get(key)?.input.dataset.edited === "true";
        },
        setDefaultValue(key: string, value: unknown) {
          const input = inputs.get(key)?.input;
          if (!input) {
            return false;
          }

          const nextValue = String(value || "");
          input.dataset.defaultValue = nextValue;
          input.placeholder = nextValue || inputs.get(key)?.field.placeholder || "";
          return true;
        },
        setActionVisible(key: string, visible: boolean) {
          const action = inputs.get(key)?.action;
          if (!action) {
            return false;
          }

          action.element.hidden = !visible;
          return true;
        },
        setActionMessage(key: string, message: unknown) {
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
