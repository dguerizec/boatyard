"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const {
  ProjectStore,
  createTempStore,
  createTempStoreFile
} = require("./storeTestUtils.js");

type StoreProject = {
  id: string;
  name?: string;
};

test("ProjectStore persists configured projects", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.addProject({
    name: "Status",
    group: "Ops",
    url: "status.example.com"
  });

  assert.equal(state.projects.length, 1);
  assert.equal(state.projects[0].name, "Status");
  assert.equal(state.projects[0].group, "Ops");
  assert.equal(state.projects[0].slug, "status");
  assert.equal(state.projects[0].previewUrl, "https://status.example.com/");

  const reloaded = new ProjectStore(filePath);
  const reloadedState = reloaded.load();
  assert.deepEqual(reloadedState.projects, state.projects);
  assert.deepEqual(reloadedState.pluginConfig.projects, {});
});

test("ProjectStore persists the store schema version", () => {
  const { directory, filePath, store } = createTempStore();

  assert.equal(store.load().schemaVersion, 1);
  store.updateSettings({ projectsBasePath: "/workspace/example" });

  const saved = JSON.parse(fs.readFileSync(path.join(directory, ".boatyard", "settings.json"), "utf8"));
  assert.equal(saved.schemaVersion, 1);
  assert.equal(new ProjectStore(filePath).load().schemaVersion, 1);
});

test("ProjectStore migrates a legacy file into the .boatyard configuration directory", () => {
  const { directory, filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, `${JSON.stringify({
    settings: { projectsBasePath: "/workspace/projects" },
    projects: [{ id: "project-id", name: "Project", sourcePath: "/workspace/project" }],
    window: { bounds: { x: 20, y: 30, width: 1200, height: 800 }, isMaximized: true }
  })}\n`);

  const state = new ProjectStore(filePath).load();
  const configDirectory = path.join(directory, ".boatyard");
  const legacyBackups = fs.readdirSync(directory).filter((entry: string) => entry.startsWith("state.legacy-") && entry.endsWith(".json"));

  assert.equal(fs.existsSync(filePath), false);
  assert.equal(legacyBackups.length, 1);
  assert.equal(fs.existsSync(path.join(configDirectory, "settings.json")), true);
  assert.equal(fs.existsSync(path.join(configDirectory, "projects.json")), true);
  assert.equal(fs.existsSync(path.join(configDirectory, "workspace-session.json")), true);
  assert.equal(state.settings.projectsBasePath, "/workspace/projects");
  assert.equal(state.projects[0].id, "project-id");
  assert.deepEqual(state.window, {
    bounds: { x: 20, y: 30, width: 1200, height: 800 },
    isFullScreen: false,
    isMaximized: true
  });

  new ProjectStore(filePath).load();
  assert.equal(fs.readdirSync(directory).filter((entry: string) => entry.startsWith("state.legacy-") && entry.endsWith(".json")).length, 1);
});

test("ProjectStore persists window state", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.updateWindowState({
    bounds: {
      x: 140,
      y: 96,
      width: 1360,
      height: 860
    },
    isMaximized: true
  });

  assert.deepEqual(state, {
    bounds: {
      x: 140,
      y: 96,
      width: 1360,
      height: 860
    },
    isFullScreen: false,
    isMaximized: true
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().window, state);
});

test("ProjectStore keeps window layouts independent while synchronizing project switching by group", () => {
  const { filePath, store } = createTempStore();
  store.load();
  const projectA = store.addProject({ name: "A", sourcePath: "/workspace/a" }).projects[0].id;
  const projectB = store.addProject({ name: "B", sourcePath: "/workspace/b" }).projects[1].id;

  store.ensureWorkspaceWindow("window-a", "group-a");
  store.ensureWorkspaceWindow("window-b", "group-a", "window-a");
  store.updateWorkspaceNavigation("window-b", {
    view: "global",
    projectId: null,
    collapsedProjectGroups: ["Operations"],
    pinnedProjectIds: [projectA],
    sidebarCollapsed: true
  });
  store.updateWorkspacePaneLayout("window-a", projectA, { type: "pane", id: "a-pane", selectedWebAppId: "twicc" });
  store.updateWorkspacePaneLayout("window-b", projectA, { type: "pane", id: "b-pane", selectedWebAppId: "preview" });
  const synchronized = store.updateWorkspaceNavigation("window-a", { view: "project", projectId: projectB });

  assert.equal(synchronized["window-a"].projectId, projectB);
  assert.equal(synchronized["window-a"].sidebarCollapsed, false);
  assert.equal(synchronized["window-b"].projectId, projectB);
  assert.equal(synchronized["window-b"].sidebarCollapsed, true);
  assert.deepEqual(synchronized["window-b"].collapsedProjectGroups, ["Operations"]);
  assert.deepEqual(synchronized["window-b"].pinnedProjectIds, [projectA]);
  assert.equal(store.getStateForWorkspaceWindow("window-a").paneLayouts[projectA].id, "a-pane");
  assert.equal(store.getStateForWorkspaceWindow("window-b").paneLayouts[projectA].id, "b-pane");

  const reloaded = new ProjectStore(filePath);
  reloaded.load();
  assert.equal(reloaded.getStateForWorkspaceWindow("window-a").navigation.projectId, projectB);
  assert.equal(reloaded.getStateForWorkspaceWindow("window-b").paneLayouts[projectA].id, "b-pane");
});

