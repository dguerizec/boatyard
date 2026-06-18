"use strict";

const {
  aliasTwiccProjectProcessStatuses,
  createTwiccProject,
  inspectTwiccProject,
  loadTwiccProcesses,
  loadTwiccProjects,
  getTwiccProjectProcessStatuses
} = require("./service");

function activate(ctx) {
  ctx.actions.handle("createProject", ({ sourcePath } = {}) => {
    return createTwiccProject(sourcePath, { execFileAsync: ctx.execFileAsync });
  });

  ctx.actions.handle("projectProcessStatuses", () => {
    return loadTwiccProcesses({ execFileAsync: ctx.execFileAsync })
      .then(async (processes) => aliasTwiccProjectProcessStatuses(
        getTwiccProjectProcessStatuses(processes),
        await loadTwiccProjects({ execFileAsync: ctx.execFileAsync }),
        ctx.getState()?.projects || []
      ));
  });

  ctx.projectInspectors.register(async ({ sourcePath } = {}) => {
    const project = await inspectTwiccProject(sourcePath, { execFileAsync: ctx.execFileAsync });
    return {
      matchType: project?.matchType || "",
      projectUrl: project?.url || ""
    };
  });
}

module.exports = { activate };
