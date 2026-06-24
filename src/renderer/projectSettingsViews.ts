"use strict";

(function () {
  type CoreFieldSetOptions = {
    ifUnedited?: boolean;
    markEdited?: boolean;
    source?: string;
  };

  type ProjectUrlEntry = {
    id?: string;
    label?: string;
    url?: string;
  };

  type ProjectWebAppHomeTabEntry = ProjectUrlEntry & {
    parentWebAppId?: string;
    parentLabel?: string;
  };

  type ProjectWidgetPaneEntry = {
    id?: string;
    label?: string;
  };

  type ProjectFormInitialValues = {
    id?: string;
    [key: string]: unknown;
  };

  type PluginFieldSetOptions = {
    ifUnedited?: boolean;
    markEdited?: boolean;
  };

  type ProjectPluginSectionOptions = {
    readCoreProjectFields?: () => Record<string, string>;
    setError?: (message: string) => void;
  };

  const globalScope = window as unknown as ProjectSettingsViewsGlobal;

  function createProjectSettingsViews({
    boatyard,
    getState,
    getSettings,
    getProjectGroups,
    getProjectWidgetPanes,
    getProjectPluginConfig,
    getGlobalPluginConfig,
    getPluginProjectSettingsSections,
    applyFormControl,
    applyFormControls,
    readPluginSettingsFieldValue,
    deriveRepoUrl,
    deriveProjectNameFromPath,
    formatProjectNameFromPath,
    slugify
  }) {
    function createProjectFormView({ title, submitLabel, initialValues, onSubmit, onCancel }) {
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
      nameInput.value = initialValues.name || "";
      nameLabel.append(nameInput);
    
      const slugLabel = document.createElement("label");
      slugLabel.textContent = "Slug";
    
      const slugInput = document.createElement("input");
      slugInput.name = "slug";
      slugInput.type = "text";
      slugInput.autocomplete = "off";
      slugInput.required = true;
      slugInput.value = initialValues.slug || "";
      slugLabel.append(slugInput);
    
      const groupLabel = document.createElement("label");
      groupLabel.textContent = "Group";
    
      const groupInput = document.createElement("input");
      groupInput.name = "group";
      groupInput.type = "text";
      groupInput.autocomplete = "off";
      groupInput.placeholder = "Team, product, or workspace";
      groupInput.value = initialValues.group || "";
    
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
      sourcePathInput.value = initialValues.sourcePath || "";
    
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
          const selectedPath = await boatyard.selectProjectsBasePath(
            sourcePathInput.value || settings.projectsBasePath
          );
          if (selectedPath) {
            setCoreFieldValue("sourcePath", selectedPath, { markEdited: true, source: "browse" });
            await applySourcePathInspection(selectedPath);
          }
        } catch (selectError) {
          error.textContent = selectError.message;
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
      gitUrlInput.value = initialValues.gitUrl || "";
      gitUrlLabel.append(gitUrlInput);
    
      const repoUrlLabel = document.createElement("label");
      repoUrlLabel.textContent = "Repo URL";
    
      const repoUrlInput = document.createElement("input");
      repoUrlInput.name = "repoUrl";
      repoUrlInput.type = "text";
      repoUrlInput.autocomplete = "off";
      repoUrlInput.placeholder = "https://github.com/owner/repo/tree/main/path";
      repoUrlInput.value = initialValues.repoUrl || deriveRepoUrl(initialValues.gitUrl);
      repoUrlLabel.append(repoUrlInput);
    
      const devBranchLabel = document.createElement("label");
      devBranchLabel.textContent = "Dev branch";
    
      const devBranchInput = document.createElement("input");
      devBranchInput.name = "devBranch";
      devBranchInput.type = "text";
      devBranchInput.autocomplete = "off";
      devBranchInput.placeholder = "main";
      devBranchInput.value = initialValues.devBranch || "";
      devBranchLabel.append(devBranchInput);
    
      const coreInputs = {
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
    
      function setCoreFieldValue(key, value, options: CoreFieldSetOptions = {}) {
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
    
      function markCoreFieldEdited(key) {
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
    
      function applySourcePathIdentity(sourcePath) {
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
    
      async function applySourcePathInspection(sourcePath) {
        applySourcePathIdentity(sourcePath);
    
        const inspected = await boatyard.inspectSourcePath(sourcePath);
    
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
      }
    
      function emitProjectFormEvent(eventName, payload) {
        globalScope.BoatyardPluginRegistry?.emit(eventName, {
          ...payload,
          projectId: initialValues.id || "",
          forPlugin: (pluginId) => ({
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
          error.textContent = inspectionError.message;
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
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });
    
      shell.append(form);
      requestAnimationFrame(() => sourcePathInput.focus());
      return shell;
    }
    
    function createProjectUrlRow(entry: ProjectUrlEntry = {}) {
      const row = document.createElement("div");
      row.className = "project-url-row";
    
      const idInput = document.createElement("input");
      idInput.name = "urlId";
      idInput.type = "hidden";
      idInput.value = entry.id || "";
    
      const labelInput = document.createElement("input");
      labelInput.name = "urlLabel";
      labelInput.type = "text";
      labelInput.autocomplete = "off";
      labelInput.placeholder = "Cloudflare";
      labelInput.value = entry.label || "";
      labelInput.setAttribute("aria-label", "URL label");
      applyFormControl(labelInput);
    
      const urlInput = document.createElement("input");
      urlInput.name = "urlValue";
      urlInput.type = "text";
      urlInput.autocomplete = "off";
      urlInput.placeholder = "https://dash.cloudflare.com/...";
      urlInput.value = entry.url || "";
      urlInput.setAttribute("aria-label", "URL");
      applyFormControl(urlInput);
    
      const removeButton = document.createElement("button");
      removeButton.className = "project-url-remove";
      removeButton.type = "button";
      removeButton.title = "Remove URL";
      removeButton.setAttribute("aria-label", "Remove URL");
      removeButton.textContent = "X";
      removeButton.addEventListener("click", () => row.remove());
    
      row.append(idInput, labelInput, urlInput, removeButton);
      return row;
    }
    
    function createProjectWebAppHomeTabRow(entry: ProjectWebAppHomeTabEntry = {}) {
      const row = document.createElement("div");
      row.className = "project-webapp-home-tab-row";
    
      const idInput = document.createElement("input");
      idInput.name = "homeTabId";
      idInput.type = "hidden";
      idInput.value = entry.id || "";
    
      const parentIdInput = document.createElement("input");
      parentIdInput.name = "homeTabParentWebAppId";
      parentIdInput.type = "hidden";
      parentIdInput.value = entry.parentWebAppId || "";
    
      const parentLabelInput = document.createElement("input");
      parentLabelInput.name = "homeTabParentLabel";
      parentLabelInput.type = "hidden";
      parentLabelInput.value = entry.parentLabel || "";
    
      const parentText = document.createElement("div");
      parentText.className = "project-webapp-home-tab-parent";
      parentText.textContent = entry.parentLabel || entry.parentWebAppId || "Webapp";
    
      const labelInput = document.createElement("input");
      labelInput.name = "homeTabLabel";
      labelInput.type = "text";
      labelInput.autocomplete = "off";
      labelInput.placeholder = "Localhost";
      labelInput.value = entry.label || "";
      labelInput.setAttribute("aria-label", "Sub-tab label");
      applyFormControl(labelInput);
    
      const urlInput = document.createElement("input");
      urlInput.name = "homeTabUrl";
      urlInput.type = "text";
      urlInput.autocomplete = "off";
      urlInput.placeholder = "https://example.com/...";
      urlInput.value = entry.url || "";
      urlInput.setAttribute("aria-label", "Sub-tab URL");
      applyFormControl(urlInput);
    
      const removeButton = document.createElement("button");
      removeButton.className = "project-url-remove";
      removeButton.type = "button";
      removeButton.title = "Remove sub-tab";
      removeButton.setAttribute("aria-label", "Remove sub-tab");
      removeButton.textContent = "X";
      removeButton.addEventListener("click", () => row.remove());
    
      row.append(idInput, parentIdInput, parentLabelInput, parentText, labelInput, urlInput, removeButton);
      return row;
    }
    
    function createProjectWidgetPaneRow(entry: ProjectWidgetPaneEntry = {}) {
      const row = document.createElement("div");
      row.className = "project-url-row";
    
      const idInput = document.createElement("input");
      idInput.name = "widgetPaneId";
      idInput.type = "hidden";
      idInput.value = entry.id || "";
    
      const labelInput = document.createElement("input");
      labelInput.name = "widgetPaneLabel";
      labelInput.type = "text";
      labelInput.autocomplete = "off";
      labelInput.placeholder = "Widgets";
      labelInput.value = entry.label || "";
      labelInput.setAttribute("aria-label", "Widget pane name");
      applyFormControl(labelInput);
    
      const spacer = document.createElement("div");
      spacer.className = "project-url-spacer";
    
      const removeButton = document.createElement("button");
      removeButton.className = "project-url-remove";
      removeButton.type = "button";
      removeButton.title = "Remove widget pane";
      removeButton.setAttribute("aria-label", "Remove widget pane");
      removeButton.textContent = "X";
      removeButton.addEventListener("click", () => row.remove());
    
      row.append(idInput, labelInput, spacer, removeButton);
      return row;
    }
    
    function createProjectPluginSettingsControls(
      initialValues: ProjectFormInitialValues = {},
      options: ProjectPluginSectionOptions = {}
    ) {
      const controls = [];
      const sections = [];
    
      for (const section of getPluginProjectSettingsSections()) {
        const projectPluginConfig = initialValues.id
          ? getProjectPluginConfig(initialValues.id, section.pluginId)
          : {};
        const inputs = new Map();
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
          input.value = projectPluginConfig[field.key] || "";
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
    
              options.setError?.("");
              actionButton.disabled = true;
              const originalLabel = actionButton.textContent;
              actionButton.textContent = field.action.pendingLabel || "Working...";
    
              try {
                await field.action.run({
                  project: initialValues,
                  coreFields: options.readCoreProjectFields?.() || {},
                  globalConfig: getGlobalPluginConfig(section.pluginId),
                  fields: createPluginFieldApi(inputs)
                });
              } catch (actionError) {
                options.setError?.(actionError.message);
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
          const values = {};
          for (const section of sections) {
            values[section.pluginId] = {};
            for (const [key, { field, input }] of section.inputs) {
              values[section.pluginId][key] = readPluginSettingsFieldValue(field, input);
            }
          }
    
          return values;
        },
        createFieldApi(pluginId) {
          const section = sections.find((entry) => entry.pluginId === pluginId);
          const inputs = section?.inputs || new Map();
          return createPluginFieldApi(inputs);
        }
      };
    }
    
    function createPluginFieldApi(inputs) {
      return Object.freeze({
        getValue(key) {
          return inputs.get(key)?.input.value || "";
        },
        setValue(key, value, options: PluginFieldSetOptions = {}) {
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
    
    function readProjectUrlRows(list) {
      return [...list.querySelectorAll(".project-url-row")]
        .map((row) => ({
          id: row.querySelector('[name="urlId"]').value,
          label: row.querySelector('[name="urlLabel"]').value,
          url: row.querySelector('[name="urlValue"]').value
        }))
        .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
    }
    
    function readProjectWebAppHomeTabRows(list) {
      return [...list.querySelectorAll(".project-webapp-home-tab-row")]
        .map((row) => ({
          id: row.querySelector('[name="homeTabId"]').value,
          parentWebAppId: row.querySelector('[name="homeTabParentWebAppId"]').value,
          parentLabel: row.querySelector('[name="homeTabParentLabel"]').value,
          label: row.querySelector('[name="homeTabLabel"]').value,
          url: row.querySelector('[name="homeTabUrl"]').value
        }))
        .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
    }
    
    function readProjectWidgetPaneRows(list) {
      return [...list.querySelectorAll(".project-url-row")]
        .map((row) => ({
          id: row.querySelector('[name="widgetPaneId"]').value,
          label: row.querySelector('[name="widgetPaneLabel"]').value
        }))
        .filter((entry) => entry.id.trim() || entry.label.trim());
    }
    
    function createProjectUrlsForm({ project, onSubmit }) {
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
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createProjectWebAppHomeTabsForm({ project, onSubmit }) {
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
        list.append(createProjectWebAppHomeTabRow(entry));
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
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createGlobalUrlsSettingsForm({ onSubmit }) {
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
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createProjectWidgetPanesForm({ project, onSubmit }) {
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
          error.textContent = submitError.message;
          error.hidden = false;
        }
      });
    
      shell.append(form);
      return shell;
    }
    
    function createProjectTerminalSettingsForm({ project, onSubmit }) {
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
      terminalEnvInput.value = project.terminalEnv || "";
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
    
    function createProjectDangerZone({ project, onUnregister }) {
      const shell = document.createElement("section");
      shell.className = "project-form-page danger-zone";
    
      const heading = document.createElement("div");
      heading.className = "form-heading";
    
      const headingTitle = document.createElement("h3");
      headingTitle.textContent = "Danger zone";
    
      const headingCopy = document.createElement("p");
      headingCopy.textContent = "Unregister this project from Boatyard without deleting files on disk.";
      heading.append(headingTitle, headingCopy);
    
      const form = document.createElement("form");
      form.className = "danger-zone-action";
    
      const confirmation = document.createElement("div");
      confirmation.className = "danger-confirmation";
    
      const confirmationCopy = document.createElement("p");
      confirmationCopy.textContent = `Type "${project.name}" to confirm.`;
    
      const label = document.createElement("label");
      label.textContent = "Project name";
    
      const confirmInput = document.createElement("input");
      confirmInput.name = "projectName";
      confirmInput.type = "text";
      confirmInput.autocomplete = "off";
      applyFormControl(confirmInput);
      label.append(confirmInput);
      confirmation.append(confirmationCopy, label);
    
      const error = document.createElement("p");
      error.className = "form-error";
      error.setAttribute("role", "alert");
      error.hidden = true;
    
      const actions = document.createElement("div");
      actions.className = "form-actions";
    
      const unregisterButton = document.createElement("button");
      unregisterButton.className = "danger-button";
      unregisterButton.type = "submit";
      unregisterButton.textContent = "Unregister project";
      unregisterButton.disabled = true;
    
      confirmInput.addEventListener("input", () => {
        unregisterButton.disabled = confirmInput.value !== project.name;
      });
    
      actions.append(unregisterButton);
      form.append(confirmation, error, actions);
      form.addEventListener("submit", async (event) => {
        event.preventDefault();
        error.textContent = "";
        error.hidden = true;
    
        if (confirmInput.value !== project.name) {
          unregisterButton.disabled = true;
          return;
        }
    
        try {
          await onUnregister();
        } catch (unregisterError) {
          error.textContent = unregisterError.message;
          error.hidden = false;
        }
      });
    
      shell.append(heading, form);
      return shell;
    }

    return {
      createGlobalUrlsSettingsForm,
      createProjectDangerZone,
      createProjectFormView,
      createProjectTerminalSettingsForm,
      createProjectUrlsForm,
      createProjectWebAppHomeTabsForm,
      createProjectWidgetPanesForm
    };
  }

  globalScope.BoatyardProjectSettingsViews = {
    create: createProjectSettingsViews
  };
})();
