"use strict";

(function registerGitHubPlugin(globalScope: BoatyardPluginRendererGlobal) {
  const registry = globalScope.BoatyardPluginRegistry;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  registry.register(
    {
      id: "boatyard.github",
      name: "GitHub",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {},
      permissions: [
        "system:exec"
      ]
    },
    {
      activate(ctx) {
        ctx.status.set({
          state: "ready",
          summary: "GitHub integration is available"
        });
      }
    }
  );
})(window);
