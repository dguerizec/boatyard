"use strict";

function activate(ctx) {
  ctx.stateMigrations.register(({ state }) => {
    const projectPluginConfig = [];

    for (const project of state.projects || []) {
      if (!project.previewUrl) {
        continue;
      }

      const current = state.pluginConfig?.projects?.[project.id]?.[ctx.plugin.id] || {};
      if (current.pierPreviewUrl) {
        continue;
      }

      projectPluginConfig.push({
        projectId: project.id,
        config: {
          pierPreviewUrl: project.previewUrl
        }
      });
    }

    return { projectPluginConfig };
  });
}

module.exports = { activate };
