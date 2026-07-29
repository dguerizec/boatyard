"use strict";

import type { ExecFileAsync } from "../../shared/pluginTypes";

const { execFile } = require("node:child_process");
const { promisify } = require("node:util");

const runExecFile = promisify(execFile);
const DEFAULT_GITHUB_HOST = "github.com";
const GITHUB_COMMAND_TIMEOUT_MS = 5000;

type UnknownRecord = Record<string, unknown>;

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type GitHubRepositoryRef = {
  host: string;
  owner: string;
  repo: string;
};

type GitHubProjectStatus = {
  state: "ready" | "notConfigured" | "unavailable" | "error";
  summary: string;
  details: {
    authenticated: boolean;
    host: string;
    owner: string;
    repo: string;
  };
};

type GitHubCommandOptions = {
  execFileAsync?: ExecFileAsync;
};

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeGitHubHost(value: unknown): string {
  const host = normalizeText(value).toLowerCase().replace(/\.$/, "");
  return host === "www.github.com" ? DEFAULT_GITHUB_HOST : host;
}

function isSupportedGitHubHost(value: unknown): boolean {
  return normalizeGitHubHost(value) === DEFAULT_GITHUB_HOST;
}

function normalizeRepositoryPath(pathname: unknown): Pick<GitHubRepositoryRef, "owner" | "repo"> | null {
  const parts = normalizeText(pathname)
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  const owner = parts[0];
  const repo = parts[1].replace(/\.git$/i, "");
  if (!owner || !repo) {
    return null;
  }

  return { owner, repo };
}

function parseGitHubRepositoryUrl(value: unknown): GitHubRepositoryRef | null {
  const source = normalizeText(value);
  if (!source) {
    return null;
  }

  const scpMatch = source.match(/^(?:[^@\s]+@)?([^:/\s]+):(.+)$/);
  if (scpMatch && !source.includes("://")) {
    const host = normalizeGitHubHost(scpMatch[1]);
    const repository = normalizeRepositoryPath(scpMatch[2]);
    return isSupportedGitHubHost(host) && repository
      ? { host, ...repository }
      : null;
  }

  try {
    const parsed = new URL(source);
    const host = normalizeGitHubHost(parsed.hostname);
    const repository = normalizeRepositoryPath(parsed.pathname);
    return isSupportedGitHubHost(host) && repository
      ? { host, ...repository }
      : null;
  } catch {
    return null;
  }
}

function resolveGitHubRepository(project: GitHubProject = {}): GitHubRepositoryRef | null {
  return parseGitHubRepositoryUrl(project.repoUrl)
    || parseGitHubRepositoryUrl(project.gitUrl);
}

function getErrorCode(error: unknown): string {
  return isRecord(error) ? normalizeText(error.code) : "";
}

function getErrorOutput(error: unknown): string {
  if (!isRecord(error)) {
    return error instanceof Error ? error.message : normalizeText(error);
  }

  return [
    error.stderr,
    error.stdout,
    error.message
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function isAuthenticationError(error: unknown): boolean {
  return /not logged in|authentication failed|authenticate|no accounts/i.test(getErrorOutput(error));
}

function emptyStatusDetails(repository: GitHubRepositoryRef | null): GitHubProjectStatus["details"] {
  return {
    authenticated: false,
    host: repository?.host || "",
    owner: repository?.owner || "",
    repo: repository?.repo || ""
  };
}

async function getGitHubProjectStatus(
  project: GitHubProject = {},
  { execFileAsync = runExecFile }: GitHubCommandOptions = {}
): Promise<GitHubProjectStatus> {
  const repository = resolveGitHubRepository(project);
  if (!repository) {
    return {
      state: "notConfigured",
      summary: "This project does not have a supported GitHub repository.",
      details: emptyStatusDetails(null)
    };
  }

  try {
    await execFileAsync("gh", ["auth", "status", "--hostname", repository.host], {
      timeout: GITHUB_COMMAND_TIMEOUT_MS,
      windowsHide: true
    });
    return {
      state: "ready",
      summary: `Authenticated for ${repository.owner}/${repository.repo}.`,
      details: {
        ...emptyStatusDetails(repository),
        authenticated: true
      }
    };
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") {
      return {
        state: "unavailable",
        summary: "GitHub CLI was not found in PATH.",
        details: emptyStatusDetails(repository)
      };
    }

    if (isAuthenticationError(error)) {
      return {
        state: "notConfigured",
        summary: `Authenticate GitHub CLI for ${repository.host}.`,
        details: emptyStatusDetails(repository)
      };
    }

    return {
      state: "error",
      summary: "Could not verify GitHub CLI authentication.",
      details: emptyStatusDetails(repository)
    };
  }
}

module.exports = {
  DEFAULT_GITHUB_HOST,
  getGitHubProjectStatus,
  isSupportedGitHubHost,
  normalizeGitHubHost,
  parseGitHubRepositoryUrl,
  resolveGitHubRepository
};

export {};
