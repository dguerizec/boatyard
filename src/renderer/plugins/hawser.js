"use strict";

(function registerHawserPlugin(globalScope) {
  const registry = globalScope.DashtopPluginRegistry;
  const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082/";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function normalizeApiUrl(value) {
    return String(value || DEFAULT_HAWSER_API_URL).replace(/\/+$/g, "");
  }

  function getDefaultMainSession(project = {}) {
    const slug = String(project.slug || "").trim();
    const branch = String(project.devBranch || "").trim() || "main";
    return slug ? `${slug}:${branch}` : "";
  }

  function resolveMainSession(project, options = {}) {
    return options.pluginConfig?.hawserMainSession || getDefaultMainSession(project);
  }

  function createHawserService() {
    return Object.freeze({
      version: "0.1.0",
      getApiUrl(options = {}) {
        return normalizeApiUrl(options.globalPluginConfig?.hawserApiUrl);
      },
      getMainSession: resolveMainSession,
      getWidgetData(project, options = {}) {
        return globalScope.dashtop.getHawserWidgetDataForConfig(
          project.id,
          {
            hawserMainSession: resolveMainSession(project, options)
          },
          {
            hawserApiUrl: options.globalPluginConfig?.hawserApiUrl,
            hawserToken: options.globalPluginConfig?.hawserToken
          }
        );
      }
    });
  }

  function syncMainSessionField(event) {
    if (!["slug", "devBranch"].includes(event.field)) {
      return;
    }

    const fields = event.fields;
    fields?.setDefaultValue("hawserMainSession", getDefaultMainSession(event.coreFields));
  }

  registry.register(
    {
      id: "dashtop.hawser",
      name: "Hawser",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["dashtop.hawser.inbox"],
        globalSettings: ["dashtop.hawser.global"],
        projectSettings: ["dashtop.hawser.project"],
        services: ["dashtop.hawser.api"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "service:provide"
      ]
    },
    {
      activate(ctx) {
        const hawserService = createHawserService();
        ctx.services.provide("dashtop.hawser.api", hawserService);
        ctx.events.on("dashtop.projectForm.coreFieldChanged", syncMainSessionField);

        ctx.status.set({
          state: "ready",
          summary: "Hawser integration is available"
        });

        ctx.settings.registerGlobalSection({
          id: "dashtop.hawser.global",
          title: "Hawser",
          fields: [
            {
              key: "hawserApiUrl",
              label: "API URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_HAWSER_API_URL
            },
            {
              key: "hawserToken",
              label: "API token",
              type: "password",
              valueType: "text"
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "dashtop.hawser.project",
          title: "Hawser",
          fields: [
            {
              key: "hawserMainSession",
              label: "Hawser main session",
              type: "text",
              valueType: "text",
              placeholder: "project:main",
              defaultValue({ project }) {
                return getDefaultMainSession(project);
              }
            }
          ]
        });

        ctx.widgets.register({
          id: "dashtop.hawser.inbox",
          name: "Hawser",
          title: "Hawser",
          scope: "project",
          category: "Developer tools",
          status: "experimental",
          defaultVisible: false,
          description: "Shows Hawser inbox counts and active task status for the project.",
          layout: {
            default: { columns: 2, rows: 3 },
            min: { columns: 2, rows: 2 },
            max: { columns: 4, rows: 6 }
          },
          createElement(project, props = {}) {
            return globalScope.DashtopHawserUI.createWidget(project, {
              title: "Hawser",
              subtitle: hawserService.getMainSession(project, {
                pluginConfig: props.pluginConfig
              }),
              loadData: () => hawserService.getWidgetData(project, {
                pluginConfig: props.pluginConfig,
                globalPluginConfig: props.globalPluginConfig
              })
            });
          }
        });
      }
    }
  );
})(window);
