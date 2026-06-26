import {
  createWebAppMiniLayout,
  findWebAppMiniLayoutPaneNode,
  isWebAppMiniLayoutNode,
  type WebAppMiniLayoutNode,
  type WebAppMiniLayoutPaneNode
} from "./webAppMiniLayout.js";

type WebAppOpenRule = {
  pattern?: string;
  projectId?: string;
  sourcePaneId?: string;
  target?: keyof typeof WEBAPP_OPEN_TARGET_LABELS | string;
  targetLabel?: string;
  scope?: keyof typeof WEBAPP_OPEN_SCOPE_LABELS | string;
  label?: string;
};

type WebAppOpenRuleDialogOptions = {
  getSelectedWebAppIdForPane?: (paneId: string) => string | undefined;
  layout?: WebAppMiniLayoutNode | null;
  onSave?: (rule: WebAppOpenRule) => void | Promise<void>;
  onRemove?: () => void | Promise<void>;
};

type WebAppOpenRulesSettingsOptions = {
  applyFormControl: (control: HTMLElement) => void;
  showOverlayDialog: (dialog: HTMLDialogElement, options?: Record<string, unknown>) => Promise<boolean>;
};

type WebAppOpenRuleListItemHandlers = {
  onEdit: (ruleIndex: number) => void;
  onRemove: (ruleIndex: number) => void | Promise<void>;
};

type WebAppOpenRulesFormOptions = {
  settings: {
    webAppOpenRules?: WebAppOpenRule[];
  };
  title?: string;
  description?: string;
  emptyText?: string;
  getSelectedWebAppIdForPane?: (paneId: string) => string | undefined;
  layout?: WebAppMiniLayoutNode | null;
  onSubmit: (values: { webAppOpenRules: WebAppOpenRule[] }) => void | Promise<void>;
};

const WEBAPP_OPEN_TARGET_LABELS = {
  "same-pane": "Same pane",
  "split-pane": "Split pane",
  external: "External browser"
};

const WEBAPP_OPEN_SCOPE_LABELS = {
  "url-pattern": "URL pattern",
  "source-app": "Source app"
};

