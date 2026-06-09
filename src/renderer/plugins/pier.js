"use strict";

(function registerPierPlugin(globalScope) {
  const registry = globalScope.BoatyardPluginRegistry;
  const DEFAULT_PIER_API_URL = "http://127.0.0.1:60080";
  const DEFAULT_PIER_URL = "http://pier.test";

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function normalizePath(value) {
    return String(value || "").replace(/[/\\]+$/g, "");
  }

  function normalizeApiUrl(value) {
    return String(value || DEFAULT_PIER_API_URL).replace(/\/+$/g, "");
  }

  function pathsOverlap(left, right) {
    return left === right || left.startsWith(`${right}/`) || right.startsWith(`${left}/`);
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
        return repoPath && pathsOverlap(sourcePath, repoPath);
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

  function getPierUrl(options = {}) {
    return normalizeApiUrl(options.globalPluginConfig?.pierUrl || DEFAULT_PIER_URL);
  }

  function getDefaultPreviewUrl(project = {}) {
    const projectName = getDefaultPierProjectName(project);
    return projectName ? `${getPierUrl()}/#/projects/${encodeURIComponent(projectName)}` : "";
  }

  function getPierPaneUrl(project = {}, options = {}) {
    const configuredUrl = String(options.pluginConfig?.pierPreviewUrl || "").trim();
    if (configuredUrl) {
      return configuredUrl;
    }

    const projectName = String(options.pluginConfig?.pierProjectName || "").trim() || getDefaultPierProjectName(project);
    return projectName ? `${getPierUrl(options)}/#/projects/${encodeURIComponent(projectName)}` : "";
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
      openUrl(url, options = {}) {
        if (typeof options.openProjectWebApp === "function" && options.openProjectWebApp("pier", url)) {
          return true;
        }

        return globalScope.boatyard.openExternal(url);
      }
    });
  }

  async function copyText(value) {
    if (globalScope.boatyard?.writeClipboardText) {
      await globalScope.boatyard.writeClipboardText(value);
      return;
    }

    await navigator.clipboard.writeText(value);
  }

  function getPierUrlRowKey(entry) {
    return `${entry.project || ""}\u0000${entry.slug || ""}\u0000${entry.url || ""}`;
  }

  function updatePierUrlRow(row, entry) {
    row.pierEntry = entry;
    row.pierLink.href = entry.url;
    row.pierLink.textContent = entry.url;
    row.pierLink.title = entry.url;
    row.pierPathText.textContent = entry.worktreePath || "No worktree path";
    row.pierPathButton.title = entry.worktreePath ? `Copy ${entry.worktreePath}` : "";
    row.pierPathButton.disabled = !entry.worktreePath;
  }

  function createPierUrlRow(props, service, onRefresh, onError) {
    const link = document.createElement("a");
    link.className = "pier-url-link";
    link.addEventListener("click", (event) => {
      event.preventDefault();
      service.openUrl(link.href, props);
    });

    const pathButton = document.createElement("button");
    pathButton.className = "pier-path-button";
    pathButton.type = "button";
    const pathText = document.createElement("span");
    pathText.className = "pier-path-text";
    pathButton.append(pathText);
    pathButton.addEventListener("click", async () => {
      try {
        await copyText(pathButton.closest(".pier-url-row")?.pierEntry?.worktreePath || "");
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
        await service.down(stopButton.closest(".pier-url-row")?.pierEntry || {}, props);
        await onRefresh();
      } catch (error) {
        stopButton.disabled = false;
        stopButton.textContent = "Stop";
        onError(error);
      }
    });

    const row = document.createElement("div");
    row.className = "pier-url-row";
    row.pierLink = link;
    row.pierPathButton = pathButton;
    row.pierPathText = pathText;
    row.append(link, pathButton, stopButton);
    return row;
  }

  function renderPierUrlRows(list, urls, props, service, onRefresh, onError) {
    const existingRows = new Map([...list.querySelectorAll(".pier-url-row")]
      .map((row) => [row.dataset.key, row]));
    const nextKeys = new Set();

    for (const entry of urls) {
      const key = getPierUrlRowKey(entry);
      nextKeys.add(key);
      const row = existingRows.get(key) || createPierUrlRow(props, service, onRefresh, onError);
      row.dataset.key = key;
      updatePierUrlRow(row, entry);
      list.append(row);
    }

    for (const [key, row] of existingRows) {
      if (!nextKeys.has(key)) {
        row.remove();
      }
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
      if (!list.children.length) {
        body.hidden = false;
        body.textContent = "Loading.";
      }

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
      id: "boatyard.pier",
      name: "Pier",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.pier.urls"],
        panes: ["boatyard.pier.preview"],
        globalSettings: ["boatyard.pier.global"],
        projectSettings: ["boatyard.pier.project"],
        services: ["boatyard.pier"]
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
        ctx.services.provide("boatyard.pier", pierService);
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncProjectDefaults);

        ctx.settings.registerGlobalSection({
          id: "boatyard.pier.global",
          title: "Pier",
          fields: [
            {
              key: "pierApiUrl",
              label: "Pier API URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_PIER_API_URL
            },
            {
              key: "pierUrl",
              label: "Pier URL",
              type: "text",
              valueType: "url",
              placeholder: DEFAULT_PIER_URL
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.pier.project",
          title: "Pier",
          fields: [
            {
              key: "pierPreviewUrl",
              label: "Pier pane URL override",
              type: "text",
              valueType: "url",
              placeholder: "http://pier.test/#/projects/project",
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
          id: "boatyard.pier.preview",
          webAppId: "pier",
          key: "pier",
          title: "Pier",
          kind: "wcv",
          scope: "project",
          resolveUrl({ project, projectConfig, globalPluginConfig }) {
            return getPierPaneUrl(project, {
              pluginConfig: projectConfig,
              globalPluginConfig
            });
          }
        });

        ctx.widgets.register({
          id: "boatyard.pier.urls",
          name: "Pier URLs",
          title: "Pier URLs",
          scope: "project",
          category: "Project",
          status: "stable",
          defaultVisible: false,
          description: "Lists running Pier worktree URLs for the project.",
          layout: {
            default: { columns: 3, rows: 2 },
            min: { columns: 3, rows: 2 }
          },
          createElement: (project, props) => createPierWidget(project, props, pierService)
        });
      }
    }
  );
})(window);
