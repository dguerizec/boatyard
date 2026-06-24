"use strict";

(function registerHawserPlugin(globalScope) {
  type HawserProject = {
    id?: string;
    slug?: string;
    devBranch?: string;
  };

  type HawserConfig = {
    hawserApiUrl?: string;
    hawserDefaultRuntime?: string;
    hawserMainSession?: string;
    hawserProjectUrl?: string;
    hawserToken?: string;
  };

  type HawserPluginOptions = {
    pluginConfig?: HawserConfig;
    globalPluginConfig?: HawserConfig;
    twiccProjectConfig?: Record<string, unknown>;
    allProjectPluginConfig?: Record<string, Record<string, unknown>>;
  };

  type HawserGlobal = Window & {
    BoatyardHawserUI?: any;
    BoatyardPaneNavigation?: {
      openProjectWebApp?: (projectId: string | undefined, webAppId: string, url: string) => void;
    };
    BoatyardPluginRegistry?: PluginRegistryApi;
    boatyard?: {
      invokePlugin?: (pluginId: string, actionName: string, payload: unknown) => Promise<any>;
      writeClipboardText?: (value: string) => Promise<unknown>;
    };
  };

  type TwiccRendererService = PluginRegistryRecord & {
    getSessionUrl?: (
      project: HawserProject,
      sessionId: unknown,
      options?: { pluginConfig?: Record<string, unknown> }
    ) => string;
  };

  const typedGlobalScope = globalScope as unknown as HawserGlobal;
  const registry = typedGlobalScope.BoatyardPluginRegistry;
  const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082/";
  const DEFAULT_HAWSER_WEB_URL = "http://localhost:60082";
  const DEFAULT_HAWSER_RUNTIME = "codex";
  const HAWSER_INSTALL_COMMAND = "bash <(curl -fsSL https://raw.githubusercontent.com/dguerizec/hawser/main/install.sh) && hawser service install";
  const HAWSER_INSTALL_REQUIREMENTS = "Requires Linux x86_64, curl, bash, sha256sum, tar, and systemd --user.";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName, payload = {}) {
    return typedGlobalScope.boatyard?.invokePlugin?.("boatyard.hawser", actionName, payload);
  }

  function normalizeApiUrl(value) {
    return String(value || DEFAULT_HAWSER_API_URL).replace(/\/+$/g, "");
  }

  function getDefaultMainSession(project: HawserProject = {}) {
    const slug = String(project.slug || "").trim();
    const branch = String(project.devBranch || "").trim() || "main";
    return slug ? `${slug}:${branch}` : "";
  }

  function getDefaultProjectUrl(project: HawserProject = {}) {
    const slug = String(project.slug || "").trim();
    return slug ? `${DEFAULT_HAWSER_WEB_URL}/#/projects/${encodeURIComponent(slug)}` : "";
  }

  function getProjectUrl(projectName) {
    const name = String(projectName || "").trim();
    return name ? `${DEFAULT_HAWSER_WEB_URL}/#/projects/${encodeURIComponent(name)}` : "";
  }

  function getMainSession(projectName, branch) {
    const name = String(projectName || "").trim();
    const session = String(branch || "").trim() || "main";
    return name ? `${name}:${session}` : "";
  }

  function getDefaultRuntime(globalConfig: HawserConfig = {}) {
    return String(globalConfig.hawserDefaultRuntime || DEFAULT_HAWSER_RUNTIME).trim() || DEFAULT_HAWSER_RUNTIME;
  }

  function resolveMainSession(project: HawserProject, options: HawserPluginOptions = {}) {
    return options.pluginConfig?.hawserMainSession || getDefaultMainSession(project);
  }

  function resolveProjectUrl(project: HawserProject, options: HawserPluginOptions = {}) {
    return options.pluginConfig?.hawserProjectUrl || getDefaultProjectUrl(project);
  }

  function addTwiccSessionUrls(project: HawserProject, data, options: HawserPluginOptions = {}) {
    const twicc = registry.getService<TwiccRendererService>("boatyard.twicc.api");
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
      getApiUrl(options: HawserPluginOptions = {}) {
        return normalizeApiUrl(options.globalPluginConfig?.hawserApiUrl);
      },
      getMainSession: resolveMainSession,
      getProjectUrl: resolveProjectUrl,
      async getWidgetData(project: HawserProject, options: HawserPluginOptions = {}) {
        const data = await invokePlugin("widgetDataForConfig", {
          projectId: project.id,
          projectConfig: {
            hawserMainSession: resolveMainSession(project, options)
          },
          globalConfig: {
            hawserApiUrl: options.globalPluginConfig?.hawserApiUrl,
            hawserToken: options.globalPluginConfig?.hawserToken
          }
        });
        return addTwiccSessionUrls(project, data, options);
      }
    });
  }

  async function refreshHawserStatus(ctx, globalConfig = {}) {
    if (typeof typedGlobalScope.boatyard?.invokePlugin !== "function") {
      ctx.status.set({
        state: "degraded",
        summary: "Hawser status probe is unavailable."
      });
      return;
    }

    try {
      ctx.status.set(await invokePlugin("statusForConfig", { globalConfig }));
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

  function syncProjectRegistrationFields(event) {
    const fields = event.fields;
    const inspected = event.inspected?.plugins?.["boatyard.hawser"] || {};
    const coreFields = event.coreFields || {};

    if (!fields) {
      return;
    }

    fields.setActionVisible("hawserMainSession", false);

    if (inspected.projectName && inspected.matchType === "exact") {
      const mainSession = getMainSession(inspected.projectName, coreFields.devBranch);
      const projectUrl = inspected.projectUrl || getProjectUrl(inspected.projectName);

      fields.setValue("hawserMainSession", mainSession, { ifUnedited: true });
      fields.setValue("hawserProjectUrl", projectUrl, { ifUnedited: true });
    } else if (String(event.sourcePath || "").trim()) {
      fields.setActionVisible("hawserMainSession", true);
    }
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
        ctx.events.on("boatyard.projectForm.sourcePathInspected", syncProjectRegistrationFields);
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
              key: "hawserDefaultRuntime",
              label: "Default runtime",
              type: "text",
              valueType: "text",
              placeholder: DEFAULT_HAWSER_RUNTIME,
              defaultValue: DEFAULT_HAWSER_RUNTIME
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
                  await typedGlobalScope.boatyard?.writeClipboardText?.(command);
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
              },
              action: {
                label: "Create",
                pendingLabel: "Creating...",
                message: "Hawser project not found. Register it?",
                async run({ coreFields, fields, globalConfig }) {
                  const sourcePath = String(coreFields.sourcePath || "").trim();
                  if (!sourcePath) {
                    throw new Error("Source path is required to create a Hawser project.");
                  }

                  const created = await invokePlugin("createProject", {
                    sourcePath,
                    runtime: getDefaultRuntime(globalConfig)
                  });
                  if (!created?.name) {
                    throw new Error("Hawser project was created but no project name was returned.");
                  }

                  fields.setValue("hawserMainSession", getMainSession(created.name, coreFields.devBranch), { markEdited: true });
                  fields.setValue("hawserProjectUrl", created.url || getProjectUrl(created.name), { markEdited: true });
                  fields.setActionVisible("hawserMainSession", false);
                }
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
          createElement(project: HawserProject, props: HawserPluginOptions = {}) {
            return typedGlobalScope.BoatyardHawserUI.createWidget(project, {
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
                  typedGlobalScope.BoatyardPaneNavigation?.openProjectWebApp?.(project.id, "hawser", message.twiccSessionUrl);
                }
              }
            });
          }
        });
      }
    }
  );
})(window);
