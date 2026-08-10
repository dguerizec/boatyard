"use strict";

import type { ExecFileAsync, PluginActions, PluginEvents, PluginStateMigrations } from "../../shared/pluginTypes";

const { createGitHubService, resolveGitHubRepository } = require("./service");
const { createGitHubPollingCoordinator } = require("./polling");

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
  events: PluginEvents;
  execFileAsync: ExecFileAsync;
  stateMigrations: PluginStateMigrations<GitHubStoreState>;
};

function activate(ctx: GitHubPluginContext) {
  const service = createGitHubService({
    execFileAsync: ctx.execFileAsync
  });
  const polling = createGitHubPollingCoordinator({
    service,
    emit: (state: unknown) => ctx.events.emit("pollingChannelState", state)
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

  ctx.actions.handle("syncPollingSubscriptions", (payload: unknown = {}) => {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    return {
      channels: polling.syncClient(source.clientId, source.subscriptions)
    };
  });

  ctx.actions.handle("refreshPollingChannel", (payload: unknown = {}) => {
    const source = payload && typeof payload === "object" ? payload as Record<string, unknown> : {};
    return polling.refresh(source.channel, source.project);
  });
}

export { activate };
