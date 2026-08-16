import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type McpSkillState =
  | "conflict"
  | "installed"
  | "modified"
  | "notInstalled"
  | "unavailable"
  | "updateAvailable";

type McpSkillTarget = {
  detail: string;
  id: string;
  installPath: string;
  label: string;
  modifiedFiles: string[];
  sourceVersion: string;
  state: McpSkillState;
};

type McpSkillSettingsOptions = {
  boatyard: BoatyardBridge;
};

const STATUS_LABELS: Record<McpSkillState, string> = {
  conflict: "Unmanaged",
  installed: "Installed",
  modified: "Modified",
  notInstalled: "Not installed",
  unavailable: "Unavailable",
  updateAvailable: "Update available"
};

function asErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asTarget(value: unknown): McpSkillTarget | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as UnknownRecord;
  const state = String(source.state || "") as McpSkillState;
  if (!(state in STATUS_LABELS) || !source.id || !source.label || !source.installPath) {
    return null;
  }
  return {
    detail: String(source.detail || ""),
    id: String(source.id),
    installPath: String(source.installPath),
    label: String(source.label),
    modifiedFiles: Array.isArray(source.modifiedFiles) ? source.modifiedFiles.map(String) : [],
    sourceVersion: String(source.sourceVersion || ""),
    state
  };
}

function mutationMessage(value: unknown): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return "Skill installation updated.";
  }
  return String((value as UnknownRecord).message || "Skill installation updated.");
}

export function createMcpSkillSettings({ boatyard }: McpSkillSettingsOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "mcp-skill-settings";

  const heading = document.createElement("div");
  heading.className = "mcp-skill-heading";
  const title = document.createElement("h4");
  title.textContent = "Agent skill";
  const copy = document.createElement("p");
  copy.textContent = "Install guidance for connecting to Boatyard's MCP and working with panes in each agent. Credentials remain separate from the skill.";
  heading.append(title, copy);

  const list = document.createElement("div");
  list.className = "mcp-skill-list";
  list.setAttribute("aria-live", "polite");

  const feedback = document.createElement("p");
  feedback.className = "form-hint";
  feedback.setAttribute("role", "status");
  feedback.hidden = true;

  const error = document.createElement("p");
  error.className = "form-error";
  error.setAttribute("role", "alert");
  error.hidden = true;

  function setPending(pending: boolean): void {
    list.querySelectorAll<HTMLButtonElement>("button").forEach((button) => {
      button.disabled = pending;
    });
  }

  async function runAction(action: "install" | "uninstall", target: McpSkillTarget): Promise<void> {
    error.hidden = true;
    feedback.hidden = true;
    setPending(true);
    try {
      let result: unknown;
      if (action === "install") {
        if (!boatyard.installMcpSkill) {
          throw new Error("MCP skill installation is unavailable.");
        }
        result = await boatyard.installMcpSkill(target.id);
      } else {
        if (!boatyard.uninstallMcpSkill) {
          throw new Error("MCP skill removal is unavailable.");
        }
        const hasLocalChanges = target.state === "modified";
        const changeSummary = target.modifiedFiles.length
          ? `\n\nLocal changes: ${target.modifiedFiles.join(", ")}`
          : "";
        const confirmed = window.confirm(hasLocalChanges
          ? `Uninstall the ${target.label} skill and permanently delete its local changes?${changeSummary}`
          : `Uninstall the Boatyard MCP skill for ${target.label}?`);
        if (!confirmed) {
          return;
        }
        result = await boatyard.uninstallMcpSkill(target.id, hasLocalChanges);
      }
      feedback.textContent = mutationMessage(result);
      feedback.hidden = false;
      await load();
    } catch (actionError) {
      error.textContent = asErrorMessage(actionError);
      error.hidden = false;
    } finally {
      setPending(false);
    }
  }

  function createActionButton(label: string, action: "install" | "uninstall", target: McpSkillTarget) {
    const button = document.createElement("button");
    button.className = action === "uninstall" ? "danger-button" : "secondary-button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      void runAction(action, target);
    });
    return button;
  }

  function render(targets: McpSkillTarget[]): void {
    list.innerHTML = "";
    for (const target of targets) {
      const item = document.createElement("article");
      item.className = "mcp-skill-target";

      const summary = document.createElement("div");
      summary.className = "mcp-skill-target-summary";
      const titleRow = document.createElement("div");
      titleRow.className = "mcp-skill-target-title";
      const targetTitle = document.createElement("h5");
      targetTitle.textContent = target.label;
      const badge = document.createElement("span");
      badge.className = `mcp-skill-status ${target.state}`;
      badge.textContent = STATUS_LABELS[target.state];
      titleRow.append(targetTitle, badge);
      const detail = document.createElement("p");
      detail.textContent = target.detail;
      const installPath = document.createElement("code");
      installPath.className = "mcp-skill-path";
      installPath.textContent = target.installPath;
      installPath.title = target.installPath;
      summary.append(titleRow, detail, installPath);

      const actions = document.createElement("div");
      actions.className = "mcp-skill-target-actions";
      if (target.state === "notInstalled") {
        actions.append(createActionButton("Install", "install", target));
      } else if (target.state === "updateAvailable") {
        actions.append(
          createActionButton("Update", "install", target),
          createActionButton("Uninstall", "uninstall", target)
        );
      } else if (target.state === "installed" || target.state === "modified") {
        actions.append(createActionButton("Uninstall", "uninstall", target));
      }
      item.append(summary, actions);
      list.append(item);
    }
    if (!targets.length) {
      const empty = document.createElement("p");
      empty.className = "settings-empty-state";
      empty.textContent = "No supported agent targets are available.";
      list.append(empty);
    }
  }

  async function load(): Promise<void> {
    if (!boatyard.listMcpSkillTargets) {
      error.textContent = "MCP skill installation is unavailable.";
      error.hidden = false;
      return;
    }
    try {
      const result = await boatyard.listMcpSkillTargets();
      render(Array.isArray(result) ? result.map(asTarget).filter((target): target is McpSkillTarget => Boolean(target)) : []);
    } catch (loadError) {
      error.textContent = asErrorMessage(loadError);
      error.hidden = false;
    }
  }

  section.append(heading, list, feedback, error);
  void load();
  return section;
}
