"use strict";

const { execFile } = require("node:child_process");
const { randomUUID } = require("node:crypto");
const { promisify } = require("node:util");
const pty = require("node-pty");

const execFileAsync = promisify(execFile);

function slugifyTmuxName(value, fallback = "session") {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function getProjectTmuxSessionName(project) {
  return `dashtop-${slugifyTmuxName(project.slug || project.name || project.id, "project")}`;
}

function getProjectCwd(project) {
  return String(project.sourcePath || process.cwd()).trim() || process.cwd();
}

async function runTmux(args) {
  const { stdout } = await execFileAsync("tmux", args, {
    timeout: 5000,
    windowsHide: true
  });
  return stdout.trim();
}

async function resizeTmuxWindow(windowId, cols, rows) {
  if (!windowId) {
    return;
  }

  try {
    await runTmux(["resize-window", "-t", String(windowId), "-x", String(cols), "-y", String(rows)]);
  } catch (error) {
    console.warn(`Could not resize tmux window ${windowId}: ${error.message}`);
  }
}

class TerminalService {
  constructor({ getProject, sendToRenderer }) {
    this.findProject = getProject;
    this.sendToRenderer = sendToRenderer;
    this.terminals = new Map();
  }

  getProject(projectId) {
    const project = this.findProject(projectId);

    if (!project) {
      throw new Error(`Unknown project: ${projectId}`);
    }

    return project;
  }

  async ensureProjectSession(project) {
    const session = getProjectTmuxSessionName(project);

    try {
      await runTmux(["has-session", "-t", session]);
      await runTmux(["set-option", "-t", session, "window-size", "latest"]);
      return session;
    } catch {
      await runTmux(["new-session", "-d", "-s", session, "-n", "main", "-c", getProjectCwd(project)]);
      await runTmux(["set-option", "-t", session, "window-size", "latest"]);
      return session;
    }
  }

  async listTabs(projectId) {
    const project = this.getProject(projectId);
    const session = await this.ensureProjectSession(project);
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

  async createTab(projectId, name = "shell") {
    const project = this.getProject(projectId);
    const session = await this.ensureProjectSession(project);
    const tabName = slugifyTmuxName(name, "shell");
    const output = await runTmux([
      "new-window",
      "-P",
      "-F",
      "#{window_id}\t#{window_index}\t#{window_name}\t#{pane_current_path}",
      "-t",
      session,
      "-n",
      tabName,
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

  async closeTab(projectId, windowId) {
    const project = this.getProject(projectId);
    await this.ensureProjectSession(project);
    await runTmux(["kill-window", "-t", String(windowId)]);
    return this.listTabs(projectId);
  }

  async attach(projectId, windowId, size = {}) {
    const project = this.getProject(projectId);
    await this.ensureProjectSession(project);
    const tabs = await this.listTabs(projectId);
    const selectedTab = tabs.find((tab) => tab.id === windowId) || tabs[0];
    const terminalId = randomUUID();
    const cols = Math.max(20, Math.round(Number(size.cols) || 100));
    const rows = Math.max(5, Math.round(Number(size.rows) || 30));
    const term = pty.spawn("tmux", ["attach-session", "-t", String(selectedTab.id)], {
      name: "xterm-256color",
      cols,
      rows,
      cwd: getProjectCwd(project),
      env: {
        ...process.env,
        TERM: "xterm-256color"
      }
    });
    await resizeTmuxWindow(selectedTab.id, cols, rows);

    term.onData((data) => {
      this.sendToRenderer("terminal:data", {
        terminalId,
        data
      });
    });
    term.onExit(({ exitCode }) => {
      this.terminals.delete(terminalId);
      this.sendToRenderer("terminal:exit", {
        terminalId,
        exitCode
      });
    });
    this.terminals.set(terminalId, {
      term,
      windowId: selectedTab.id
    });

    return {
      terminalId,
      tab: selectedTab
    };
  }

  write(terminalId, data) {
    const term = this.terminals.get(String(terminalId));
    if (term) {
      term.term.write(String(data || ""));
    }
  }

  resize(terminalId, size = {}) {
    const terminal = this.terminals.get(String(terminalId));
    if (!terminal) {
      return;
    }

    const cols = Math.max(20, Math.round(Number(size.cols) || terminal.term.cols));
    const rows = Math.max(5, Math.round(Number(size.rows) || terminal.term.rows));
    terminal.term.resize(cols, rows);
    resizeTmuxWindow(terminal.windowId, cols, rows);
  }

  detach(terminalId) {
    const terminal = this.terminals.get(String(terminalId));
    if (!terminal) {
      return;
    }

    terminal.term.kill();
    this.terminals.delete(String(terminalId));
  }

  detachAll() {
    for (const terminalId of this.terminals.keys()) {
      this.detach(terminalId);
    }
  }
}

module.exports = {
  TerminalService,
  getProjectTmuxSessionName,
  slugifyTmuxName
};
