type WebAppOpenRule = {
  pattern?: string;
  target?: keyof typeof WEBAPP_OPEN_TARGET_LABELS | string;
  scope?: keyof typeof WEBAPP_OPEN_SCOPE_LABELS | string;
  label?: string;
};

type WebAppOpenRuleDialogOptions = {
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
  onSubmit: (values: { webAppOpenRules: WebAppOpenRule[] }) => void | Promise<void>;
};

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
  return WEBAPP_OPEN_TARGET_LABELS[target as keyof typeof WEBAPP_OPEN_TARGET_LABELS] || target || "";
}

function getOpenScopeLabel(scope: WebAppOpenRule["scope"]) {
  return WEBAPP_OPEN_SCOPE_LABELS[scope as keyof typeof WEBAPP_OPEN_SCOPE_LABELS] || scope || "";
}

function asErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
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
  meta.textContent = `${getOpenTargetLabel(rule.target)} · ${getOpenScopeLabel(rule.scope)}${label}`;

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

  function createGlobalWebAppOpenRulesSettingsForm({ settings, onSubmit }: WebAppOpenRulesFormOptions) {
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
        empty.textContent = "No saved URL opening rules.";
        list.append(empty);
        return;
      }

      rules.forEach((rule, index) => {
        list.append(createWebAppOpenRuleListItem(rule, index, {
          onEdit: (ruleIndex: number) => {
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
