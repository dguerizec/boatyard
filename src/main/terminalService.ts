"use strict";

const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const pty = require("node-pty");

type ExecFileAsync = import("../plugins/pluginTypes").ExecFileAsync;
type PtyProcess = ReturnType<typeof pty.spawn>;
type TerminalProject = {
  id?: string;
  slug?: string;
  name?: string;
  sourcePath?: string;
  terminalEnv?: string;
};
type TerminalSettings = {
  terminalEnv?: string;
};
type TerminalTab = {
  id: string;
  index: number;
  name: string;
  cwd: string;
};
type TerminalSize = {
  cols?: number;
  rows?: number;
};
type TerminalAttachResult = {
  terminalId: string;
  tab: TerminalTab;
};
type TerminalRecord = {
  term: PtyProcess;
  projectId?: string;
  windowId: string;
  clientSession: string;
};
type TerminalServiceOptions = {
  getProject: (projectId: string) => TerminalProject | null | undefined;
  getSettings?: () => TerminalSettings;
  sendToRenderer: (channel: string, payload: unknown) => void;
  suppressResizeWarnings?: boolean;
};

const execFileAsync = promisify(execFile);

function slugifyTmuxName(value: unknown, fallback = "session"): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function getProjectTmuxSessionName(project: TerminalProject): string {
  return `boatyard-${slugifyTmuxName(project.slug || project.name || project.id, "project")}`;
}

function getTerminalClientSessionName(projectSession: string, terminalId: unknown): string {
  return `${projectSession}-client-${slugifyTmuxName(String(terminalId).slice(0, 8), "terminal")}`;
}

function getProjectCwd(project: TerminalProject): string {
  return String(project.sourcePath || process.cwd()).trim() || process.cwd();
}

function parseTerminalEnv(text: unknown, label = "terminal environment"): Record<string, string> {
  const env: Record<string, string> = {};

  String(text || "")
    .split(/\r?\n/)
    .forEach((rawLine, index) => {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) {
        return;
      }

      const separatorIndex = line.indexOf("=");
      const key = separatorIndex >= 0 ? line.slice(0, separatorIndex).trim() : line;
      const value = separatorIndex >= 0 ? line.slice(separatorIndex + 1) : "";

      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
        throw new Error(`Invalid ${label} line ${index + 1}: ${rawLine}`);
      }

      env[key] = value;
    });

  return env;
}