function createWebAppOpenRuleSelect(name: string, labelText: string, options: Record<string, string>, selectedValue?: string) {
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

function getOpenTargetLabel(target: WebAppOpenRule["target"]) {
  if (target?.startsWith("pane:")) {
    return "Existing pane";
  }

  return WEBAPP_OPEN_TARGET_LABELS[target as keyof typeof WEBAPP_OPEN_TARGET_LABELS] || target || "";
}

function getOpenScopeLabel(scope: WebAppOpenRule["scope"]) {
  return WEBAPP_OPEN_SCOPE_LABELS[scope as keyof typeof WEBAPP_OPEN_SCOPE_LABELS] || scope || "";
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function getOpenPatternFieldCopy(scope: WebAppOpenRule["scope"]) {
  if (scope === "source-app") {
    return {
      label: "Source app ID",
      placeholder: "repo"
    };
  }

  return {
    label: "URL pattern",
    placeholder: "https://accounts.example.com/*"
  };
}

function getPaneRuleLayoutLabel(
  pane: WebAppMiniLayoutPaneNode,
  index: number,
  sourcePaneId: string,
  targetPaneId: string,
  rule: WebAppOpenRule,
  getSelectedWebAppIdForPane: (paneId: string) => string | undefined = () => undefined
) {
  const isSource = pane.id === sourcePaneId;
  const isTarget = pane.id === targetPaneId;
  const selectedWebAppId = pane.id ? getSelectedWebAppIdForPane(pane.id) : undefined;
  const fallback = String(selectedWebAppId || pane.selectedWebAppId || `Pane ${index + 1}`);
  if (isSource && isTarget) {
    return rule.targetLabel || rule.label || fallback;
  }

  if (isSource) {
    return rule.label || fallback;
  }

  if (isTarget) {
    return rule.targetLabel || fallback;
  }

  return fallback;
}

function findPaneIdBySelectedWebApp(
  node: WebAppMiniLayoutNode | null | undefined,
  webAppId: string,
  getSelectedWebAppIdForPane: (paneId: string) => string | undefined
): string {
  if (!node || !webAppId) {
    return "";
  }

  if (node.type === "pane") {
    const selectedWebAppId = node.id ? getSelectedWebAppIdForPane(node.id) : undefined;
    return (selectedWebAppId || node.selectedWebAppId) === webAppId ? node.id || "" : "";
  }

  return findPaneIdBySelectedWebApp(node.first, webAppId, getSelectedWebAppIdForPane) ||
    findPaneIdBySelectedWebApp(node.second, webAppId, getSelectedWebAppIdForPane);
}

function createWebAppOpenRuleMiniLayout(
  rule: WebAppOpenRule,
  layout: WebAppMiniLayoutNode | null | undefined,
  getSelectedWebAppIdForPane: (paneId: string) => string | undefined = () => undefined
) {
  if (!isWebAppMiniLayoutNode(layout)) {
    return null;
  }

  const sourcePaneId = rule.scope === "source-app"
    ? findPaneIdBySelectedWebApp(layout, String(rule.pattern || ""), getSelectedWebAppIdForPane) || rule.sourcePaneId || ""
    : rule.sourcePaneId || "";
  const targetPaneId = rule.target?.startsWith("pane:") ? rule.target.slice("pane:".length) : "";
  if (!sourcePaneId && !targetPaneId) {
    return null;
  }

  if ((sourcePaneId && !findWebAppMiniLayoutPaneNode(layout, sourcePaneId)) &&
      (targetPaneId && !findWebAppMiniLayoutPaneNode(layout, targetPaneId))) {
    return null;
  }

  const miniLayout = createWebAppMiniLayout({
    layout,
    paneClassName: "webapp-open-rule-mini-pane",
    title: "Pane layout",
    renderPane: (pane, index) => {
      const label = getPaneRuleLayoutLabel(pane, index, sourcePaneId, targetPaneId, rule, getSelectedWebAppIdForPane);
      return {
        classNames: [
          pane.id === sourcePaneId ? "source" : "",
          pane.id === targetPaneId ? "target" : ""
        ],
        label,
        title: label
      };
    }
  });
  miniLayout.classList.add("webapp-open-rule-mini-layout");
  const legend = document.createElement("div");
  legend.className = "webapp-open-rule-mini-legend";
  if (sourcePaneId) {
    const sourceItem = document.createElement("span");
    sourceItem.className = "source";
    sourceItem.textContent = "Source";
    legend.append(sourceItem);
  }
  if (targetPaneId) {
    const targetItem = document.createElement("span");
    targetItem.className = "target";
    targetItem.textContent = "Target";
    legend.append(targetItem);
  }
  if (legend.childElementCount > 0) {
    miniLayout.append(legend);
  }
  return miniLayout;
}

function createWebAppOpenRuleListItem(
  rule: WebAppOpenRule,
  index: number,
  { onEdit, onRemove }: WebAppOpenRuleListItemHandlers
) {
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
  const location = rule.projectId ? " · Project-specific" : "";
  meta.textContent = `${getOpenTargetLabel(rule.target)} · ${getOpenScopeLabel(rule.scope)}${label}${location}`;

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

export function createGlobalWebAppOpenRulesSettings({
  applyFormControl,
  showOverlayDialog
}: WebAppOpenRulesSettingsOptions) {
  function openWebAppOpenRuleSettingsDialog(
    rule: WebAppOpenRule = {},
    { getSelectedWebAppIdForPane, layout, onSave, onRemove }: WebAppOpenRuleDialogOptions = {}
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

    const sourcePaneNameLabel = document.createElement("label");
    sourcePaneNameLabel.className = "field";
    const sourcePaneNameText = document.createElement("span");
    sourcePaneNameText.textContent = "Source app";
    const sourcePaneNameInput = document.createElement("input");
    sourcePaneNameInput.type = "text";
    sourcePaneNameInput.value = rule.label || "Unknown pane";
    sourcePaneNameInput.disabled = true;
    applyFormControl(sourcePaneNameInput);
    sourcePaneNameLabel.append(sourcePaneNameText, sourcePaneNameInput);

    const targetPaneNameLabel = document.createElement("label");
    targetPaneNameLabel.className = "field";
    const targetPaneNameText = document.createElement("span");
    targetPaneNameText.textContent = "Target pane";
    const targetPaneNameInput = document.createElement("input");
    targetPaneNameInput.type = "text";
    targetPaneNameInput.value = rule.targetLabel || "Existing pane";
    targetPaneNameInput.disabled = true;
    applyFormControl(targetPaneNameInput);
    targetPaneNameLabel.append(targetPaneNameText, targetPaneNameInput);

    const targetPaneIdLabel = document.createElement("label");
    targetPaneIdLabel.className = "field";
    const targetPaneIdText = document.createElement("span");
    targetPaneIdText.textContent = "Target pane ID";
    const targetPaneIdInput = document.createElement("input");
    targetPaneIdInput.type = "text";
    targetPaneIdInput.value = rule.target?.startsWith("pane:") ? rule.target.slice("pane:".length) : "";
    targetPaneIdInput.disabled = true;
    applyFormControl(targetPaneIdInput);
    targetPaneIdLabel.append(targetPaneIdText, targetPaneIdInput);

    const miniLayout = createWebAppOpenRuleMiniLayout(rule, layout, getSelectedWebAppIdForPane);

    const patternLabel = document.createElement("label");
    patternLabel.className = "field";
    const patternText = document.createElement("span");
    const patternInput = document.createElement("input");
    patternInput.name = "openRulePattern";
    patternInput.type = "text";
    patternInput.autocomplete = "off";
    patternInput.value = rule.pattern || "";
    applyFormControl(patternInput);
    patternLabel.append(patternText, patternInput);

    const { label: targetLabel, select: targetSelect } = createWebAppOpenRuleSelect(
      "openRuleTarget",
      "Open target",
      WEBAPP_OPEN_TARGET_LABELS,
      rule.target || "same-pane"
    );
    if (rule.target?.startsWith("pane:") && !targetSelect.querySelector(`option[value="${CSS.escape(rule.target)}"]`)) {
      const paneOption = document.createElement("option");
      paneOption.value = rule.target;
      paneOption.textContent = "Existing pane";
      paneOption.selected = true;
      targetSelect.prepend(paneOption);
    }

    const { label: scopeLabel, select: scopeSelect } = createWebAppOpenRuleSelect(
      "openRuleScope",
      "Rule scope",
      WEBAPP_OPEN_SCOPE_LABELS,
      rule.scope || "url-pattern"
    );

    function syncPatternFieldCopy() {
      const isSourceScope = scopeSelect.value === "source-app";
      const isExistingPaneTarget = targetSelect.value.startsWith("pane:");
      const copy = getOpenPatternFieldCopy(scopeSelect.value);
      sourcePaneNameLabel.hidden = !isSourceScope;
      targetPaneNameLabel.hidden = !isExistingPaneTarget;
      targetPaneIdLabel.hidden = !isExistingPaneTarget;
      if (miniLayout) {
        patternLabel.hidden = isSourceScope;
        targetPaneIdLabel.hidden = true;
      } else {
        patternLabel.hidden = false;
      }
      patternText.textContent = copy.label;
      patternInput.placeholder = copy.placeholder;
      patternInput.disabled = isSourceScope;
      labelLabel.hidden = isSourceScope;
      labelInput.disabled = isSourceScope;
    }

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

    scopeSelect.addEventListener("change", syncPatternFieldCopy);
    targetSelect.addEventListener("change", syncPatternFieldCopy);
    syncPatternFieldCopy();

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
      if (!onRemove) {
        return;
      }

      deleteButton.disabled = true;
      try {
        await onRemove();
        dialog.close();
      } catch (removeError) {
        error.textContent = asErrorMessage(removeError);
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
    form.append(
      header,
      ...(miniLayout ? [miniLayout] : []),
      sourcePaneNameLabel,
      patternLabel,
      targetLabel,
      targetPaneNameLabel,
      targetPaneIdLabel,
      scopeLabel,
      labelLabel,
      error,
      actions
    );

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.textContent = "";
      error.hidden = true;
      submitButton.disabled = true;

      const nextRule: WebAppOpenRule = {
        pattern: patternInput.value.trim(),
        target: targetSelect.value,
        scope: scopeSelect.value,
        label: labelInput.value.trim()
      };
      if (rule.projectId) {
        nextRule.projectId = rule.projectId;
      }
      if (rule.sourcePaneId) {
        nextRule.sourcePaneId = rule.sourcePaneId;
      }
      if (rule.targetLabel) {
        nextRule.targetLabel = rule.targetLabel;
      }

      if (!nextRule.pattern) {
        error.textContent = "URL pattern is required.";
        error.hidden = false;
        submitButton.disabled = false;
        return;
      }

      try {
        await onSave?.(nextRule);
        dialog.close();
      } catch (submitError) {
        error.textContent = asErrorMessage(submitError);
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

  function createGlobalWebAppOpenRulesSettingsForm({
    settings,
    title = "Webapp URL opening",
    description = "Manage saved rules created by Open with dialogs.",
    emptyText = "No saved URL opening rules.",
    getSelectedWebAppIdForPane,
    layout = null,
    onSubmit
  }: WebAppOpenRulesFormOptions) {
    const shell = document.createElement("section");
    shell.className = "project-form-page";

    const panel = document.createElement("div");
    panel.className = "project-form";

    const heading = document.createElement("div");
    heading.className = "form-heading";

    const headingTitle = document.createElement("h3");
    headingTitle.textContent = title;

    const headingCopy = document.createElement("p");
    headingCopy.textContent = description;
    heading.append(headingTitle, headingCopy);

    const list = document.createElement("div");
    list.className = "webapp-open-rule-list";
    let rules = [...(settings.webAppOpenRules || [])];

    const error = document.createElement("p");
    error.className = "form-error";
    error.setAttribute("role", "alert");
    error.hidden = true;

    async function saveRules(nextRules: WebAppOpenRule[]) {
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
        empty.textContent = emptyText;
        list.append(empty);
        return;
      }

      rules.forEach((rule, index) => {
        list.append(createWebAppOpenRuleListItem(rule, index, {
          onEdit: (ruleIndex: number) => {
            openWebAppOpenRuleSettingsDialog(rules[ruleIndex], {
              getSelectedWebAppIdForPane,
              layout,
              onSave: (nextRule) => {
                const nextRules = rules.map((currentRule, currentIndex) => (
                  currentIndex === ruleIndex ? nextRule : currentRule
                ));
                return saveRules(nextRules);
              },
              onRemove: () => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
            });
          },
          onRemove: (ruleIndex: number) => saveRules(rules.filter((_, currentIndex) => currentIndex !== ruleIndex))
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

  return Object.freeze({
    createGlobalWebAppOpenRulesSettingsForm
  });
}