test("ProjectStore persists global settings", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.updateSettings({
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false,
    passwordManagerEnabled: true,
    passwordManagerDisclaimerAccepted: true,
    terminalEnv: "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never",
    webAppOpenRules: [
      {
        pattern: "*://accounts.example.com/*",
        target: "external",
        scope: "url-pattern"
      }
    ]
  });

  assert.deepEqual(state.settings, {
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false,
    passwordManagerEnabled: true,
    passwordManagerDisclaimerAccepted: true,
    widgetRailWidth: 340,
    terminalEnv: "SSH_ASKPASS=\nSSH_ASKPASS_REQUIRE=never",
    webAppOpenRules: [
      {
        pattern: "*://accounts.example.com/*",
        target: "external",
        scope: "url-pattern",
        label: ""
      }
    ]
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().settings, state.settings);
});

test("ProjectStore persists project webapp open rules separately from global settings", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "Project",
    sourcePath: "/workspace/example"
  }).projects[0].id;
  const state = store.updateProject(projectId, {
    webAppOpenRules: [
      {
        pattern: "repo",
        sourcePaneId: "pane-alpha",
        target: "pane:pane-beta",
        targetLabel: "Browser",
        scope: "source-app",
        label: "Repo"
      }
    ]
  });

  assert.deepEqual(state.settings.webAppOpenRules, []);
  assert.deepEqual(state.projects[0].webAppOpenRules, [{
    pattern: "repo",
    sourcePaneId: "pane-alpha",
    target: "pane:pane-beta",
    targetLabel: "Browser",
    scope: "source-app",
    label: "Repo"
  }]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().projects[0].webAppOpenRules, state.projects[0].webAppOpenRules);
});

test("ProjectStore drops project-specific webapp open rules from global settings", () => {
  const { filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, `${JSON.stringify({
    settings: {
      webAppOpenRules: [
        {
          pattern: "https://global.example.test/*",
          target: "external",
          scope: "url-pattern",
          label: "Global"
        },
        {
          pattern: "repo",
          projectId: "project-id",
          sourcePaneId: "pane-alpha",
          target: "pane:pane-beta",
          targetLabel: "Browser",
          scope: "source-app",
          label: "Repo"
        },
        {
          pattern: "pane-stale",
          target: "pane:missing",
          scope: "source-app",
          label: "Stale"
        }
      ]
    },
    projects: [{
      id: "project-id",
      name: "Project",
      sourcePath: "/workspace/example"
    }]
  }, null, 2)}\n`);

  const state = new ProjectStore(filePath).load();

  assert.deepEqual(state.settings.webAppOpenRules, [{
    pattern: "https://global.example.test/*",
    target: "external",
    scope: "url-pattern",
    label: "Global"
  }]);
  assert.deepEqual(state.projects[0].webAppOpenRules, []);
});

test("ProjectStore persists disabled plugins", () => {
  const { filePath, store } = createTempStore();

  store.load();
  let state = store.updatePluginEnabled("boatyard.pier", false);
  assert.deepEqual(state.plugins.enabled, {
    "boatyard.pier": false
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().plugins.enabled, {
    "boatyard.pier": false
  });

  state = reloaded.updatePluginEnabled("boatyard.pier", true);
  assert.deepEqual(state.plugins.enabled, {});
});

test("ProjectStore persists navigation and clears removed active projects", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project"
  });
  const projectId = state.projects[0].id;
  const navigation = store.updateNavigation({
    view: "project",
    projectId,
    collapsedProjectGroups: ["Raven", "Raven", "  Tools  ", ""],
    pinnedProjectIds: [projectId, projectId, " missing-project "],
    sidebarCollapsed: true
  });

  assert.deepEqual(navigation, {
    view: "project",
    projectId,
    collapsedProjectGroups: ["Raven", "Tools"],
    pinnedProjectIds: [projectId, "missing-project"],
    sidebarCollapsed: true
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().navigation, navigation);

  const removed = reloaded.removeProject(projectId);
  assert.deepEqual(removed.navigation, {
    view: "global",
    projectId: null,
    collapsedProjectGroups: [],
    pinnedProjectIds: ["missing-project"],
    sidebarCollapsed: true
  });
});

