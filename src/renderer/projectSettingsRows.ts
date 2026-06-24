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

type ProjectSettingsRowsOptions = {
  applyFormControl: (control: HTMLElement) => void;
};

export function createProjectSettingsRows({ applyFormControl }: ProjectSettingsRowsOptions) {
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

  function readProjectUrlRows(list: HTMLElement) {
    return [...list.querySelectorAll<HTMLElement>(".project-url-row")]
      .map((row) => ({
        id: row.querySelector<HTMLInputElement>('[name="urlId"]')?.value || "",
        label: row.querySelector<HTMLInputElement>('[name="urlLabel"]')?.value || "",
        url: row.querySelector<HTMLInputElement>('[name="urlValue"]')?.value || ""
      }))
      .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
  }

  function readProjectWebAppHomeTabRows(list: HTMLElement) {
    return [...list.querySelectorAll<HTMLElement>(".project-webapp-home-tab-row")]
      .map((row) => ({
        id: row.querySelector<HTMLInputElement>('[name="homeTabId"]')?.value || "",
        parentWebAppId: row.querySelector<HTMLInputElement>('[name="homeTabParentWebAppId"]')?.value || "",
        parentLabel: row.querySelector<HTMLInputElement>('[name="homeTabParentLabel"]')?.value || "",
        label: row.querySelector<HTMLInputElement>('[name="homeTabLabel"]')?.value || "",
        url: row.querySelector<HTMLInputElement>('[name="homeTabUrl"]')?.value || ""
      }))
      .filter((entry) => entry.id.trim() || entry.label.trim() || entry.url.trim());
  }

  function readProjectWidgetPaneRows(list: HTMLElement) {
    return [...list.querySelectorAll<HTMLElement>(".project-url-row")]
      .map((row) => ({
        id: row.querySelector<HTMLInputElement>('[name="widgetPaneId"]')?.value || "",
        label: row.querySelector<HTMLInputElement>('[name="widgetPaneLabel"]')?.value || ""
      }))
      .filter((entry) => entry.id.trim() || entry.label.trim());
  }

  return Object.freeze({
    createProjectUrlRow,
    createProjectWebAppHomeTabRow,
    createProjectWidgetPaneRow,
    readProjectUrlRows,
    readProjectWebAppHomeTabRows,
    readProjectWidgetPaneRows
  });
}
