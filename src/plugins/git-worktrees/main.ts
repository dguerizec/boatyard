"use strict";

import type { ExecFileAsync, PluginActions } from "../../shared/pluginTypes";
import { parseGitWorktrees, type GitWorktreeEntry } from "../../main/gitWorktrees.js";

const path = require("node:path");

type GitWorktreesPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
};

type ListProjectWorktreesInput = {
  sourcePath?: unknown;
};

type ListProjectWorktreesOptions = {
  execFileAsync: ExecFileAsync;
};

type ProjectGitWorktree = GitWorktreeEntry & {
  current: boolean;
  name: string;
  primary: boolean;
};

type ProjectGitWorktrees = {
  currentPath: string;
  linkedCount: number;
  worktrees: ProjectGitWorktree[];
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeCommandError(error: unknown): string {
  const commandError = error && typeof error === "object"
    ? error as { message?: unknown; stderr?: unknown; stdout?: unknown }
    : {};
  return normalizeText(commandError.stderr)
    || normalizeText(commandError.stdout)
    || normalizeText(commandError.message)
    || "Git command failed.";
}

function normalizePathForComparison(value: unknown): string {
  const normalized = path.resolve(normalizeText(value));
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function getWorktreeName(worktree: GitWorktreeEntry): string {
  return path.basename(worktree.path) || worktree.branch || "worktree";
}

async function listProjectGitWorktrees(
  sourcePath: unknown,
  { execFileAsync }: ListProjectWorktreesOptions
): Promise<ProjectGitWorktrees> {
  const cwd = normalizeText(sourcePath);
  if (!cwd) {
    throw new Error("Project source path is required.");
  }

  try {
    const { stdout: rootOutput = "" } = await execFileAsync(
      "git",
      ["rev-parse", "--show-toplevel"],
      { cwd, timeout: 10000, windowsHide: true }
    );
    const currentPath = normalizeText(rootOutput);
    const { stdout: worktreeOutput = "" } = await execFileAsync(
      "git",
      ["worktree", "list", "--porcelain"],
      { cwd: currentPath || cwd, timeout: 10000, windowsHide: true }
    );
    const currentComparablePath = normalizePathForComparison(currentPath || cwd);
    const worktrees = parseGitWorktrees(worktreeOutput).map((worktree, index) => ({
      ...worktree,
      current: normalizePathForComparison(worktree.path) === currentComparablePath,
      name: getWorktreeName(worktree),
      primary: index === 0
    }));

    return {
      currentPath,
      linkedCount: Math.max(0, worktrees.length - 1),
      worktrees
    };
  } catch (error) {
    throw new Error(`Could not inspect Git worktrees: ${normalizeCommandError(error)}`);
  }
}

function activate(ctx: GitWorktreesPluginContext): void {
  ctx.actions.handle<ListProjectWorktreesInput>("listForProject", ({ sourcePath } = {}) => (
    listProjectGitWorktrees(sourcePath, { execFileAsync: ctx.execFileAsync })
  ));
}

export {
  activate,
  getWorktreeName,
  listProjectGitWorktrees,
  normalizeCommandError,
  normalizePathForComparison
};
