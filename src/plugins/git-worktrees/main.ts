"use strict";

import type { ExecFileAsync, PluginActions } from "../../shared/pluginTypes";
import {
  parseGitWorktreesWithHead,
  type GitWorktreeHeadEntry
} from "../../main/gitWorktrees.js";
import { parseGitStatus, type GitStatusSnapshot } from "../../main/gitStatus.js";

const path = require("node:path");

type GitWorktreesPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
  getState(): {
    settings?: {
      projectsBasePath?: unknown;
    };
  } | undefined;
};

type ListProjectWorktreesInput = {
  sourcePath?: unknown;
};

type GitInspectionOptions = {
  conflictCache?: Map<string, Promise<GitPairConflictInspection>>;
  execFileAsync: ExecFileAsync;
  projectsBasePath?: unknown;
};

type GitProjectInput = {
  includePotentialConflicts?: unknown;
  sourcePath?: unknown;
};

type GitPotentialConflict = {
  path: string;
  peers: string[];
};

type GitPotentialConflictError = {
  message: string;
  peer: string;
};

type GitPairConflictInspection = {
  conflicted: boolean;
  paths: string[];
};

type ProjectGitWorktree = GitWorktreeHeadEntry & {
  current: boolean;
  displayPath: string;
  name: string;
  primary: boolean;
};

type ProjectGitWorktrees = {
  currentPath: string;
  linkedCount: number;
  worktrees: ProjectGitWorktree[];
};

type ProjectGitWorktreeSnapshot = ProjectGitWorktree & {
  potentialConflictErrors: GitPotentialConflictError[];
  potentialConflicts: GitPotentialConflict[];
  status: GitStatusSnapshot | null;
  statusError: string;
};

type ProjectGitWorkspace = {
  currentPath: string;
  linkedCount: number;
  totalPotentialConflictCount: number;
  totalChangeCount: number;
  worktrees: ProjectGitWorktreeSnapshot[];
};

const MAX_CONFLICT_CACHE_ENTRIES = 256;

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

function getRelativeDescendantPath(parentPath: unknown, childPath: unknown): string | null {
  const parent = normalizeText(parentPath);
  const child = normalizeText(childPath);
  if (!parent || !child) {
    return null;
  }

  const relativePath = path.relative(path.resolve(parent), path.resolve(child));
  if (
    relativePath === ".."
    || relativePath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativePath)
  ) {
    return null;
  }
  return relativePath;
}

function getWorktreeDisplayPath(
  worktreePath: unknown,
  projectPath: unknown,
  projectsBasePath: unknown
): string {
  const absolutePath = normalizeText(worktreePath);
  if (!absolutePath) {
    return "";
  }

  const projectRelativePath = getRelativeDescendantPath(projectPath, absolutePath);
  if (projectRelativePath) {
    return projectRelativePath;
  }

  const baseRelativePath = getRelativeDescendantPath(projectsBasePath, absolutePath);
  if (baseRelativePath) {
    return baseRelativePath;
  }

  if (baseRelativePath === "") {
    return path.basename(path.resolve(absolutePath)) || absolutePath;
  }
  return absolutePath;
}

function getWorktreeName(worktree: GitWorktreeHeadEntry): string {
  return path.basename(worktree.path) || worktree.branch || "worktree";
}

function parseGitMergeTreeConflicts(output: unknown): string[] {
  const records = String(output || "").split("\0");
  return records
    .slice(1)
    .filter((record) => record.length > 0)
    .sort((left, right) => left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base"
    }));
}

async function inspectGitPairConflicts(
  cwd: string,
  leftHead: string,
  rightHead: string,
  { execFileAsync }: GitInspectionOptions
): Promise<GitPairConflictInspection> {
  const args = [
    "merge-tree",
    "--write-tree",
    "--name-only",
    "--no-messages",
    "-z",
    leftHead,
    rightHead
  ];

  try {
    const { stdout = "" } = await execFileAsync(
      "git",
      args,
      { cwd, timeout: 30000, windowsHide: true }
    );
    return { conflicted: false, paths: parseGitMergeTreeConflicts(stdout) };
  } catch (error) {
    const commandError = error && typeof error === "object"
      ? error as { code?: unknown; stdout?: unknown }
      : {};
    if (Number(commandError.code) === 1) {
      return {
        conflicted: true,
        paths: parseGitMergeTreeConflicts(commandError.stdout)
      };
    }
    throw new Error(`Could not inspect potential conflicts: ${normalizeCommandError(error)}`);
  }
}

