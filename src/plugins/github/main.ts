"use strict";

import type { ExecFileAsync, PluginActions } from "../../shared/pluginTypes";

const { createGitHubService } = require("./service");

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
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
};

function activate(ctx: GitHubPluginContext) {
  const service = createGitHubService({
    execFileAsync: ctx.execFileAsync
  });

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
