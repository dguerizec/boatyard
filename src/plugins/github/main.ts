"use strict";

import type { ExecFileAsync, PluginActions } from "../../shared/pluginTypes";

const { createGitHubService } = require("./service");

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type ProjectPayload = {
  force?: boolean;
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

  ctx.actions.handle<ProjectPayload>("actionsSnapshotForProject", ({ force = false, project = {} } = {}) => {
    return service.actionsSnapshotForProject(project, { force });
  });
}

export { activate };
