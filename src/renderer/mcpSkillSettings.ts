import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

type IntegrationState =
  | "conflict"
  | "installed"
  | "modified"
  | "notInstalled"
  | "unavailable"
  | "updateAvailable";

type IntegrationResource = {
  detail: string;
  managedToken?: boolean;
  path: string;
  state: IntegrationState;
};

type AgentIntegrationTarget = {
  connection: IntegrationResource;
  id: string;
  label: string;
  skill: IntegrationResource & { modifiedFiles: string[] };
};

type McpSkillSettingsOptions = {
  boatyard: BoatyardBridge;
};

const STATUS_LABELS: Record<IntegrationState, string> = {
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

function asState(value: unknown): IntegrationState | null {
  const state = String(value || "") as IntegrationState;
  return state in STATUS_LABELS ? state : null;
}

function asSkillTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as UnknownRecord;
  const state = asState(source.state);
  if (!state || !source.id || !source.label || !source.installPath) {
    return null;
  }
  return {
    detail: String(source.detail || ""),
    id: String(source.id),
    label: String(source.label),
    modifiedFiles: Array.isArray(source.modifiedFiles) ? source.modifiedFiles.map(String) : [],
    path: String(source.installPath),
    state
  };
}

function asConnectionTarget(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as UnknownRecord;
  const state = asState(source.state);
  if (!state || !source.id || !source.label || !source.configPath) {
    return null;
  }
  return {
    detail: String(source.detail || ""),
    id: String(source.id),
    label: String(source.label),
    managedToken: source.managedToken === true,
    path: String(source.configPath),
    state
  };
}

function mutationMessage(value: unknown, fallback: string): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return fallback;
  }
  return String((value as UnknownRecord).message || fallback);
}

function isInstallable(state: IntegrationState): boolean {
  return state === "notInstalled" || state === "updateAvailable";
}

function isInstalled(state: IntegrationState): boolean {
  return state === "installed" || state === "updateAvailable";
}

