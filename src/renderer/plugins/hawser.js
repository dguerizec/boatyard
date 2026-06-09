"use strict";

(function registerHawserPlugin(globalScope) {
  const registry = globalScope.BoatyardPluginRegistry;
  const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082/";
  const DEFAULT_HAWSER_WEB_URL = "http://localhost:60082";
  const HAWSER_INSTALL_COMMAND = "bash <(curl -fsSL https://raw.githubusercontent.com/dguerizec/hawser/main/install.sh) && hawser service install";
  const HAWSER_INSTALL_REQUIREMENTS = "Requires Linux x86_64, curl, bash, sha256sum, tar, and systemd --user.";

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

  function getDefaultProjectUrl(project = {}) {
    const slug = String(project.slug || "").trim();
    return slug ? `${DEFAULT_HAWSER_WEB_URL}/#/projects/${encodeURIComponent(slug)}` : "";
  }

  function resolveMainSession(project, options = {}) {
    return options.pluginConfig?.hawserMainSession || getDefaultMainSession(project);
  }

  function resolveProjectUrl(project, options = {}) {
    return options.pluginConfig?.hawserProjectUrl || getDefaultProjectUrl(project);
  }

  function addTwiccSessionUrls(project, data, options = {}) {
    const twicc = registry.getService("boatyard.twicc.api");
    if (!twicc || !Array.isArray(data?.messages)) {
      return data;
    }

    return {
      ...data,
      messages: data.messages.map((message) => ({
        ...message,
        twiccSessionUrl: twicc.getSessionUrl?.(project, message.twiccSessionId, {
          pluginConfig: options.twiccProjectConfig
        }) || ""
      }))
    };
  }

  function createHawserService() {
    return Object.freeze({
      version: "0.1.0",
      getApiUrl(options = {}) {
        return normalizeApiUrl(options.globalPluginConfig?.hawserApiUrl);
      },
      getMainSession: resolveMainSession,
      getProjectUrl: resolveProjectUrl,
      async getWidgetData(project, options = {}) {
        const data = await globalScope.boatyard.getHawserWidgetDataForConfig(
          project.id,
          {
            hawserMainSession: resolveMainSession(project, options)
          },
          {
            hawserApiUrl: options.globalPluginConfig?.hawserApiUrl,
            hawserToken: options.globalPluginConfig?.hawserToken
          }
        );
        return addTwiccSessionUrls(project, data, options);
      }
    });
  }

  async function refreshHawserStatus(ctx, globalConfig = {}) {
    if (typeof globalScope.boatyard.getHawserStatusForConfig !== "function") {
      ctx.status.set({
        state: "degraded",
        summary: "Hawser status probe is unavailable."
      });
      return;
    }

    try {
      ctx.status.set(await globalScope.boatyard.getHawserStatusForConfig(globalConfig));
    } catch (error) {
      ctx.status.set({
        state: "unavailable",
        summary: error.message
      });
    }
  }

  function syncMainSessionField(event) {
    if (!["slug", "devBranch"].includes(event.field)) {
      return;
    }

    const fields = event.fields;
    fields?.setDefaultValue("hawserMainSession", getDefaultMainSession(event.coreFields));
    fields?.setDefaultValue("hawserProjectUrl", getDefaultProjectUrl(event.coreFields));
  }

  registry.register(
    {
      id: "boatyard.hawser",
      name: "Hawser",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.hawser.inbox"],
        panes: ["boatyard.hawser.pane"],
        globalSettings: ["boatyard.hawser.global"],
        projectSettings: ["boatyard.hawser.project"],
        services: ["boatyard.hawser.api"]
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
        const hawserService = createHawserService();
        ctx.services.provide("boatyard.hawser.api", hawserService);
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncMainSessionField);
        ctx.events.on("boatyard.globalSettings.opened", (event) => {
          refreshHawserStatus(ctx, event.globalConfig || {});
        });

        ctx.status.set({
          state: "activating",
          summary: "Checking Hawser availability..."
        });
        refreshHawserStatus(ctx);

        ctx.settings.registerGlobalSection({
          id: "boatyard.hawser.global",
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
            },
            {
              key: "hawserInstallCommand",
              label: "Install command",
              type: "text",
              valueType: "text",
              readOnly: true,
              persist: false,
              defaultValue: HAWSER_INSTALL_COMMAND,
              action: {
                label: "Copy",
                pendingLabel: "Copying...",
                message: `Use this if Hawser is not installed or the local service is unavailable. ${HAWSER_INSTALL_REQUIREMENTS}`,
                hidden: false,
                async run({ fields }) {
                  const command = fields.getValue("hawserInstallCommand") || HAWSER_INSTALL_COMMAND;
                  await globalScope.boatyard.writeClipboardText(command);
                  fields.setActionMessage("hawserInstallCommand", "Install command copied.");
                }
              }
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.hawser.project",
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
            },
            {
              key: "hawserProjectUrl",
              label: "Hawser project URL",
              type: "text",
              valueType: "url",
              placeholder: `${DEFAULT_HAWSER_WEB_URL}/#/projects/project`,
              defaultValue({ project }) {
                return getDefaultProjectUrl(project);
              }
            }
          ]
        });

        ctx.panes.register({
          id: "boatyard.hawser.pane",
          webAppId: "hawser",
          key: "hawser",
          title: "Hawser",
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig }) {
            return hawserService.getProjectUrl(project, { pluginConfig: projectConfig });
          }
        });

        ctx.widgets.register({
          id: "boatyard.hawser.inbox",
          name: "Hawser",
          title: "Hawser",
          scope: "project",
          category: "Developer tools",
          status: "experimental",
          defaultVisible: false,
          description: "Shows Hawser inbox counts and active task status for the project.",
          layout: {
            default: { columns: 3, rows: 3 },
            min: { columns: 3, rows: 3 }
          },
          createElement(project, props = {}) {
            return globalScope.BoatyardHawserUI.createWidget(project, {
              title: "Hawser",
              subtitle: hawserService.getMainSession(project, {
                pluginConfig: props.pluginConfig
              }),
              loadData: () => hawserService.getWidgetData(project, {
                pluginConfig: props.pluginConfig,
                globalPluginConfig: props.globalPluginConfig,
                twiccProjectConfig: props.allProjectPluginConfig?.["boatyard.twicc"] || {}
              }),
              onOpenMessage(message) {
                if (message.twiccSessionUrl) {
                  globalScope.BoatyardPaneNavigation.openProjectWebApp(project.id, "hawser", message.twiccSessionUrl);
                }
              }
            });
          }
        });
      }
    }
  );
})(window);
