"use strict";

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeCommandError(error) {
  const stderr = normalizeText(error?.stderr);
  const stdout = normalizeText(error?.stdout);
  return stderr || stdout || error?.message || "Pier command failed.";
}

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

function buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate } = {}) {
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

function buildWorktreeRemoveArgs({ worktreePath, force, purge, skipDown } = {}) {
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

function activate(ctx) {
  ctx.actions.handle("createWorktree", ({ cwd, worktreePath, branchName, fromRef, startAfterCreate } = {}) => {
    return runPierWorktreeCommand(
      buildWorktreeAddArgs({ worktreePath, branchName, fromRef, startAfterCreate }),
      { cwd, execFileAsync: ctx.execFileAsync }
    );
  });

  ctx.actions.handle("removeWorktree", ({ cwd, worktreePath, force, purge, skipDown } = {}) => {
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

module.exports = { activate };