test("ProjectStore persists onboarding state", () => {
  const { filePath, store } = createTempStore();

  store.load();
  assert.deepEqual(store.getState().onboarding, {
    completedVersion: 0,
    completedAt: ""
  });

  assert.deepEqual(store.updateOnboarding({
    completedVersion: 1,
    completedAt: "2026-06-19T10:11:12.000Z"
  }), {
    completedVersion: 1,
    completedAt: "2026-06-19T10:11:12.000Z"
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().onboarding, {
    completedVersion: 1,
    completedAt: "2026-06-19T10:11:12.000Z"
  });
});

test("ProjectStore tracks app version upgrades for changelog display", () => {
  const { store } = createTempStore();

  store.load();
  assert.deepEqual(store.reconcileAppVersion("0.4.5"), {
    lastSeenVersion: "0.4.5",
    pendingChangelogFromVersion: "",
    dismissedChangelogVersion: ""
  });

  assert.deepEqual(store.reconcileAppVersion("0.4.6"), {
    lastSeenVersion: "0.4.6",
    pendingChangelogFromVersion: "0.4.5",
    dismissedChangelogVersion: ""
  });

  assert.deepEqual(store.dismissChangelog("0.4.6"), {
    lastSeenVersion: "0.4.6",
    pendingChangelogFromVersion: "",
    dismissedChangelogVersion: "0.4.6"
  });

  assert.deepEqual(store.reconcileAppVersion("0.4.6"), {
    lastSeenVersion: "0.4.6",
    pendingChangelogFromVersion: "",
    dismissedChangelogVersion: "0.4.6"
  });
});

test("ProjectStore compares app versions numerically for changelog display", () => {
  const { store } = createTempStore();

  store.load();
  store.reconcileAppVersion("0.9.2");

  assert.deepEqual(store.reconcileAppVersion("0.10.0"), {
    lastSeenVersion: "0.10.0",
    pendingChangelogFromVersion: "0.9.2",
    dismissedChangelogVersion: ""
  });
});

test("ProjectStore persists webapp urls", () => {
  const { filePath, store } = createTempStore();

  store.load();
  store.updateWebAppState("project:twicc", {
    url: "http://localhost:3500/projects/demo/sessions/123"
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.equal(
    state.webApps["project:twicc"].url,
    "http://localhost:3500/projects/demo/sessions/123"
  );
  assert.equal(
    reloaded.getWebAppUrl("project:twicc"),
    "http://localhost:3500/projects/demo/sessions/123"
  );
});

test("ProjectStore persists global urls", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.updateGlobalUrls([{
    label: "Cloudflare",
    url: "dash.cloudflare.com"
  }, {
    id: "ovh",
    label: "OVH",
    url: "https://www.ovhcloud.com/manager/"
  }]);

  assert.deepEqual(state.globalUrls, [{
    id: "cloudflare",
    label: "Cloudflare",
    url: "https://dash.cloudflare.com/"
  }, {
    id: "ovh",
    label: "OVH",
    url: "https://www.ovhcloud.com/manager/"
  }]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().globalUrls, state.globalUrls);
});

test("ProjectStore persists project webapp home tabs", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "Project",
    sourcePath: "/workspace/example"
  }).projects[0].id;
  const state = store.updateWebAppHomeTab(projectId, {
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Health",
    url: "localhost:60082/api/health"
  });

  assert.deepEqual(state.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Health",
    url: "http://localhost:60082/api/health"
  }]);

  const updated = store.updateWebAppHomeTabs(projectId, [{
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Status",
    url: "localhost:60082/status"
  }]);
  assert.deepEqual(updated.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Status",
    url: "http://localhost:60082/status"
  }]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().projects[0].webAppHomeTabs, updated.projects[0].webAppHomeTabs);
  assert.deepEqual(reloaded.updateWebAppHomeTabs(projectId, []).projects[0].webAppHomeTabs, []);
  reloaded.updateWebAppHomeTab(projectId, {
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Health",
    url: "localhost:60082/api/health"
  });
  assert.equal(reloaded.removeProject(projectId).projects.some((project: StoreProject) => project.id === projectId), false);
});