export function createMcpSkillSettings({ boatyard }: McpSkillSettingsOptions): HTMLElement {
  const section = document.createElement("section");
  section.className = "mcp-skill-settings";

  const heading = document.createElement("div");
  heading.className = "mcp-skill-heading";
  const title = document.createElement("h4");
  title.textContent = "Agent integrations";
  const copy = document.createElement("p");
  copy.textContent = "Install pane-control guidance and an authenticated MCP connection. Each agent receives a separate token that Boatyard revokes on uninstall.";
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

  async function run(operation: () => Promise<string>): Promise<void> {
    error.hidden = true;
    feedback.hidden = true;
    setPending(true);
    try {
      const message = await operation();
      feedback.textContent = message;
      feedback.hidden = !message;
      if (message) {
        await load();
      }
    } catch (actionError) {
      error.textContent = asErrorMessage(actionError);
      error.hidden = false;
    } finally {
      setPending(false);
    }
  }

  async function mutateSkill(action: "install" | "uninstall", target: AgentIntegrationTarget): Promise<string> {
    if (action === "install") {
      if (!boatyard.installMcpSkill) {
        throw new Error("MCP skill installation is unavailable.");
      }
      return mutationMessage(await boatyard.installMcpSkill(target.id), "Skill installation updated.");
    }
    if (!boatyard.uninstallMcpSkill) {
      throw new Error("MCP skill removal is unavailable.");
    }
    const hasLocalChanges = target.skill.state === "modified";
    const changeSummary = target.skill.modifiedFiles.length
      ? `\n\nLocal changes: ${target.skill.modifiedFiles.join(", ")}`
      : "";
    const confirmed = window.confirm(hasLocalChanges
      ? `Uninstall the ${target.label} skill and permanently delete its local changes?${changeSummary}`
      : `Uninstall the Boatyard MCP skill for ${target.label}?`);
    if (!confirmed) {
      return "";
    }
    return mutationMessage(
      await boatyard.uninstallMcpSkill(target.id, hasLocalChanges),
      "Skill installation removed."
    );
  }

  async function mutateConnection(action: "install" | "uninstall", target: AgentIntegrationTarget): Promise<string> {
    if (action === "install") {
      if (!boatyard.installMcpAgentConnection) {
        throw new Error("MCP connection installation is unavailable.");
      }
      return mutationMessage(
        await boatyard.installMcpAgentConnection(target.id),
        "MCP connection updated."
      );
    }
    if (!boatyard.uninstallMcpAgentConnection) {
      throw new Error("MCP connection removal is unavailable.");
    }
    const hasLocalChanges = target.connection.state === "modified";
    const confirmed = window.confirm(hasLocalChanges
      ? `Remove the ${target.label} MCP entry despite its local changes and revoke its managed token?`
      : `Uninstall the Boatyard MCP connection for ${target.label} and revoke its token?`);
    if (!confirmed) {
      return "";
    }
    return mutationMessage(
      await boatyard.uninstallMcpAgentConnection(target.id, hasLocalChanges),
      "MCP connection removed."
    );
  }

  function createActionButton(label: string, destructive: boolean, action: () => Promise<string>) {
    const button = document.createElement("button");
    button.className = destructive ? "danger-button" : "secondary-button";
    button.type = "button";
    button.textContent = label;
    button.addEventListener("click", () => {
      void run(action);
    });
    return button;
  }

  function createResourceRow(
    label: string,
    resource: IntegrationResource,
    actions: HTMLButtonElement[]
  ): HTMLElement {
    const row = document.createElement("div");
    row.className = "mcp-integration-resource";
    const summary = document.createElement("div");
    summary.className = "mcp-skill-target-summary";
    const titleRow = document.createElement("div");
    titleRow.className = "mcp-integration-resource-title";
    const resourceTitle = document.createElement("strong");
    resourceTitle.textContent = label;
    const badge = document.createElement("span");
    badge.className = `mcp-skill-status ${resource.state}`;
    badge.textContent = STATUS_LABELS[resource.state];
    titleRow.append(resourceTitle, badge);
    const detail = document.createElement("p");
    detail.textContent = resource.detail;
    const path = document.createElement("code");
    path.className = "mcp-skill-path";
    path.textContent = resource.path;
    path.title = resource.path;
    summary.append(titleRow, detail, path);
    const actionList = document.createElement("div");
    actionList.className = "mcp-skill-target-actions";
    actionList.append(...actions);
    row.append(summary, actionList);
    return row;
  }

  function render(targets: AgentIntegrationTarget[]): void {
    list.innerHTML = "";
    for (const target of targets) {
      const item = document.createElement("article");
      item.className = "mcp-skill-target";

      const titleRow = document.createElement("div");
      titleRow.className = "mcp-skill-target-title";
      const targetTitle = document.createElement("h5");
      targetTitle.textContent = target.label;
      titleRow.append(targetTitle);

      const combinedActions = document.createElement("div");
      combinedActions.className = "mcp-skill-target-actions";
      const canInstallBoth = [target.skill.state, target.connection.state].every((state) => (
        state === "installed" || isInstallable(state)
      )) && [target.skill.state, target.connection.state].some(isInstallable);
      const canUninstallBoth = isInstalled(target.skill.state) && isInstalled(target.connection.state);
      if (canInstallBoth) {
        combinedActions.append(createActionButton("Install both", false, async () => {
          const messages: string[] = [];
          if (isInstallable(target.skill.state)) {
            messages.push(await mutateSkill("install", target));
          }
          if (isInstallable(target.connection.state)) {
            messages.push(await mutateConnection("install", target));
          }
          return messages.filter(Boolean).join(" ");
        }));
      } else if (canUninstallBoth) {
        combinedActions.append(createActionButton("Uninstall both", true, async () => {
          if (!window.confirm(`Uninstall the Boatyard skill and MCP connection for ${target.label}, then revoke its token?`)) {
            return "";
          }
          if (!boatyard.uninstallMcpAgentConnection || !boatyard.uninstallMcpSkill) {
            throw new Error("Agent integration removal is unavailable.");
          }
          const connectionResult = await boatyard.uninstallMcpAgentConnection(target.id, false);
          const skillResult = await boatyard.uninstallMcpSkill(target.id, false);
          return [
            mutationMessage(connectionResult, "MCP connection removed."),
            mutationMessage(skillResult, "Skill removed.")
          ].join(" ");
        }));
      }
      titleRow.append(combinedActions);

      const skillActions: HTMLButtonElement[] = [];
      if (isInstallable(target.skill.state)) {
        skillActions.push(createActionButton(
          target.skill.state === "updateAvailable" ? "Update" : "Install",
          false,
          () => mutateSkill("install", target)
        ));
      }
      if (target.skill.state === "installed" || target.skill.state === "updateAvailable" || target.skill.state === "modified") {
        skillActions.push(createActionButton("Uninstall", true, () => mutateSkill("uninstall", target)));
      }

      const connectionActions: HTMLButtonElement[] = [];
      if (isInstallable(target.connection.state)) {
        connectionActions.push(createActionButton(
          target.connection.state === "updateAvailable" ? "Update" : "Install",
          false,
          () => mutateConnection("install", target)
        ));
      }
      if (
        target.connection.state === "installed" ||
        target.connection.state === "updateAvailable" ||
        target.connection.state === "modified" ||
        (target.connection.state === "notInstalled" && target.connection.managedToken === true)
      ) {
        connectionActions.push(createActionButton("Uninstall", true, () => mutateConnection("uninstall", target)));
      }

      item.append(
        titleRow,
        createResourceRow("Skill", target.skill, skillActions),
        createResourceRow("MCP connection", target.connection, connectionActions)
      );
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
    if (!boatyard.listMcpSkillTargets || !boatyard.listMcpAgentConnections) {
      error.textContent = "Agent integration installation is unavailable.";
      error.hidden = false;
      return;
    }
    try {
      const [skillResult, connectionResult] = await Promise.all([
        boatyard.listMcpSkillTargets(),
        boatyard.listMcpAgentConnections()
      ]);
      const skills = Array.isArray(skillResult)
        ? skillResult.map(asSkillTarget).filter((target): target is NonNullable<typeof target> => Boolean(target))
        : [];
      const connections = Array.isArray(connectionResult)
        ? connectionResult.map(asConnectionTarget).filter((target): target is NonNullable<typeof target> => Boolean(target))
        : [];
      const connectionsById = new Map(connections.map((target) => [target.id, target]));
      render(skills.flatMap((skill) => {
        const connection = connectionsById.get(skill.id);
        return connection ? [{
          connection,
          id: skill.id,
          label: skill.label,
          skill
        }] : [];
      }));
      error.hidden = true;
    } catch (loadError) {
      error.textContent = asErrorMessage(loadError);
      error.hidden = false;
    }
  }

  section.addEventListener("mcp-status-changed", () => {
    void load();
  });
  section.append(heading, list, feedback, error);
  void load();
  return section;
}
