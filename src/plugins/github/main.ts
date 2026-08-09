"use strict";

import type { ExecFileAsync, PluginActions, PluginStateMigrations } from "../../shared/pluginTypes";

const { createGitHubService, resolveGitHubRepository } = require("./service");

type GitHubProject = {
  id?: unknown;
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type GitHubStoreState = {
  projects?: GitHubProject[];
};

type GitHubRequestPriority = "background" | "foreground" | "interactive";

type ProjectPayload = {
  force?: boolean;
  priority?: GitHubRequestPriority;
  project?: GitHubProject;
};

type GitHubPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
  stateMigrations: PluginStateMigrations<GitHubStoreState>;
};

function activate(ctx: GitHubPluginContext) {
  const service = createGitHubService({
    execFileAsync: ctx.execFileAsync
  });

  ctx.stateMigrations.register(({ state }) => ({
    webAppMigrations: (state.projects || [])
      .filter((project) => Boolean(project.id && resolveGitHubRepository(project)))
      .map((project) => ({
        projectId: String(project.id),
        sourceKey: "repo",
        sourceWebAppId: "repo",
        targetKey: "github",
        targetWebAppId: "boatyard.github.repository"
      }))
  }));

  ctx.actions.handle<ProjectPayload>("statusForProject", ({ force = false, project = {} } = {}) => {
    return service.statusForProject(project, { force });
  });

  ctx.actions.handle<ProjectPayload>("actionsSnapshotForProject", ({ force = false, priority, project = {} } = {}) => {
    return service.actionsSnapshotForProject(project, { force, priority });
  });

  ctx.actions.handle<ProjectPayload>("pullRequestsSnapshotForProject", ({ force = false, priority, project = {} } = {}) => {
    return service.pullRequestsSnapshotForProject(project, { force, priority });
  });
}

export { activate };
