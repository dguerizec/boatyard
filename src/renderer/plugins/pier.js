"use strict";

(function registerPierPlugin(globalScope) {
  const registry = globalScope.DashtopPluginRegistry;
  const DEFAULT_PIER_API_URL = "http://127.0.0.1:60080";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function normalizePath(value) {
    return String(value || "").replace(/[/\\]+$/g, "");
  }

  function normalizeApiUrl(value) {
    return String(value || DEFAULT_PIER_API_URL).replace(/\/+$/g, "");
  }

  function findPierProject(project, pierProjects, config = {}) {
    const configuredName = String(config.pierProjectName || "").trim();
    if (configuredName) {
      return pierProjects.find((candidate) => candidate.name === configuredName) || { name: configuredName };
    }

    const sourcePath = normalizePath(project.sourcePath);
    if (!sourcePath) {
      return null;
    }

    return pierProjects
      .filter((candidate) => {
        const repoPath = normalizePath(candidate.repo_path);
        return repoPath && (sourcePath === repoPath || sourcePath.startsWith(`${repoPath}/`));
      })
      .sort((left, right) => normalizePath(right.repo_path).length - normalizePath(left.repo_path).length)[0] || null;
  }

  function getDefaultWorkloadUrl(workload) {
    const urls = Array.isArray(workload.urls) ? workload.urls : [];
    return urls.find((entry) => entry.default)?.url || urls[0]?.url || workload.url || "";
  }

  function normalizeHostnameLabel(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function getDefaultPierProjectName(project = {}) {
    return normalizeHostnameLabel(project.slug);
  }

  function getDefaultPreviewUrl(project = {}) {
    const projectName = getDefaultPierProjectName(project);
    const branch = normalizeHostnameLabel(project.devBranch || "main");
    return projectName && branch ? `http://${branch}.${projectName}.test/` : "";
  }

  function getPierApiUrl(options = {}) {
    return normalizeApiUrl(options.globalPluginConfig?.pierApiUrl);
  }

  async function fetchPierJson(path, options = {}, fetchOptions = {}) {
    const response = await fetch(`${getPierApiUrl(options)}${path}`, fetchOptions);

    if (!response.ok) {
      throw new Error(`Pier API returned ${response.status}.`);
    }

    return response.json();
  }

  async function listProjectWorkloads(project, options = {}) {
    const apiUrl = getPierApiUrl(options);
    const [projectsResponse, workloadsResponse] = await Promise.all([
      fetch(`${apiUrl}/api/v1/projects`),
      fetch(`${apiUrl}/api/v1/workloads`)
    ]);

    if (!projectsResponse.ok) {
      throw new Error(`Pier projects API returned ${projectsResponse.status}.`);
    }

    if (!workloadsResponse.ok) {
      throw new Error(`Pier workloads API returned ${workloadsResponse.status}.`);
    }

    const pierProjects = await projectsResponse.json();
    const workloads = await workloadsResponse.json();
    const pierProject = findPierProject(project, Array.isArray(pierProjects) ? pierProjects : [], options.pluginConfig);
    const pierProjectName = pierProject?.name || "";

    if (!pierProjectName) {
      return [];
    }

    return (Array.isArray(workloads) ? workloads : [])
      .filter((workload) => workload.project === pierProjectName)
      .filter((workload) => workload.status === "running")
      .map((workload) => ({
        project: workload.project,
        slug: workload.slug || workload.branch || "main",
        url: getDefaultWorkloadUrl(workload),
        worktreePath: workload.worktree_path || ""
      }))
      .filter((entry) => entry.url);
  }

  function createPierService() {
    return Object.freeze({
      listProjectWorkloads,
      down(workload, options = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project)}/${encodeURIComponent(workload.slug)}/down`,
          options,
          { method: "POST" }
        );
      },
      up(workload, options = {}) {
        return fetchPierJson(
          `/api/v1/workloads/${encodeURIComponent(workload.project)}/${encodeURIComponent(workload.slug)}/up`,
          options,
          {
            method: "POST",
            body: workload.worktreePath ? JSON.stringify({ worktree_path: workload.worktreePath }) : undefined,
            headers: workload.worktreePath ? { "Content-Type": "application/json" } : undefined
          }
        );
      },
      openUrl(url) {
        return globalScope.dashtop.openExternal(url);
      }
    });
  }

  async function copyText(value) {
    if (globalScope.dashtop?.writeClipboardText) {
      await globalScope.dashtop.writeClipboardText(value);
      return;
    }

    await navigator.clipboard.writeText(value);
  }

  function renderPierUrlRows(list, urls, props, service, onRefresh, onError) {
    list.innerHTML = "";

    for (const entry of urls) {
      const link = document.createElement("a");
      link.className = "pier-url-link";
      link.href = entry.url;
      link.textContent = entry.url;
      link.title = entry.url;
      link.addEventListener("click", (event) => {
        event.preventDefault();
        service.openUrl(entry.url);
      });

      const pathButton = document.createElement("button");
      pathButton.className = "pier-path-button";
      pathButton.type = "button";
      const pathText = document.createElement("span");
      pathText.className = "pier-path-text";
      pathText.textContent = entry.worktreePath || "No worktree path";
      pathButton.append(pathText);
      pathButton.title = entry.worktreePath ? `Copy ${entry.worktreePath}` : "";
      pathButton.disabled = !entry.worktreePath;
      pathButton.addEventListener("click", async () => {
        try {
          await copyText(entry.worktreePath);
        } catch (error) {
          onError(error);
        }
      });

      const stopButton = document.createElement("button");
      stopButton.className = "pier-stop-button";
      stopButton.type = "button";
      stopButton.textContent = "Stop";
      stopButton.addEventListener("click", async () => {
        stopButton.disabled = true;
        stopButton.textContent = "Stopping";
        try {
          await service.down(entry, props);
          await onRefresh();
        } catch (error) {
          stopButton.disabled = false;
          stopButton.textContent = "Stop";
          onError(error);
        }
      });

      const row = document.createElement("div");
      row.className = "pier-url-row";
      row.append(link, pathButton, stopButton);
      list.append(row);
    }
  }

  function createPierWidget(project, props = {}, service) {
    const card = document.createElement("article");
    card.className = "widget-card pier-widget-card";

    const content = document.createElement("div");
    content.className = "widget-content pier-widget-content";

    const header = document.createElement("div");
    header.className = "pier-widget-header";

    const eyebrow = document.createElement("p");
    eyebrow.className = "widget-eyebrow";
    eyebrow.textContent = "Pier";

    const refreshButton = document.createElement("button");
    refreshButton.className = "pier-refresh-button";
    refreshButton.type = "button";
    refreshButton.textContent = "Refresh";

    header.append(eyebrow, refreshButton);

    const body = document.createElement("p");
    body.className = "pier-widget-status";
    body.textContent = "Loading.";

    content.append(header, body);

    const list = document.createElement("div");
    list.className = "pier-url-list";
    content.append(list);

    async function load() {
      if (!card.isConnected && card.parentElement) {
        return;
      }

      refreshButton.disabled = true;
      body.hidden = false;
      body.textContent = "Loading.";
      list.innerHTML = "";

      try {
        const urls = await service.listProjectWorkloads(project, props);
        body.hidden = urls.length > 0;
        body.textContent = urls.length ? "" : "No running worktree.";
        renderPierUrlRows(list, urls, props, service, load, (error) => {
          body.hidden = false;
          body.textContent = error.message;
        });
      } catch (error) {
        body.hidden = false;
        body.textContent = error.message;
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => {
      load();
    });

    load();
    const refreshInterval = globalScope.setInterval(() => {
      if (!card.isConnected) {
        globalScope.clearInterval(refreshInterval);
        return;
      }

      load();
    }, 10000);

    card.append(content);
    return card;
  }

  function syncProjectDefaults(event) {
    if (!["slug", "devBranch"].includes(event.field)) {
      return;
    }

    const fields = event.fields;
    fields?.setDefaultValue("pierProjectName", getDefaultPierProjectName(event.coreFields));
    fields?.setDefaultValue("pierPreviewUrl", getDefaultPreviewUrl(event.coreFields));
  }

  registry.register(
    {
      id: "dashtop.pier",
      name: "Pier",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["dashtop.pier.urls"],
        panes: ["dashtop.pier.preview"],
        globalSettings: ["dashtop.pier.global"],
        projectSettings: ["dashtop.pier.project"],
        services: ["dashtop.pier"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:wcv",
        "widget:provide",
        "service:provide"
      ]
    },
    {
      activate(ctx) {
        ctx.status.set({
          state: "ready",
          summary: "Pier integration is available"
        });
        const pierService = createPierService();
        ctx.services.provide("dashtop.pier", pierService);
        ctx.events.on("dashtop.projectForm.coreFieldChanged", syncProjectDefaults);

        ctx.settings.registerGlobalSection({
          id: "dashtop.pier.global",
          title: "Pier",
          fields: [
            {
              key: "pierApiUrl",
              label: "Pier API URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_PIER_API_URL
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "dashtop.pier.project",
          title: "Pier",
          fields: [
            {
              key: "pierPreviewUrl",
              label: "Preview URL override",
              type: "text",
              valueType: "url",
              placeholder: "http://main.project.test/",
              defaultValue({ project }) {
                return getDefaultPreviewUrl(project);
              }
            },
            {
              key: "pierProjectName",
              label: "Pier project",
              type: "text",
              placeholder: "project",
              defaultValue({ project }) {
                return getDefaultPierProjectName(project);
              }
            }
          ]
        });

        ctx.panes.register({
          id: "dashtop.pier.preview",
          webAppId: "pier",
          key: "pier",
          title: "Pier",
          kind: "wcv",
          scope: "project",
          resolveUrl({ projectConfig }) {
            return projectConfig.pierPreviewUrl || "";
          }
        });

        ctx.widgets.register({
          id: "dashtop.pier.urls",
          name: "Pier URLs",
          title: "Pier URLs",
          scope: "project",
          category: "Project",
          status: "stable",
          defaultVisible: false,
          description: "Lists running Pier worktree URLs for the project.",
          layout: {
            default: { columns: 2, rows: 2 },
            min: { columns: 1, rows: 2 },
            max: { columns: 3, rows: 3 }
          },
          createElement: (project, props) => createPierWidget(project, props, pierService)
        });
      }
    }
  );
})(window);