test("ProjectStore migrates top-level webapp home tabs into projects", () => {
  const { filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, `${JSON.stringify({
    projects: [{
      id: "project-id",
      name: "Project",
      sourcePath: "/workspace/example"
    }],
    webAppHomeTabs: {
      "project-id": [{
        id: "home:health",
        parentWebAppId: "hawser",
        parentLabel: "Hawser",
        label: "Health",
        url: "localhost:60082/api/health"
      }]
    }
  })}\n`);

  const state = new ProjectStore(filePath).load();
  assert.deepEqual(state.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "hawser",
    parentLabel: "Hawser",
    label: "Health",
    url: "http://localhost:60082/api/health"
  }]);
  assert.equal(state.webAppHomeTabs, undefined);
});

test("ProjectStore persists pane layouts", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const layout = store.updatePaneLayout("project-id", {
    type: "split",
    id: "project-id:split:1",
    direction: "vertical",
    ratio: 0.35,
    first: {
      type: "pane",
      id: "project-id:pane:1",
      selectedWebAppId: "twicc"
    },
    second: {
      type: "pane",
      id: "project-id:pane:2",
      selectedWebAppId: "preview"
    }
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.deepEqual(state.paneLayouts["project-id"], layout);
  assert.deepEqual(reloaded.getPaneLayout("project-id"), layout);
});

test("ProjectStore persists widget layouts", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const layout = store.updateWidgetLayout("project-id", {
    order: ["project-shell", "project-summary", "project-shell"],
    hidden: ["discord", "discord"],
    sizes: {
      "project-shell": {
        columns: 2,
        rows: 3
      }
    },
    positions: {
      "project-shell": {
        x: 1,
        y: 2
      }
    },
    locked: false
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.deepEqual(layout, {
    panes: {
      "widgets-0": {
        order: ["project-shell", "project-summary"],
        hidden: ["discord"],
        sizes: {
          "project-shell": {
            columns: 2,
            rows: 3
          }
        },
        positions: {
          "project-shell": {
            x: 1,
            y: 2
          }
        },
        locked: false
      }
    }
  });
  assert.deepEqual(state.widgetLayouts["project-id"], layout);
  assert.deepEqual(reloaded.getWidgetLayout("project-id"), layout);
});

test("ProjectStore persists terminal selections", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "Project",
    slug: "project",
    sourcePath: "/tmp/project"
  }).projects[0].id;

  store.updateTerminalSelection(projectId, "pane:project:pane:1", "@2");
  store.updateTerminalSelection(projectId, "widget:widgets-0", "@3");

  const reloaded = new ProjectStore(filePath);
  let state = reloaded.load();

  assert.deepEqual(state.terminalSelections[projectId], {
    "pane:project:pane:1": "@2",
    "widget:widgets-0": "@3"
  });

  state = reloaded.removeProject(projectId);
  assert.equal(state.terminalSelections[projectId], undefined);
});

test("ProjectStore persists terminal tab order", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "Project",
    slug: "project",
    sourcePath: "/tmp/project"
  }).projects[0].id;

  store.updateTerminalTabOrder(projectId, ["@3", "@1", "@2", "@2", ""]);

  const reloaded = new ProjectStore(filePath);
  let state = reloaded.load();

  assert.deepEqual(state.terminalTabOrders[projectId], ["@3", "@1", "@2"]);

  state = reloaded.removeProject(projectId);
  assert.equal(state.terminalTabOrders[projectId], undefined);
});

test("ProjectStore persists global terminal state", () => {
  const { filePath, store } = createTempStore();

  store.load();
  store.updateTerminalSelection("__global__", "pane:__global__:pane:1", "@2");
  store.updateTerminalTabOrder("__global__", ["@3", "@1", "@2"]);

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.deepEqual(state.terminalSelections.__global__, {
    "pane:__global__:pane:1": "@2"
  });
  assert.deepEqual(state.terminalTabOrders.__global__, ["@3", "@1", "@2"]);
});

test("ProjectStore keeps preview URLs as core project data", () => {
  const { filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, JSON.stringify({
    projects: [
      {
        id: "project-id",
        name: "Project",
        slug: "project",
        previewUrl: "localhost:5173"
      }
    ]
  }));

  const store = new ProjectStore(filePath);
  const state = store.load();

  assert.equal(state.projects[0].previewUrl, "http://localhost:5173/");
  assert.deepEqual(state.pluginConfig.projects, {});
});

