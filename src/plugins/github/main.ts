"use strict";

import type { ExecFileAsync, PluginActions } from "../../shared/pluginTypes";

const { getGitHubProjectStatus } = require("./service");

type GitHubProject = {
  gitUrl?: unknown;
  repoUrl?: unknown;
};

type ProjectPayload = {
  project?: GitHubProject;
};

type GitHubPluginContext = {
  actions: PluginActions;
  execFileAsync: ExecFileAsync;
};

function activate(ctx: GitHubPluginContext) {
  ctx.actions.handle<ProjectPayload>("statusForProject", ({ project = {} } = {}) => {
    return getGitHubProjectStatus(project, {
      execFileAsync: ctx.execFileAsync
    });
  });
}

export { activate };
