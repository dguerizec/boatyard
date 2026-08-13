"use strict";

import type { ExecFileAsync, PluginResourceProviderResult } from "../../shared/pluginTypes";

const PIER_RESOURCE_PROVIDER_ID = "boatyard.pier.systemResources";

type PierResourceProject = { id?: string; name?: string; slug?: string; sourcePath?: string };
type PierResourceState = {
  projects?: PierResourceProject[];
  pluginConfig?: {
    global?: Record<string, Record<string, unknown>>;
    projects?: Record<string, Record<string, Record<string, unknown>>>;
  };
};
type PierContainer = { name?: unknown; status?: unknown };
type PierWorkloadSource = {
  containers?: PierContainer[];
  project?: unknown;
  slug?: unknown;
  status?: unknown;
  worktree_path?: unknown;
};
type PierWorktreeSource = {
  has_workload?: unknown;
  path?: unknown;
  workload?: PierWorkloadSource;
};
type PierWorkloadResource = {
  boatyardProjectId: string;
  boatyardProjectName: string;
  containerCount: number;
  containerNames: string[];
  memoryBytes: number;
  project: string;
  slug: string;
  worktreePath: string;
};
type PierProjectResource = {
  containerCount: number;
  error: string;
  memoryBytes: number;
  pierProject: string;
  projectId: string;
  projectName: string;
  workloads: PierWorkloadResource[];
};
type PierResourceSnapshot = {
  available: boolean;
  containerCount: number;
  error: string;
  errors: Array<{ message: string; projectId: string; projectName: string }>;
  memoryBytes: number;
  projects: PierProjectResource[];
  workloads: PierWorkloadResource[];
};
type FetchJson = (url: string) => Promise<unknown>;
type PierResourceCollectorOptions = {
  execFileAsync: ExecFileAsync;
  fetchJson?: FetchJson;
  state?: PierResourceState;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeError(error: unknown, fallback: string): string {
  const source = error && typeof error === "object"
    ? error as { message?: unknown; stderr?: unknown; stdout?: unknown }
    : {};
  return normalizeText(source.stderr) || normalizeText(source.stdout) || normalizeText(source.message) || fallback;
}

function normalizePath(value: unknown): string {
  return normalizeText(value).replace(/[/\\]+$/g, "");
}

function pathsOverlap(left: string, right: string): boolean {
  return Boolean(left && right) && (left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseByteSize(value: unknown): number {
  const match = normalizeText(value).match(/^([\d.]+)\s*([kmgt]?i?b)$/i);
  if (!match) {
    return 0;
  }
  const powers: Record<string, number> = {
    b: 0,
    kb: 1,
    kib: 1,
    mb: 2,
    mib: 2,
    gb: 3,
    gib: 3,
    tb: 4,
    tib: 4
  };
  return Math.round(Number(match[1]) * (1024 ** (powers[match[2].toLowerCase()] ?? 0)));
}

function parseDockerStats(text: unknown): Map<string, number> {
  const memoryByContainer = new Map<string, number>();
  for (const line of normalizeText(text).split(/\r?\n/).filter(Boolean)) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      const name = normalizeText(entry.Name || entry.Container || entry.ID);
      const usage = normalizeText(entry.MemUsage).split("/")[0];
      if (name) {
        memoryByContainer.set(name, parseByteSize(usage));
      }
    } catch {
      // Ignore one malformed Docker stats line and retain the other samples.
    }
  }
  return memoryByContainer;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  const response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  if (!response.ok) {
    throw new Error(`Pier API returned ${response.status}.`);
  }
  return response.json();
}

function getPierApiUrl(state: PierResourceState): string {
  const config = state.pluginConfig?.global?.["boatyard.pier"] || {};
  return normalizeText(config.pierUrl || config.pierApiUrl || "http://pier.test").replace(/\/+$/g, "");
}

function findPierProjectName(
  project: PierResourceProject,
  pierProjects: Record<string, unknown>[],
  state: PierResourceState
): string {
  const projectConfig = state.pluginConfig?.projects?.[normalizeText(project.id)]?.["boatyard.pier"] || {};
  const configuredName = normalizeText(projectConfig.pierProjectName);
  if (configuredName) {
    return configuredName;
  }
  const sourcePath = normalizePath(project.sourcePath);
  return pierProjects
    .filter((candidate) => pathsOverlap(sourcePath, normalizePath(candidate.repo_path)))
    .sort((left, right) => normalizePath(right.repo_path).length - normalizePath(left.repo_path).length)
    .map((candidate) => normalizeText(candidate.name))[0] || "";
}

function isRunningWorkload(workload: PierWorkloadSource): boolean {
  return ["running", "started"].includes(normalizeText(workload.status).toLowerCase());
}

async function collectPierResourceSnapshot({
  execFileAsync,
  fetchJson = defaultFetchJson,
  state = {}
}: PierResourceCollectorOptions): Promise<PierResourceSnapshot> {
  try {
    const apiUrl = getPierApiUrl(state);
    const rawProjects = await fetchJson(`${apiUrl}/api/v1/projects`);
    const pierProjects = Array.isArray(rawProjects) ? rawProjects.filter(isRecord) : [];
    const pierProjectsByName = new Map(pierProjects.map((project) => [normalizeText(project.name), project]));
    const projectMappings = (state.projects || []).flatMap((project) => {
      const pierProject = findPierProjectName(project, pierProjects, state);
      if (!pierProject || !pierProjectsByName.has(pierProject)) {
        return [];
      }
      return [{
        pierProject,
        projectId: normalizeText(project.id),
        projectName: normalizeText(project.name || project.slug || project.id) || "Project",
        sourcePath: normalizePath(project.sourcePath)
      }];
    });
    const projectNames = new Set(projectMappings.map((mapping) => mapping.pierProject));
    const worktreeResults = await Promise.all([...projectNames].map(async (projectName) => {
      if (pierProjectsByName.get(projectName)?.has_manifest === false) {
        return { error: "", projectName, worktrees: [] };
      }
      try {
        return {
          error: "",
          projectName,
          worktrees: await fetchJson(`${apiUrl}/api/v1/projects/${encodeURIComponent(projectName)}/worktrees`)
        };
      } catch (error) {
        return {
          error: normalizeError(error, "Could not inspect this Pier project."),
          projectName,
          worktrees: []
        };
      }
    }));
    const projectErrors: PierResourceSnapshot["errors"] = [];
    const workloads: PierWorkloadResource[] = [];
    for (const result of worktreeResults) {
      const mappings = projectMappings.filter((mapping) => mapping.pierProject === result.projectName);
      if (result.error) {
        for (const mapping of mappings) {
          projectErrors.push({
            message: result.error,
            projectId: mapping.projectId,
            projectName: mapping.projectName
          });
        }
        continue;
      }
      for (const entry of Array.isArray(result.worktrees) ? result.worktrees : []) {
        const worktree = isRecord(entry) ? entry as PierWorktreeSource : {};
        const workload = isRecord(worktree.workload) ? worktree.workload as PierWorkloadSource : {};
        if (worktree.has_workload !== true || !isRunningWorkload(workload)) {
          continue;
        }
        const worktreePath = normalizePath(worktree.path || workload.worktree_path);
        const projectMapping = mappings
          .filter((mapping) => pathsOverlap(mapping.sourcePath, worktreePath))
          .sort((left, right) => right.sourcePath.length - left.sourcePath.length)[0] || mappings[0];
        if (!projectMapping) {
          continue;
        }
        const containers = Array.isArray(workload.containers) ? workload.containers : [];
        const containerNames = containers
          .filter((container) => !normalizeText(container.status) || normalizeText(container.status).toLowerCase() === "running")
          .map((container) => normalizeText(container.name))
          .filter(Boolean);
        workloads.push({
          boatyardProjectId: projectMapping.projectId,
          boatyardProjectName: projectMapping.projectName,
          project: normalizeText(workload.project) || result.projectName,
          slug: normalizeText(workload.slug) || "main",
          containerNames,
          containerCount: containerNames.length,
          memoryBytes: 0,
          worktreePath
        });
      }
    }

    const allContainerNames = [...new Set(workloads.flatMap((workload) => workload.containerNames))];
    let memoryByContainer = new Map<string, number>();
    let dockerError = "";
    if (allContainerNames.length) {
      try {
        const stats = await execFileAsync(
          "docker",
          ["stats", "--no-stream", "--format", "{{json .}}", ...allContainerNames],
          { timeout: 15000, windowsHide: true }
        );
        memoryByContainer = parseDockerStats(stats.stdout);
      } catch (error) {
        dockerError = normalizeError(error, "Could not read Docker memory.");
      }
    }
    for (const workload of workloads) {
      workload.memoryBytes = workload.containerNames.reduce(
        (total, name) => total + (memoryByContainer.get(name) || 0),
        0
      );
    }
    const projects = projectMappings.map((mapping) => {
      const projectWorkloads = workloads.filter((workload) => workload.boatyardProjectId === mapping.projectId);
      const containerNames = new Set(projectWorkloads.flatMap((workload) => workload.containerNames));
      return {
        containerCount: containerNames.size,
        error: projectErrors.find((error) => error.projectId === mapping.projectId)?.message || "",
        memoryBytes: [...containerNames].reduce((total, name) => total + (memoryByContainer.get(name) || 0), 0),
        pierProject: mapping.pierProject,
        projectId: mapping.projectId,
        projectName: mapping.projectName,
        workloads: projectWorkloads
      };
    })
      .filter((project) => project.workloads.length > 0)
      .sort((left, right) => left.projectName.localeCompare(right.projectName));
    return {
      available: true,
      containerCount: allContainerNames.length,
      error: dockerError,
      errors: projectErrors,
      memoryBytes: [...memoryByContainer.values()].reduce((total, value) => total + value, 0),
      projects,
      workloads: workloads.sort((left, right) => `${left.project}/${left.slug}`.localeCompare(`${right.project}/${right.slug}`))
    };
  } catch (error) {
    return {
      available: false,
      containerCount: 0,
      error: normalizeError(error, "Could not inspect Pier."),
      errors: [],
      memoryBytes: 0,
      projects: [],
      workloads: []
    };
  }
}

async function collectPierResourceProvider(
  options: PierResourceCollectorOptions
): Promise<PluginResourceProviderResult> {
  const snapshot = await collectPierResourceSnapshot(options);
  return {
    data: snapshot,
    exclusiveMemoryBytes: snapshot.memoryBytes
  };
}

export {
  PIER_RESOURCE_PROVIDER_ID,
  collectPierResourceProvider,
  collectPierResourceSnapshot,
  parseByteSize,
  parseDockerStats
};

export type { PierResourceCollectorOptions, PierResourceSnapshot, PierResourceState };
