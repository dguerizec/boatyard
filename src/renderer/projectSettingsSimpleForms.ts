type ProjectSettingsSimpleFormsOptions = {
  applyFormControl: (control: HTMLElement) => void;
  applyFormControls: (root: HTMLElement) => void;
};

type ProjectTerminalSettingsProject = {
  terminalEnv?: string;
};

type ProjectDangerZoneProject = {
  name: string;
};

type ProjectTerminalSettingsFormOptions = {
  project: ProjectTerminalSettingsProject;
  onSubmit: (values: { terminalEnv: string }) => Promise<void> | void;
};

type ProjectDangerZoneOptions = {
  project: ProjectDangerZoneProject;
  onUnregister: () => Promise<void> | void;
};

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function createProjectSettingsSimpleForms({
  applyFormControl,
  applyFormControls
}: ProjectSettingsSimpleFormsOptions) {
  function createProjectTerminalSettingsForm({ project, onSubmit }: ProjectTerminalSettingsFormOptions) {
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
        error.textContent = getErrorMessage(submitError);
        error.hidden = false;
      }
    });

    shell.append(form);
    return shell;
  }

  function createProjectDangerZone({ project, onUnregister }: ProjectDangerZoneOptions) {
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
        error.textContent = getErrorMessage(unregisterError);
        error.hidden = false;
      }
    });

    shell.append(heading, form);
    return shell;
  }

  return Object.freeze({
    createProjectDangerZone,
    createProjectTerminalSettingsForm
  });
}