function getTmuxEnvironmentArgs(env: Record<string, string> = {}): string[] {
  return Object.entries(env).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

async function runTmux(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: 5000,
    windowsHide: true
  });
  return stdout.trim();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resizeTmuxWindow(windowId: unknown, cols: number, rows: number): Promise<void> {
  if (!windowId) {
    return;
  }

  try {
    await runTmux(["resize-window", "-t", String(windowId), "-x", String(cols), "-y", String(rows)]);
  } catch (error) {
    console.warn(`Could not resize tmux window ${windowId}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function getTmuxSessionClients(session: string): Promise<string[]> {
  if (!session) {
    return [];
  }

  const output = await runTmux(["list-clients", "-t", session, "-F", "#{client_name}"]);
  return output.split("\n").filter(Boolean);
}

async function refreshTmuxSessionClients(session: string): Promise<void> {
  if (!session) {
    return;
  }

  try {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const clients = await getTmuxSessionClients(session);
      if (clients.length) {
        await Promise.all(clients.map((client) => runTmux(["refresh-client", "-S", "-t", client])));
        return;
      }

      await sleep(50);
    }
  } catch (error) {
    console.warn(`Could not refresh tmux clients for ${session}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function scheduleInitialTmuxRefresh(session: string, windowId: string, cols: number, rows: number): void {
  setTimeout(() => {
    resizeTmuxWindow(windowId, cols, rows)
      .then(() => refreshTmuxSessionClients(session))
      .catch((error) => {
        console.warn(`Could not schedule initial tmux refresh for ${session}: ${error instanceof Error ? error.message : String(error)}`);
      });
  }, 100);
}

async function configureTmuxSession(session: string): Promise<void> {
  await runTmux(["set-option", "-t", session, "window-size", "latest"]);
  await runTmux(["set-option", "-t", session, "mouse", "on"]);
  await runTmux(["set-option", "-t", session, "status", "off"]);
}

async function destroyTmuxSession(session: string | undefined): Promise<void> {
  if (!session) {
    return;
  }

  try {
    await runTmux(["kill-session", "-t", session]);
  } catch (error) {
    console.warn(`Could not kill tmux session ${session}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

class TerminalService {
  private findProject: (projectId: string) => TerminalProject | null | undefined;
  private getSettings: () => TerminalSettings;
  private sendToRenderer: (channel: string, payload: unknown) => void;
  private suppressResizeWarnings: boolean;
  private terminals: Map<string, TerminalRecord>;

  constructor({ getProject, getSettings = () => ({}), sendToRenderer, suppressResizeWarnings = false }: TerminalServiceOptions) {
    this.findProject = getProject;
    this.getSettings = getSettings;
    this.sendToRenderer = sendToRenderer;
    this.suppressResizeWarnings = suppressResizeWarnings;
    this.terminals = new Map();
  }

  getProject(projectId: string): TerminalProject {
    const project = this.findProject(projectId);

    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    return project;
  }

  getProjectTerminalEnv(project: TerminalProject): Record<string, string> {
    return {
      ...parseTerminalEnv(this.getSettings().terminalEnv, "global terminal environment"),
      ...parseTerminalEnv(project.terminalEnv, "project terminal environment")
    };
  }

  async ensureProjectSession(project: TerminalProject): Promise<string> {
    const session = getProjectTmuxSessionName(project);
    const envArgs = getTmuxEnvironmentArgs(this.getProjectTerminalEnv(project));

    try {
      await runTmux(["has-session", "-t", session]);
      await configureTmuxSession(session);
      return session;
    } catch {
      await runTmux(["new-session", "-d", "-s", session, "-n", "main", ...envArgs, "-c", getProjectCwd(project)]);
      await configureTmuxSession(session);
      return session;
    }
  }

  async listTabs(projectId: string): Promise<TerminalTab[]> {
    const project = this.getProject(projectId);
    const session = await this.ensureProjectSession(project);
    return this.listSessionTabs(session);
  }

  async listSessionTabs(session: string): Promise<TerminalTab[]> {
    const output = await runTmux([
      "list-windows",
      "-t",
      session,
      "-F",
      "#{window_id}\t#{window_index}\t#{window_name}\t#{pane_current_path}"
    ]);

    return output
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [id, index, name, cwd] = line.split("\t");
        return {
          id,
          index: Number(index),
          name,
          cwd
        };
      });
  }

  async createTab(projectId: string, name: unknown = "shell"): Promise<TerminalTab> {
    const project = this.getProject(projectId);
    const session = await this.ensureProjectSession(project);
    const tabs = await this.listSessionTabs(session);
    const nextIndex = tabs.reduce((maxIndex, tab) => (
      Number.isFinite(tab.index) ? Math.max(maxIndex, tab.index) : maxIndex
    ), 0) + 1;
    const tabName = slugifyTmuxName(name, "shell");
    const envArgs = getTmuxEnvironmentArgs(this.getProjectTerminalEnv(project));
    const output = await runTmux([
      "new-window",
      "-P",
      "-F",
      "#{window_id}\t#{window_index}\t#{window_name}\t#{pane_current_path}",
      "-t",
      `${session}:${nextIndex}`,
      "-n",
      tabName,
      ...envArgs,
      "-c",
      getProjectCwd(project)
    ]);
    const [id, index, windowName, cwd] = output.split("\t");
    return {
      id,
      index: Number(index),
      name: windowName,
      cwd
    };
  }

  async renameTab(projectId: string, windowId: string, name: unknown): Promise<TerminalTab | null> {
    const project = this.getProject(projectId);
    await this.ensureProjectSession(project);
    const nextName = String(name || "").trim();
    if (!nextName) {
      throw new Error("Shell name is required.");
    }

    await runTmux(["rename-window", "-t", String(windowId), nextName]);
    const tabs = await this.listTabs(projectId);
    return tabs.find((tab) => tab.id === windowId) || null;
  }

  async closeTab(projectId: string, windowId: string): Promise<TerminalTab[]> {
    const project = this.getProject(projectId);
    const session = await this.ensureProjectSession(project);
    const closedWindowId = String(windowId);
    await runTmux(["kill-window", "-t", closedWindowId]);

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const tabs = await this.listSessionTabs(session);
      if (!tabs.some((tab) => tab.id === closedWindowId)) {
        return tabs;
      }

      await sleep(50);
    }

    return (await this.listSessionTabs(session)).filter((tab) => tab.id !== closedWindowId);
  }

  async attach(projectId: string, windowId: string | undefined, size: TerminalSize = {}): Promise<TerminalAttachResult> {
    const project = this.getProject(projectId);
    const projectSession = await this.ensureProjectSession(project);
    const tabs = await this.listTabs(projectId);
    const selectedTab = tabs.find((tab) => tab.id === windowId) || tabs[0];
    const terminalId = randomUUID();
    const clientSession = getTerminalClientSessionName(projectSession, terminalId);
    const cols = Math.max(20, Math.round(Number(size.cols) || 100));
    const rows = Math.max(5, Math.round(Number(size.rows) || 30));
    await runTmux(["new-session", "-d", "-t", projectSession, "-s", clientSession]);
    await configureTmuxSession(clientSession);
    await runTmux(["select-window", "-t", `${clientSession}:${selectedTab.index}`]);
    const term = pty.spawn("tmux", ["attach-session", "-t", clientSession], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: getProjectCwd(project),
      env: {
        ...process.env,
        ...this.getProjectTerminalEnv(project),
        TERM: "xterm-256color"
      }
    });
    term.onData((data: string) => {
      this.sendToRenderer("terminal:data", {
        terminalId,
        data
      });
    });
    term.onExit(({ exitCode }: { exitCode: number }) => {
      const terminal = this.terminals.get(terminalId);
      this.terminals.delete(terminalId);
      destroyTmuxSession(terminal?.clientSession);
      this.sendToRenderer("terminal:exit", {
        terminalId,
        projectId: terminal?.projectId,
        windowId: terminal?.windowId,
        exitCode
      });
    });
    this.terminals.set(terminalId, {
      term,
      projectId: project.id,
      windowId: selectedTab.id,
      clientSession
    });
    scheduleInitialTmuxRefresh(clientSession, selectedTab.id, cols, rows);

    return {
      terminalId,
      tab: selectedTab
    };
  }

  write(terminalId: unknown, data: unknown): void {
    const term = this.terminals.get(String(terminalId));
    if (term) {
      term.term.write(String(data || ""));
    }
  }

  resize(terminalId: unknown, size: TerminalSize = {}): void {
    const terminal = this.terminals.get(String(terminalId));
    if (!terminal) {
      return;
    }

    const cols = Math.max(20, Math.round(Number(size.cols) || terminal.term.cols));
    const rows = Math.max(5, Math.round(Number(size.rows) || terminal.term.rows));
    try {
      terminal.term.resize(cols, rows);
    } catch (error) {
      if (!this.suppressResizeWarnings) {
        console.warn(`Could not resize terminal ${terminalId}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    resizeTmuxWindow(terminal.windowId, cols, rows);
  }

  detach(terminalId: unknown): void {
    const terminal = this.terminals.get(String(terminalId));
    if (!terminal) {
      return;
    }

    terminal.term.kill();
    this.terminals.delete(String(terminalId));
    destroyTmuxSession(terminal.clientSession);
  }

  detachAll(): void {
    for (const terminalId of this.terminals.keys()) {
      this.detach(terminalId);
    }
  }
}

module.exports = {
  TerminalService,
  parseTerminalEnv,
  getProjectTmuxSessionName,
  getTerminalClientSessionName,
  slugifyTmuxName
};