function getConflictCacheKey(rootPath: string, leftHead: string, rightHead: string): string {
  return [normalizePathForComparison(rootPath), ...[leftHead, rightHead].sort()].join("\0");
}

function cacheConflictInspection(
  cache: Map<string, Promise<GitPairConflictInspection>>,
  key: string,
  inspection: Promise<GitPairConflictInspection>
): void {
  if (cache.size >= MAX_CONFLICT_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    }
  }
  cache.set(key, inspection);
}

async function inspectCachedGitPairConflicts(
  rootPath: string,
  leftHead: string,
  rightHead: string,
  options: GitInspectionOptions
): Promise<GitPairConflictInspection> {
  const cache = options.conflictCache;
  if (!cache) {
    return inspectGitPairConflicts(rootPath, leftHead, rightHead, options);
  }

  const key = getConflictCacheKey(rootPath, leftHead, rightHead);
  const cached = cache.get(key);
  if (cached) {
    return cached;
  }

  const inspection = inspectGitPairConflicts(rootPath, leftHead, rightHead, options);
  cacheConflictInspection(cache, key, inspection);
  try {
    return await inspection;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

async function listProjectGitWorktrees(
  sourcePath: unknown,
  { execFileAsync, projectsBasePath }: GitInspectionOptions
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
    const worktrees = parseGitWorktreesWithHead(worktreeOutput).map((worktree, index) => ({
      ...worktree,
      current: normalizePathForComparison(worktree.path) === currentComparablePath,
      displayPath: getWorktreeDisplayPath(worktree.path, sourcePath, projectsBasePath),
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

async function getProjectGitStatus(
  sourcePath: unknown,
  { execFileAsync }: GitInspectionOptions
): Promise<GitStatusSnapshot> {
  const cwd = normalizeText(sourcePath);
  if (!cwd) {
    throw new Error("Project source path is required.");
  }

  try {
    const { stdout = "" } = await execFileAsync(
      "git",
      ["status", "--porcelain=v2", "--branch", "-z", "--untracked-files=all"],
      { cwd, timeout: 10000, windowsHide: true }
    );
    return parseGitStatus(stdout);
  } catch (error) {
    throw new Error(`Could not inspect Git changes: ${normalizeCommandError(error)}`);
  }
}

async function getProjectGitWorkspace(
  sourcePath: unknown,
  options: GitInspectionOptions,
  includePotentialConflicts = false
): Promise<ProjectGitWorkspace> {
  const worktreeSnapshot = await listProjectGitWorktrees(sourcePath, options);
  const worktrees = await Promise.all(worktreeSnapshot.worktrees.map(async (
    worktree
  ): Promise<ProjectGitWorktreeSnapshot> => {
    if (!worktree.usable) {
      return {
        ...worktree,
        potentialConflictErrors: [],
        potentialConflicts: [],
        status: null,
        statusError: "Worktree is unavailable."
      };
    }

    try {
      return {
        ...worktree,
        potentialConflictErrors: [],
        potentialConflicts: [],
        status: await getProjectGitStatus(worktree.path, options),
        statusError: ""
      };
    } catch (error) {
      return {
        ...worktree,
        potentialConflictErrors: [],
        potentialConflicts: [],
        status: null,
        statusError: error instanceof Error ? error.message : normalizeCommandError(error)
      };
    }
  }));

  let totalPotentialConflictCount = 0;
  if (includePotentialConflicts) {
    const comparableWorktrees = worktrees.filter((worktree) => (
      worktree.usable && !worktree.detached && Boolean(worktree.branch) && Boolean(worktree.head)
    ));
    const conflictsByPath = new Map<string, Map<string, Set<string>>>();
    const getWorktreeConflicts = (worktreePath: string) => {
      const existing = conflictsByPath.get(worktreePath);
      if (existing) {
        return existing;
      }
      const created = new Map<string, Set<string>>();
      conflictsByPath.set(worktreePath, created);
      return created;
    };
    const addConflict = (worktreePath: string, conflictPath: string, peer: string) => {
      const worktreeConflicts = getWorktreeConflicts(worktreePath);
      const peers = worktreeConflicts.get(conflictPath) || new Set<string>();
      peers.add(peer);
      worktreeConflicts.set(conflictPath, peers);
    };

    const pairs: Array<[ProjectGitWorktreeSnapshot, ProjectGitWorktreeSnapshot]> = [];
    for (let leftIndex = 0; leftIndex < comparableWorktrees.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < comparableWorktrees.length; rightIndex += 1) {
        pairs.push([comparableWorktrees[leftIndex], comparableWorktrees[rightIndex]]);
      }
    }

    for (let pairIndex = 0; pairIndex < pairs.length; pairIndex += 4) {
      const pairBatch = pairs.slice(pairIndex, pairIndex + 4);
      await Promise.all(pairBatch.map(async ([left, right]) => {
        try {
          const inspection = await inspectCachedGitPairConflicts(
            worktreeSnapshot.currentPath,
            left.head,
            right.head,
            options
          );
          if (!inspection.conflicted) {
            return;
          }

          totalPotentialConflictCount += Math.max(1, inspection.paths.length);
          if (!inspection.paths.length) {
            const message = "Git reported a potential conflict without a file path.";
            left.potentialConflictErrors.push({ message, peer: right.branch });
            right.potentialConflictErrors.push({ message, peer: left.branch });
            return;
          }
          for (const conflictPath of inspection.paths) {
            addConflict(left.path, conflictPath, right.branch);
            addConflict(right.path, conflictPath, left.branch);
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : normalizeCommandError(error);
          left.potentialConflictErrors.push({ message, peer: right.branch });
          right.potentialConflictErrors.push({ message, peer: left.branch });
        }
      }));
    }

    for (const worktree of worktrees) {
      const worktreeConflicts = conflictsByPath.get(worktree.path);
      worktree.potentialConflicts = [...(worktreeConflicts || new Map())]
        .map(([conflictPath, peers]) => ({
          path: conflictPath,
          peers: [...peers].sort((left, right) => left.localeCompare(right, undefined, {
            numeric: true,
            sensitivity: "base"
          }))
        }))
        .sort((left, right) => left.path.localeCompare(right.path, undefined, {
          numeric: true,
          sensitivity: "base"
        }));
      worktree.potentialConflictErrors.sort((left, right) => left.peer.localeCompare(
        right.peer,
        undefined,
        { numeric: true, sensitivity: "base" }
      ));
    }
  }

  return {
    currentPath: worktreeSnapshot.currentPath,
    linkedCount: worktreeSnapshot.linkedCount,
    totalPotentialConflictCount,
    totalChangeCount: worktrees.reduce((total, worktree) => (
      total + (worktree.status?.changes.length || 0)
    ), 0),
    worktrees
  };
}

function activate(ctx: GitWorktreesPluginContext): void {
  const conflictCache = new Map<string, Promise<GitPairConflictInspection>>();
  ctx.actions.handle<ListProjectWorktreesInput>("listForProject", ({ sourcePath } = {}) => (
    listProjectGitWorktrees(sourcePath, {
      execFileAsync: ctx.execFileAsync,
      projectsBasePath: ctx.getState()?.settings?.projectsBasePath
    })
  ));
  ctx.actions.handle<GitProjectInput>("statusForProject", ({ sourcePath } = {}) => (
    getProjectGitStatus(sourcePath, { execFileAsync: ctx.execFileAsync })
  ));
  ctx.actions.handle<GitProjectInput>("snapshotForProject", ({
    includePotentialConflicts,
    sourcePath
  } = {}) => (
    getProjectGitWorkspace(
      sourcePath,
      {
        conflictCache,
        execFileAsync: ctx.execFileAsync,
        projectsBasePath: ctx.getState()?.settings?.projectsBasePath
      },
      includePotentialConflicts === true
    )
  ));
}

export {
  activate,
  getProjectGitStatus,
  getProjectGitWorkspace,
  getWorktreeDisplayPath,
  getWorktreeName,
  inspectGitPairConflicts,
  listProjectGitWorktrees,
  normalizeCommandError,
  normalizePathForComparison,
  parseGitMergeTreeConflicts
};
