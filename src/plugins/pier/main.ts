"use strict";

/**
 * @typedef {import("../pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {import("../pluginTypes").PluginActions} PluginActions
 * @typedef {import("../pluginTypes").PluginMetadata} PluginMetadata
 * @typedef {{ cwd?: unknown, execFileAsync: ExecFileAsync }} WorktreeCommandOptions
 * @typedef {{ worktreePath?: unknown, branchName?: unknown, fromRef?: unknown, startAfterCreate?: unknown }} WorktreeAddInput
 * @typedef {{ worktreePath?: unknown, force?: unknown, purge?: unknown, skipDown?: unknown }} WorktreeRemoveInput
 * @typedef {{ id: string, previewUrl?: string }} PierProject
 * @typedef {{ pierPreviewUrl?: unknown }} PierProjectConfig
 * @typedef {{ projects?: Record<string, Record<string, PierProjectConfig>> }} PluginProjectConfig
 * @typedef {{ projects?: PierProject[], pluginConfig?: { projects?: PluginProjectConfig["projects"] } }} PierState
 * @typedef {{ projectId: string, config: { pierPreviewUrl: string } }} PierProjectConfigMigration
 * @typedef {{ projectPluginConfig: PierProjectConfigMigration[] }} PierStateMigrationResult
 * @typedef {{
 *   actions: PluginActions,
 *   stateMigrations: { register(handler: (payload: { state: PierState }) => PierStateMigrationResult): void },
 *   plugin: PluginMetadata,
 *   execFileAsync: ExecFileAsync
 * }} PierPluginContext
 */

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeText(value) {
  return String(value || "").trim();
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function normalizeCommandError(error) {
  const commandError = /** @type {{ stderr?: unknown, stdout?: unknown, message?: unknown }} */ (error || {});
  const stderr = normalizeText(commandError.stderr);
  const stdout = normalizeText(commandError.stdout);
  return stderr || stdout || normalizeText(commandError.message) || "Pier command failed.";
}

/**
 * @param {string[]} args
 * @param {WorktreeCommandOptions} options
 * @returns {Promise<{ output: string }>}
 */
async function runPierWorktreeCommand(args, { cwd, execFileAsync }) {
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

/**
 * @param {WorktreeAddInput} input
 * @returns {string[]}
 */
function buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate }: any = {}) {
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

/**
 * @param {WorktreeRemoveInput} input
 * @returns {string[]}
 */
function buildWorktreeRemoveArgs({ worktreePath, force, purge, skipDown }: any = {}) {
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

/**
 * @param {PierPluginContext} ctx
 */
function activate(ctx) {
  ctx.actions.handle("createWorktree", ({ cwd, worktreePath, branchName, fromRef, startAfterCreate }: any = {}) => {
    return runPierWorktreeCommand(
      buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate }),
      { cwd, execFileAsync: ctx.execFileAsync }
    );
  });

  ctx.actions.handle("removeWorktree", ({ cwd, worktreePath, force, purge, skipDown }: any = {}) => {
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
