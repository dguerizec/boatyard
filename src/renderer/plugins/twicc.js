"use strict";

(function registerTwiccPlugin(globalScope) {
  const registry = globalScope.DashtopPluginRegistry;
  const DEFAULT_TWICC_URL = "http://localhost:3500";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function normalizeBaseUrl(value) {
    return String(value || DEFAULT_TWICC_URL).replace(/\/+$/g, "");
  }

  function resolveProjectUrl(project, options = {}) {
    return options.pluginConfig?.twiccProjectUrl || "";
  }

  function createTwiccService() {
    return Object.freeze({
      version: "0.1.0",
      getBaseUrl(options = {}) {
        return normalizeBaseUrl(options.globalPluginConfig?.twiccBaseUrl);
      },
      getProjectUrl: resolveProjectUrl,
      openProject(project, options = {}) {
        const url = resolveProjectUrl(project, options);
        return url ? globalScope.dashtop.openExternal(url) : null;
      }
    });
  }

  function syncProjectUrlField(event) {
    const fields = event.fields;
    const inspected = event.inspected || {};
    const currentValue = fields?.getValue("twiccProjectUrl") || "";
    const canReplace = !fields?.isEdited("twiccProjectUrl") || !currentValue.trim();

    if (!fields || !canReplace) {
      return;
    }

    if (inspected.twiccProjectUrl && inspected.twiccMatchType === "exact") {
      fields.setValue("twiccProjectUrl", inspected.twiccProjectUrl);
    } else if (inspected.twiccMatchType === "parent") {
      fields.setValue("twiccProjectUrl", "");
    }
  }

  registry.register(
    {
      id: "dashtop.twicc",
      name: "Twicc",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        panes: ["dashtop.twicc.pane"],
        globalSettings: ["dashtop.twicc.global"],
        projectSettings: ["dashtop.twicc.project"],
        services: ["dashtop.twicc.api"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:wcv",
        "service:provide"
      ]
    },
    {
      activate(ctx) {
        const twiccService = createTwiccService();
        ctx.services.provide("dashtop.twicc.api", twiccService);
        ctx.events.on("dashtop.projectForm.sourcePathInspected", syncProjectUrlField);

        ctx.status.set({
          state: "ready",
          summary: "Twicc integration is available"
        });

        ctx.settings.registerGlobalSection({
          id: "dashtop.twicc.global",
          title: "Twicc",
          fields: [
            {
              key: "twiccBaseUrl",
              label: "Twicc base URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_TWICC_URL
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "dashtop.twicc.project",
          title: "Twicc",
          fields: [
            {
              key: "twiccProjectUrl",
              label: "Twicc project URL",
              type: "text",
              valueType: "url",
              placeholder: `${DEFAULT_TWICC_URL}/project/example`
            }
          ]
        });

        ctx.panes.register({
          id: "dashtop.twicc.pane",
          webAppId: "twicc-plugin",
          key: "twicc-plugin",
          title: "Twicc",
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig }) {
            return twiccService.getProjectUrl(project, { pluginConfig: projectConfig });
          }
        });
      }
    }
  );
})(window);