test("ProjectStore persists and removes project plugin config", () => {
  const { filePath, store } = createTempStore();

  store.load();
  let state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project"
  });
  const projectId = state.projects[0].id;

  state = store.updateProjectPluginConfig(projectId, "boatyard.pier", {
    pierPreviewUrl: "http://localhost:5173/"
  });

  assert.deepEqual(state.pluginConfig.projects[projectId]["boatyard.pier"], {
    pierPreviewUrl: "http://localhost:5173/"
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(
    reloaded.load().pluginConfig.projects[projectId]["boatyard.pier"],
    { pierPreviewUrl: "http://localhost:5173/" }
  );

  state = reloaded.removeProject(projectId);
  assert.equal(state.pluginConfig.projects[projectId], undefined);
});

test("ProjectStore persists global plugin config", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.updateGlobalPluginConfig("boatyard.pier", {
    baseUrl: "http://localhost:5173/"
  });

  assert.deepEqual(state.pluginConfig.global["boatyard.pier"], {
    baseUrl: "http://localhost:5173/"
  });

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(
    reloaded.load().pluginConfig.global["boatyard.pier"],
    { baseUrl: "http://localhost:5173/" }
  );
});

test("ProjectStore does not rehydrate Pier config from legacy preview after load", () => {
  const { store } = createTempStore();

  store.load();
  let state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project",
    previewUrl: "project.example.test"
  });
  const projectId = state.projects[0].id;
  assert.equal(state.pluginConfig.projects[projectId], undefined);

  state = store.updateProjectPluginConfig(projectId, "boatyard.pier", {
    pierPreviewUrl: ""
  });
  assert.equal(state.pluginConfig.projects[projectId], undefined);

  state = store.updateProject(projectId, {
    name: "Project",
    sourcePath: "/tmp/project"
  });
  assert.equal(state.projects[0].previewUrl, "https://project.example.test/");
  assert.equal(state.pluginConfig.projects[projectId], undefined);
});

test("ProjectStore reorders projects", () => {
  const { filePath, store } = createTempStore();

  store.load();
  store.addProject({
    name: "First",
    sourcePath: "/tmp/first"
  });
  store.addProject({
    name: "Second",
    sourcePath: "/tmp/second"
  });
  store.addProject({
    name: "Third",
    sourcePath: "/tmp/third"
  });

  const ids = store.getState().projects.map((project: StoreProject) => project.id);
  const reordered = store.reorderProjects([ids[2], ids[0], ids[1]]);

  assert.deepEqual(reordered.projects.map((project: StoreProject) => project.name), ["Third", "First", "Second"]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().projects.map((project: StoreProject) => project.name), ["Third", "First", "Second"]);
});

test("ProjectStore persists project updates and removals", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.addProject({
    name: "Project",
    sourcePath: "/tmp/project",
    previewUrl: "project.example.test",
    urls: [{
      label: "Cloudflare",
      url: "dash.cloudflare.com"
    }]
  });
  const id = state.projects[0].id;
  store.updateWebAppState(`${id}:twicc`, {
    url: "http://localhost:3500/projects/demo"
  });
  store.updatePaneLayout(id, {
    type: "pane",
    id: `${id}:pane:1`,
    selectedWebAppId: "twicc"
  });
  store.updateWidgetLayout(id, {
    order: ["discord", "project-summary"],
    locked: false
  });

  const moved = store.updateProject(id, {
    bounds: {
      x: 42,
      y: 24,
      width: 640,
      height: 420
    },
    isOpen: false
  });

  assert.deepEqual(moved.projects[0].urls, [{
    id: "cloudflare",
    label: "Cloudflare",
    url: "https://dash.cloudflare.com/"
  }]);

  const reloaded = new ProjectStore(filePath);
  const reloadedState = reloaded.load();
  assert.deepEqual(reloadedState.projects, moved.projects);
  assert.deepEqual(reloadedState.pluginConfig.projects, {});

  const removed = reloaded.removeProject(id);
  assert.equal(removed.webApps[`${id}:twicc`], undefined);
  assert.equal(removed.paneLayouts[id], undefined);
  assert.equal(removed.widgetLayouts[id], undefined);
  const reloadedAgain = new ProjectStore(filePath);
  assert.deepEqual(reloadedAgain.load(), removed);
});

test("ProjectStore migrates legacy apps state to projects", () => {
  const { filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, JSON.stringify({
    apps: [{
      id: "legacy-id",
      name: "Legacy",
      url: "legacy.example.test"
    }]
  }));

  const store = new ProjectStore(filePath);
  const state = store.load();

  assert.deepEqual(state.projects.map((project: StoreProject) => project.id), ["legacy-id"]);
  assert.equal(state.projects[0].slug, "legacy");
  assert.equal(state.projects[0].previewUrl, "https://legacy.example.test/");
});

export {};
