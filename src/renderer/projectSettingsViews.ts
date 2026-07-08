import { createProjectSettingsRows } from "./projectSettingsRows.js";
import { createProjectSettingsSimpleForms } from "./projectSettingsSimpleForms.js";
import { createGlobalWebAppOpenRulesSettings } from "./globalWebAppOpenRulesSettings.js";
import type { UnknownRecord } from "./rendererRecords.js";
import type {
  CoreFieldSetOptions,
  CoreProjectFieldKey,
  CoreProjectInputs,
  GlobalUrlsFormOptions,
  PluginFieldApi,
  PluginFieldSetOptions,
  ProjectFormInitialValues,
  ProjectFormOptions,
  ProjectPluginControlsSection,
  ProjectPluginFieldState,
  ProjectPluginSectionOptions,
  ProjectScopedFormOptions,
  ProjectSettingsViewsOptions
} from "./projectSettingsViewTypes.js";
import {
  asErrorMessage,
  asProjectPluginSection
} from "./projectSettingsViewTypes.js";

const globalScope: ProjectSettingsViewsGlobal = window;

export function createProjectSettingsViews({
    boatyard,
    getState,
    getSettings,
    getProjectGroups,
    getProjectPaneLayout,
    getProjectWidgetPanes,
    getSelectedWebAppForPane,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getPluginProjectSettingsSections,
    applyFormControl,
    applyFormControls,
    showOverlayDialog,
    readPluginSettingsFieldValue,
    deriveRepoUrl,
    deriveProjectNameFromPath,
    formatProjectNameFromPath,
    slugify
  }: ProjectSettingsViewsOptions) {
    const {
      createProjectUrlRow,
      createProjectWebAppHomeTabRow,
      createProjectWidgetPaneRow,
      readProjectUrlRows,
      readProjectWebAppHomeTabRows,
      readProjectWidgetPaneRows
    } = createProjectSettingsRows({ applyFormControl });
    const {
      createProjectDangerZone,
      createProjectTerminalSettingsForm
    } = createProjectSettingsSimpleForms({ applyFormControl, applyFormControls });
    const webAppOpenRulesSettings = createGlobalWebAppOpenRulesSettings({
      applyFormControl,
      showOverlayDialog
    });

    function createProjectFormView({
      title,
      submitLabel,
      initialValues = {},
      onSubmit,
      onCancel
    }: ProjectFormOptions) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";
    
      const form = document.createElement("form");
      form.className = "project-form";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = title;
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Configure the project identity, source checkout, and linked tools.";
    
      heading.append(headingTitle, headingCopy);
    
      const nameLabel = document.createElement("label");
      nameLabel.textContent = "Name";
    
      const nameInput = document.createElement("input");
      nameInput.name = "name";
      nameInput.type = "text";
      nameInput.autocomplete = "off";
      nameInput.required = true;
      nameInput.value = String(initialValues.name || "");
      nameLabel.append(nameInput);
    
      const slugLabel = document.createElement("label");
      slugLabel.textContent = "Slug";
    
      const slugInput = document.createElement("input");
      slugInput.name = "slug";
      slugInput.type = "text";
      slugInput.autocomplete = "off";
      slugInput.required = true;
      slugInput.value = String(initialValues.slug || "");
      slugLabel.append(slugInput);
    
      const groupLabel = document.createElement("label");
      groupLabel.textContent = "Group";
    
      const groupInput = document.createElement("input");
      groupInput.name = "group";
      groupInput.type = "text";
      groupInput.autocomplete = "off";
      groupInput.placeholder = "Team, product, or workspace";
      groupInput.value = String(initialValues.group || "");
    
      const groupOptions = document.createElement("datalist");
      groupOptions.id = `project-group-options-${initialValues.id || "new"}`;
      for (const groupName of getProjectGroups()) {
        const option = document.createElement("option");
        option.value = groupName;
        groupOptions.append(option);
      }
      groupInput.setAttribute("list", groupOptions.id);
      groupLabel.append(groupInput, groupOptions);
    
      const sourcePathLabel = document.createElement("label");
      sourcePathLabel.textContent = "Source path";
    
      const sourcePathInput = document.createElement("input");
      sourcePathInput.name = "sourcePath";
      sourcePathInput.type = "text";
      sourcePathInput.autocomplete = "off";
      sourcePathInput.required = true;
      sourcePathInput.placeholder = "/workspace/projects/example";
      sourcePathInput.value = String(initialValues.sourcePath || "");
    
      const sourcePathControl = document.createElement("div");
      sourcePathControl.className = "path-picker";
    
      const sourcePathBrowseButton = document.createElement("button");
      sourcePathBrowseButton.className = "secondary-button";
      sourcePathBrowseButton.type = "button";
      sourcePathBrowseButton.textContent = "Browse";
      sourcePathBrowseButton.addEventListener("click", async () => {
        error.textContent = "";
        error.hidden = true;
    
        try {
          const settings = getSettings();
          if (typeof boatyard.selectProjectsBasePath !== "function") {
            throw new Error("Project path picker is unavailable.");
          }
          const selectedPath = await boatyard.selectProjectsBasePath(
            sourcePathInput.value || String(settings.projectsBasePath || "")
          );
          if (selectedPath) {
            setCoreFieldValue("sourcePath", selectedPath, { markEdited: true, source: "browse" });
            await applySourcePathInspection(selectedPath);
          }
        } catch (selectError) {
          error.textContent = asErrorMessage(selectError);
          error.hidden = false;
        }
      });
    
      sourcePathControl.append(sourcePathInput, sourcePathBrowseButton);
      sourcePathLabel.append(sourcePathControl);
    
      const gitUrlLabel = document.createElement("label");
      gitUrlLabel.textContent = "Git URL";
    
      const gitUrlInput = document.createElement("input");
      gitUrlInput.name = "gitUrl";
      gitUrlInput.type = "text";
      gitUrlInput.autocomplete = "off";
      gitUrlInput.placeholder = "git@github.com:owner/repo.git";
      gitUrlInput.value = String(initialValues.gitUrl || "");

      const gitUrlControl = document.createElement("div");
      gitUrlControl.className = "path-picker";

      const gitUrlRefreshButton = document.createElement("button");
      gitUrlRefreshButton.className = "secondary-button";
      gitUrlRefreshButton.type = "button";
      gitUrlRefreshButton.textContent = "Refresh";
      gitUrlRefreshButton.title = "Re-detect the git remote from the source path";
      gitUrlRefreshButton.addEventListener("click", async () => {
        error.textContent = "";
        error.hidden = true;

        const sourcePath = sourcePathInput.value.trim();
        if (!sourcePath) {
          error.textContent = "Set the source path before detecting the git remote.";
          error.hidden = false;
          return;
        }

        gitUrlRefreshButton.disabled = true;
        try {
          const detected = await applySourcePathInspection(sourcePath);
          if (!detected) {
            error.textContent = `No git remote found at ${sourcePath}.`;
            error.hidden = false;
          }
        } catch (inspectionError) {
          error.textContent = asErrorMessage(inspectionError);
          error.hidden = false;
        } finally {
          gitUrlRefreshButton.disabled = false;
        }
      });

      gitUrlControl.append(gitUrlInput, gitUrlRefreshButton);
      gitUrlLabel.append(gitUrlControl);
    
      const repoUrlLabel = document.createElement("label");
      repoUrlLabel.textContent = "Repo URL";
    
      const repoUrlInput = document.createElement("input");
      repoUrlInput.name = "repoUrl";
      repoUrlInput.type = "text";
      repoUrlInput.autocomplete = "off";
      repoUrlInput.placeholder = "https://github.com/owner/repo/tree/main/path";
      repoUrlInput.value = String(initialValues.repoUrl || deriveRepoUrl(initialValues.gitUrl));
      repoUrlLabel.append(repoUrlInput);
    
      const devBranchLabel = document.createElement("label");
      devBranchLabel.textContent = "Dev branch";
    
      const devBranchInput = document.createElement("input");
      devBranchInput.name = "devBranch";
      devBranchInput.type = "text";
      devBranchInput.autocomplete = "off";
      devBranchInput.placeholder = "main";
      devBranchInput.value = String(initialValues.devBranch || "");
      devBranchLabel.append(devBranchInput);
    
      const coreInputs: CoreProjectInputs = {
        name: nameInput,
        slug: slugInput,
        group: groupInput,
        sourcePath: sourcePathInput,
        gitUrl: gitUrlInput,
        repoUrl: repoUrlInput,
        devBranch: devBranchInput
      };
    
      function readCoreProjectFields() {
        return Object.fromEntries(
          Object.entries(coreInputs).map(([key, input]) => [key, input.value])
        );
      }
    
      function setCoreFieldValue(key: CoreProjectFieldKey, value: unknown, options: CoreFieldSetOptions = {}) {
        const input = coreInputs[key];
        if (!input) {
          return false;
        }
    
        if (options.ifUnedited && input.dataset.edited) {
          return false;
        }
    
        const nextValue = String(value || "");
        if (input.value === nextValue) {
          return false;
        }
    
        input.value = nextValue;
        if (options.markEdited) {
          input.dataset.edited = "true";
        }
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: key,
          value: nextValue,
          source: options.source || "core"
        });
        return true;
      }
    
      function markCoreFieldEdited(key: CoreProjectFieldKey) {
        const input = coreInputs[key];
        if (input) {
          input.dataset.edited = "true";
        }
      }
    
      nameInput.addEventListener("input", () => {
        markCoreFieldEdited("name");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "name",
          value: nameInput.value,
          source: "user"
        });
    
        if (!slugInput.dataset.edited) {
          const nextSlug = slugify(nameInput.value);
          setCoreFieldValue("slug", nextSlug, { source: "derived" });
        }
      });
    
      slugInput.addEventListener("input", () => {
        markCoreFieldEdited("slug");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "slug",
          value: slugInput.value,
          source: "user"
        });
    
      });
    
      groupInput.addEventListener("input", () => {
        markCoreFieldEdited("group");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "group",
          value: groupInput.value,
          source: "user"
        });
      });
    
      gitUrlInput.addEventListener("input", () => {
        markCoreFieldEdited("gitUrl");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "gitUrl",
          value: gitUrlInput.value,
          source: "user"
        });
    
        if (!repoUrlInput.dataset.edited) {
          setCoreFieldValue("repoUrl", deriveRepoUrl(gitUrlInput.value), { ifUnedited: true, source: "derived" });
        }
      });
    
      repoUrlInput.addEventListener("input", () => {
        markCoreFieldEdited("repoUrl");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "repoUrl",
          value: repoUrlInput.value,
          source: "user"
        });
      });
    
      sourcePathInput.addEventListener("input", () => {
        markCoreFieldEdited("sourcePath");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "sourcePath",
          value: sourcePathInput.value,
          source: "user"
        });
      });
    
      devBranchInput.addEventListener("input", () => {
        markCoreFieldEdited("devBranch");
        emitProjectFormEvent("boatyard.projectForm.coreFieldChanged", {
          field: "devBranch",
          value: devBranchInput.value,
          source: "user"
        });
      });
    
      function applySourcePathIdentity(sourcePath: string) {
        const projectName = formatProjectNameFromPath(sourcePath);
        const projectSlug = slugify(deriveProjectNameFromPath(sourcePath));
    
        if (!projectName) {
          return;
        }
    
        if (!nameInput.value.trim()) {
          setCoreFieldValue("name", projectName, { source: "sourcePath" });
        }
    
        if (!slugInput.value.trim()) {
          setCoreFieldValue("slug", projectSlug || slugify(nameInput.value), { source: "sourcePath" });
        }
    
      }
    
      async function applySourcePathInspection(sourcePath: string) {
        applySourcePathIdentity(sourcePath);

        const inspected = typeof boatyard.inspectSourcePath === "function"
          ? await boatyard.inspectSourcePath(sourcePath)
          : {};

        if (inspected?.gitUrl) {
          setCoreFieldValue("gitUrl", inspected.gitUrl, { source: "inspection" });
        }

        if (inspected?.repoUrl) {
          setCoreFieldValue("repoUrl", inspected.repoUrl, { source: "inspection" });
        } else if (inspected?.gitUrl && !repoUrlInput.dataset.edited) {
          setCoreFieldValue("repoUrl", deriveRepoUrl(inspected.gitUrl), { ifUnedited: true, source: "inspection" });
        }

        emitProjectFormEvent("boatyard.projectForm.sourcePathInspected", {
          sourcePath,
          inspected
        });

        return Boolean(inspected?.gitUrl || inspected?.repoUrl);
      }
    
      function emitProjectFormEvent(eventName: string, payload: UnknownRecord) {
        globalScope.BoatyardPluginRegistry?.emit(eventName, {
          ...payload,
          projectId: initialValues.id || "",
          forPlugin: (pluginId: string) => ({
            coreFields: readCoreProjectFields(),
            globalConfig: getGlobalPluginConfig(pluginId),
            fields: pluginSettings.createFieldApi(pluginId)
          })
        });
      }
    
      sourcePathInput.addEventListener("change", async () => {
        const sourcePath = sourcePathInput.value;
        if (!sourcePath.trim()) {
          return;
        }
    
        error.textContent = "";
        error.hidden = true;
    
        try {
          await applySourcePathInspection(sourcePath);
        } catch (inspectionError) {
          error.textContent = asErrorMessage(inspectionError);
          error.hidden = false;
        }
      });
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const pluginSettings = createProjectPluginSettingsControls(initialValues, {
        readCoreProjectFields,
        setError(message) {
          error.textContent = message || "";
          error.hidden = !message;
        }
      });
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const cancelButton = document.createElement("button");
      cancelButton.className = "secondary-button";
      cancelButton.type = "button";
      cancelButton.textContent = "Cancel";
      cancelButton.addEventListener("click", onCancel);
    
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = submitLabel;
    
      actions.append(cancelButton, submitButton);
      form.append(
        heading,
        sourcePathLabel,
        nameLabel,
        slugLabel,
        groupLabel,
        gitUrlLabel,
        repoUrlLabel,
        devBranchLabel,
        ...pluginSettings.controls,
        error,
        actions
      );
      applyFormControls(form);
    
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        try {
          await onSubmit({
            name: nameInput.value,
            slug: slugInput.value,
            group: groupInput.value,
            sourcePath: sourcePathInput.value,
            gitUrl: gitUrlInput.value,
            repoUrl: repoUrlInput.value,
            devBranch: devBranchInput.value,
            pluginConfig: pluginSettings.readValues()
          });
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });
    
      shell.append(form);
      requestAnimationFrame(() => sourcePathInput.focus());
      return shell;
    }
    
    function createProjectPluginSettingsControls(
      initialValues: ProjectFormInitialValues = {},
      options: ProjectPluginSectionOptions = {}
    ) {
      const controls: HTMLElement[] = [];
      const sections: ProjectPluginControlsSection[] = [];
    
      for (const section of getPluginProjectSettingsSections().map(asProjectPluginSection)) {
        const projectPluginConfig = initialValues.id
          ? getProjectPluginConfig(initialValues.id, section.pluginId)
          : {};
        const inputs = new Map<string, ProjectPluginFieldState>();
        const wrapper = document.createElement("div");
        wrapper.className = "plugin-project-settings-section";
    
        const heading = document.createElement("div");
        heading.className = "form-heading";
    
        const title = document.createElement("h3");
        title.textContent = section.title;
        heading.append(title);
        wrapper.append(heading);
    
        for (const field of section.fields) {
          const label = document.createElement("label");
          label.textContent = field.label;
    
          const input = document.createElement("input");
          input.name = field.key;
          input.type = field.type || "text";
          input.autocomplete = "off";
          const defaultValue = globalScope.BoatyardPluginSettingsFields.resolveFieldDefault(field, {
            project: initialValues,
            coreFields: options.readCoreProjectFields?.() || {}
          });
          input.dataset.defaultValue = String(defaultValue || "");
          input.placeholder = input.dataset.defaultValue || field.placeholder || "";
          input.value = String(projectPluginConfig[field.key] || "");
          input.addEventListener("input", () => {
            input.dataset.edited = "true";
          });
          label.append(input);
          if (field.description) {
            const description = document.createElement("small");
            description.className = "plugin-settings-field-description";
            description.textContent = field.description;
            label.append(description);
          }
          const fieldState: ProjectPluginFieldState = { field, input, action: null };
    
          if (field.action) {
            const fieldAction = field.action;
            const action = document.createElement("div");
            action.className = "field-action";
            action.hidden = fieldAction.hidden !== false;
    
            const actionMessage = document.createElement("span");
            actionMessage.textContent = fieldAction.message || "";
    
            const actionButton = document.createElement("button");
            actionButton.className = "secondary-button";
            actionButton.type = "button";
            actionButton.textContent = fieldAction.label || "Run";
            actionButton.addEventListener("click", async () => {
              if (typeof fieldAction.run !== "function") {
                return;
              }
    
              options.setError?.("");
              actionButton.disabled = true;
              const originalLabel = actionButton.textContent;
              actionButton.textContent = fieldAction.pendingLabel || "Working...";
    
              try {
                await fieldAction.run({
                  project: initialValues,
                  coreFields: options.readCoreProjectFields?.() || {},
                  globalConfig: getGlobalPluginConfig(section.pluginId),
                  fields: createPluginFieldApi(inputs)
                });
              } catch (actionError) {
                options.setError?.(asErrorMessage(actionError));
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
          wrapper.append(label);
        }
    
        sections.push({ pluginId: section.pluginId, inputs });
        controls.push(wrapper);
      }
    
      return {
        controls,
        readValues() {
          const values: UnknownRecord = {};
          for (const section of sections) {
            values[section.pluginId] = {};
            for (const [key, { field, input }] of section.inputs) {
              (values[section.pluginId] as UnknownRecord)[key] = readPluginSettingsFieldValue(field, input);
            }
          }
    
          return values;
        },
        createFieldApi(pluginId: string) {
          const section = sections.find((entry) => entry.pluginId === pluginId);
          const inputs = section?.inputs || new Map();
          return createPluginFieldApi(inputs);
        }
      };
    }
    
    function createPluginFieldApi(inputs: Map<string, ProjectPluginFieldState>): PluginFieldApi {
      return Object.freeze({
        getValue(key: string) {
          return inputs.get(key)?.input.value || "";
        },
        setValue(key: string, value: unknown, options: PluginFieldSetOptions = {}) {
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
    
    function createProjectUrlsForm({ project, onSubmit }: ProjectScopedFormOptions) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";
    
      const form = document.createElement("form");
      form.className = "project-form";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Project URLs";
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Add provider and operations URLs that should appear as webapp tabs.";
      heading.append(headingTitle, headingCopy);
    
      const list = document.createElement("div");
      list.className = "project-url-list";
    
      for (const entry of project.urls || []) {
        list.append(createProjectUrlRow(entry));
      }
    
      if (list.children.length === 0) {
        list.append(createProjectUrlRow());
      }
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const addButton = document.createElement("button");
      addButton.className = "secondary-button";
      addButton.type = "button";
      addButton.textContent = "Add URL";
      addButton.addEventListener("click", () => list.append(createProjectUrlRow()));
    
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save URLs";
    
      actions.append(addButton, submitButton);
      form.append(heading, list, error, actions);
      applyFormControls(form);
    
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        try {
          await onSubmit(readProjectUrlRows(list));
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createProjectWebAppHomeTabsForm({ project, onSubmit }: ProjectScopedFormOptions) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";
    
      const form = document.createElement("form");
      form.className = "project-form";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Webapp home tabs";
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Edit project-wide sub-tabs created from webapp Home menus.";
      heading.append(headingTitle, headingCopy);
    
      const list = document.createElement("div");
      list.className = "project-webapp-home-tab-list";
    
      for (const entry of project.webAppHomeTabs || []) {
        list.append(createProjectWebAppHomeTabRow(entry as UnknownRecord));
      }
    
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No saved webapp home tabs.";
      empty.hidden = list.children.length > 0;
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save home tabs";
    
      actions.append(submitButton);
      form.append(heading, list, empty, error, actions);
      applyFormControls(form);
    
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        try {
          await onSubmit(readProjectWebAppHomeTabRows(list));
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createGlobalUrlsSettingsForm({ onSubmit }: GlobalUrlsFormOptions) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";
    
      const form = document.createElement("form");
      form.className = "project-form";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Global URLs";
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Add infrastructure and operations dashboards that should appear as Global webapp panes.";
      heading.append(headingTitle, headingCopy);
    
      const list = document.createElement("div");
      list.className = "project-url-list";
    
      for (const entry of getState().globalUrls || []) {
        list.append(createProjectUrlRow(entry));
      }
    
      if (list.children.length === 0) {
        list.append(createProjectUrlRow());
      }
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const addButton = document.createElement("button");
      addButton.className = "secondary-button";
      addButton.type = "button";
      addButton.textContent = "Add URL";
      addButton.addEventListener("click", () => list.append(createProjectUrlRow()));
    
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save global URLs";
    
      actions.append(addButton, submitButton);
      form.append(heading, list, error, actions);
      applyFormControls(form);
    
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        try {
          await onSubmit(readProjectUrlRows(list));
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createProjectWidgetPanesForm({ project, onSubmit }: ProjectScopedFormOptions) {
      const shell = document.createElement("section");
      shell.className = "project-form-page";
    
      const form = document.createElement("form");
      form.className = "project-form";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Widget panes";
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Add named widget panes that should appear as pane tabs.";
      heading.append(headingTitle, headingCopy);
    
      const list = document.createElement("div");
      list.className = "project-url-list";
    
      for (const entry of getProjectWidgetPanes(project)) {
        list.append(createProjectWidgetPaneRow(entry));
      }
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const addButton = document.createElement("button");
      addButton.className = "secondary-button";
      addButton.type = "button";
      addButton.textContent = "Add widget pane";
      addButton.addEventListener("click", () => list.append(createProjectWidgetPaneRow()));
    
      const submitButton = document.createElement("button");
      submitButton.className = "primary-button";
      submitButton.type = "submit";
      submitButton.textContent = "Save widget panes";
    
      actions.append(addButton, submitButton);
      form.append(heading, list, error, actions);
      applyFormControls(form);
    
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        try {
          await onSubmit(readProjectWidgetPaneRows(list));
        } catch (submitError) {
          error.textContent = asErrorMessage(submitError);
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }

    function createProjectWebAppOpenRulesForm({ project, onSubmit }: ProjectScopedFormOptions) {
      return webAppOpenRulesSettings.createGlobalWebAppOpenRulesSettingsForm({
        settings: {
          webAppOpenRules: project.webAppOpenRules as UnknownRecord[] | undefined
        },
        getSelectedWebAppIdForPane: getSelectedWebAppForPane,
        layout: getProjectPaneLayout(project) as never,
        title: "Project URL opening",
        description: "Manage saved URL opening rules for this project.",
        emptyText: "No project URL opening rules.",
        onSubmit: async (values) => {
          await onSubmit(values.webAppOpenRules as UnknownRecord[]);
        }
      });
    }
    
    return {
      createGlobalUrlsSettingsForm,
      createProjectDangerZone,
      createProjectFormView,
      createProjectTerminalSettingsForm,
      createProjectUrlsForm,
      createProjectWebAppHomeTabsForm,
      createProjectWebAppOpenRulesForm,
      createProjectWidgetPanesForm
    };
}
