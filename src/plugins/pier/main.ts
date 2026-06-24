"use strict";

import type { ExecFileAsync, PluginActions, PluginMetadata } from "../pluginTypes";

type WorktreeCommandOptions = { cwd?: unknown; execFileAsync: ExecFileAsync };
type WorktreeAddInput = { worktreePath?: unknown; branchName?: unknown; fromRef?: unknown; startAfterCreate?: unknown };
type WorktreeRemoveInput = { worktreePath?: unknown; force?: unknown; purge?: unknown; skipDown?: unknown };
type PierProject = { id: string; previewUrl?: string };
type PierProjectConfig = { pierPreviewUrl?: unknown };
type PluginProjectConfig = { projects?: Record<string, Record<string, PierProjectConfig>> };
type PierState = { projects?: PierProject[]; pluginConfig?: { projects?: PluginProjectConfig["projects"] } };
type PierProjectConfigMigration = { projectId: string; config: { pierPreviewUrl: string } };
type PierStateMigrationResult = { projectPluginConfig: PierProjectConfigMigration[] };
type PierPluginContext = {
  actions: PluginActions;
  stateMigrations: { register(handler: (payload: { state: PierState }) => PierStateMigrationResult): void };
  plugin: PluginMetadata;
  execFileAsync: ExecFileAsync;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeCommandError(error: unknown): string {
  const commandError = error && typeof error === "object"
    ? error as { stderr?: unknown; stdout?: unknown; message?: unknown }
    : {};
  const stderr = normalizeText(commandError.stderr);
  const stdout = normalizeText(commandError.stdout);
  return stderr || stdout || normalizeText(commandError.message) || "Pier command failed.";
}

async function runPierWorktreeCommand(args: string[], { cwd, execFileAsync }: WorktreeCommandOptions): Promise<{ output: string }> {
  const sourcePath = normalizeText(cwd);
  if (!sourcePath) {
    throw new Error("Project source path is required.");
  }

  try {
    const { stdout = "" } = await execFileAsync("pier", ["worktree", ...args], {
      cwd: sourcePath,
      timeout: 120000,
      windowsHide: true
    });
    return { output: stdout };
  } catch (error) {
    throw new Error(normalizeCommandError(error));
  }
}

function buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate }: WorktreeAddInput = {}) {
  const targetPath = normalizeText(worktreePath);
  if (!targetPath) {
    throw new Error("Worktree path is required.");
  }

  const args = ["add", targetPath];
  const branch = normalizeText(branchName);
  if (branch) {
    args.push("--branch", branch);
  }

  const baseRef = normalizeText(fromRef);
  if (baseRef) {
    args.push("--from", baseRef);
  }

  if (startAfterCreate) {
    args.push("--up");
  }

  return args;
}

function buildWorktreeRemoveArgs({ worktreePath, force, purge, skipDown }: WorktreeRemoveInput = {}) {
  const targetPath = normalizeText(worktreePath);
  if (!targetPath) {
    throw new Error("Worktree path is required.");
  }

  const args = ["rm", targetPath];
  if (force) {
    args.push("--force");
  }
  if (purge) {
    args.push("--purge");
  }
  if (skipDown) {
    args.push("--skip-down");
  }
  return args;
}

function activate(ctx: PierPluginContext) {
  ctx.actions.handle<WorktreeAddInput & { cwd?: unknown }>("createWorktree", ({ cwd, worktreePath, branchName, fromRef, startAfterCreate } = {}) => {
    return runPierWorktreeCommand(
      buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate }),
      { cwd, execFileAsync: ctx.execFileAsync }
    );
  });

  ctx.actions.handle<WorktreeRemoveInput & { cwd?: unknown }>("removeWorktree", ({ cwd, worktreePath, force, purge, skipDown } = {}) => {
    return runPierWorktreeCommand(
      buildWorktreeRemoveArgs({ worktreePath, force, purge, skipDown }),
      { cwd, execFileAsync: ctx.execFileAsync }
    );
  });

  ctx.stateMigrations.register(({ state }) => {
    const projectPluginConfig = [];

    for (const project of state.projects || []) {
      if (!project.previewUrl) {
        continue;
      }

      const current = state.pluginConfig?.projects?.[project.id]?.[ctx.plugin.id] || {};
      if (current.pierPreviewUrl) {
        continue;
      }

      projectPluginConfig.push({
        projectId: project.id,
        config: {
          pierPreviewUrl: project.previewUrl
        }
      });
    }

    return { projectPluginConfig };
  });
}

export { activate };
