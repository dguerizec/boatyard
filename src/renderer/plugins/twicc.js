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

  function resolveSessionUrl(project, sessionId, options = {}) {
    const projectUrl = resolveProjectUrl(project, options);
    const id = String(sessionId || "").trim();
    if (!projectUrl || !id) {
      return "";
    }

    try {
      const parsed = new URL(projectUrl);
      parsed.pathname = `${parsed.pathname.replace(/\/+$/g, "")}/session/${encodeURIComponent(id)}`;
      parsed.search = "";
      parsed.hash = "";
      return parsed.toString();
    } catch {
      return "";
    }
  }

  function createTwiccService() {
    return Object.freeze({
      version: "0.1.0",
      getBaseUrl(options = {}) {
        return normalizeBaseUrl(options.globalPluginConfig?.twiccBaseUrl);
      },
      getProjectUrl: resolveProjectUrl,
      getSessionUrl: resolveSessionUrl,
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

    if (!fields) {
      return;
    }

    fields.setActionVisible("twiccProjectUrl", false);

    if (!canReplace) {
      return;
    }

    if (inspected.twiccProjectUrl && inspected.twiccMatchType === "exact") {
      fields.setValue("twiccProjectUrl", inspected.twiccProjectUrl);
    } else if (inspected.twiccMatchType === "parent") {
      fields.setValue("twiccProjectUrl", "");
      fields.setActionVisible("twiccProjectUrl", true);
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
              placeholder: `${DEFAULT_TWICC_URL}/project/example`,
              action: {
                label: "Create",
                pendingLabel: "Creating...",
                message: "TwiCC project not found. Create it?",
                async run({ coreFields, fields }) {
                  const sourcePath = String(coreFields.sourcePath || "").trim();
                  if (!sourcePath) {
                    throw new Error("Source path is required to create a TwiCC project.");
                  }

                  const created = await globalScope.dashtop.createTwiccProject(sourcePath);
                  if (!created?.url) {
                    throw new Error("TwiCC project was created but no URL was returned.");
                  }

                  fields.setValue("twiccProjectUrl", created.url, { markEdited: true });
                  fields.setActionVisible("twiccProjectUrl", false);
                }
              }
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
