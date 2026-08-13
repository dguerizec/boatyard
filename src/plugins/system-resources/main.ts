"use strict";

import type { PluginContext, PluginWebContentsViewResource } from "../../shared/pluginTypes";
import {
  cleanupStaleTmuxClientSessions,
  collectSystemResources,
  type CollectorOptions,
  type ResourceState,
  type TmuxCleanupReport
} from "./service.js";

type SystemResourcesContext = PluginContext<ResourceState>;

function getWebContentsViewInfo(ctx: SystemResourcesContext): {
  count: number;
  entries: PluginWebContentsViewResource[];
} {
  const entries = ctx.resources.listWebContentsViews();
  return { count: entries.length, entries };
}

function createSnapshotOptions(
  ctx: SystemResourcesContext,
  tmuxCleanup: TmuxCleanupReport | null = null
): CollectorOptions {
  return {
    execFileAsync: ctx.execFileAsync,
    collectResourceProviders: () => ctx.resources.collectProviderSnapshots(),
    rootPid: process.pid,
    sessionPrefix: process.env.BOATYARD_TERMINAL_SESSION_PREFIX || "boatyard",
    state: ctx.getState(),
    tmuxCleanup,
    webContentsViews: getWebContentsViewInfo(ctx)
  };
}

function activate(ctx: SystemResourcesContext) {
  const sessionPrefix = process.env.BOATYARD_TERMINAL_SESSION_PREFIX || "boatyard";
  let latestCleanup: TmuxCleanupReport | null = null;
  const automaticCleanup = ctx.getState()?.plugins?.enabled?.[ctx.plugin.id] === false
    ? Promise.resolve(null)
    : cleanupStaleTmuxClientSessions({
        execFileAsync: ctx.execFileAsync,
        mode: "automatic",
        sessionPrefix,
        state: ctx.getState()
      }).then((report) => {
        latestCleanup = report;
        return report;
      });

  ctx.actions.handle("snapshot", async () => {
    await automaticCleanup;
    return collectSystemResources(createSnapshotOptions(ctx, latestCleanup));
  });
  ctx.actions.handle("cleanupStaleTmuxSessions", async () => {
    await automaticCleanup;
    latestCleanup = await cleanupStaleTmuxClientSessions({
      execFileAsync: ctx.execFileAsync,
      mode: "manual",
      sessionPrefix,
      state: ctx.getState()
    });
    return latestCleanup;
  });
}

export { activate, createSnapshotOptions, getWebContentsViewInfo };
