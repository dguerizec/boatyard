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

test("ProjectStore keeps legacy credentials available after profile configuration has been split", () => {
  const { filePath } = createTempStoreFile();
  fs.writeFileSync(filePath, `${JSON.stringify({
    passwordVault: {
      "https://example.test": {
        username: "alice",
        encryptedPassword: "encrypted-alice"
      }
    }
  })}\n`);

  const migrated = new ProjectStore(filePath);
  migrated.load();
  assert.deepEqual(migrated.getPasswordVaultForMigration(), {
    "https://example.test": {
      username: "alice",
      encryptedPassword: "encrypted-alice"
    }
  });

  const reloaded = new ProjectStore(filePath);
  reloaded.load();
  assert.deepEqual(reloaded.getPasswordVaultForMigration(), {
    "https://example.test": {
      username: "alice",
      encryptedPassword: "encrypted-alice"
    }
  });
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

test("ProjectStore returns the caller workspace state after shared mutations", () => {
  const { store } = createTempStore();
  store.load();
  const projectId = store.addProject({ name: "Project", sourcePath: "/workspace/project" }).projects[0].id;
  const oldLayout = { type: "pane", id: "old-pane" };
  const workspaceLayout = {
    type: "split",
    id: "workspace-split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", id: "workspace-pane-a" },
    second: { type: "pane", id: "workspace-pane-b" }
  };

  store.updatePaneLayout(projectId, oldLayout);
  store.ensureWorkspaceWindow("window-a", "group-a");
  store.updateWorkspaceNavigation("window-a", {
    view: "project",
    projectId,
    collapsedProjectGroups: [],
    pinnedProjectIds: [projectId],
    sidebarCollapsed: false
  });
  store.updateWorkspacePaneLayout("window-a", projectId, workspaceLayout);

  const assertWorkspaceResponse = (label: string, response: {
    navigation: { pinnedProjectIds: string[] };
    paneLayouts: Record<string, unknown>;
  }) => {
    assert.deepEqual(response.navigation.pinnedProjectIds, [projectId], `${label} returned stale pinned projects`);
    assert.deepEqual(response.paneLayouts[projectId], workspaceLayout, `${label} returned a stale pane layout`);
  };

  assertWorkspaceResponse("settings update", store.updateSettings({ blurWebAppOverlays: false }, "window-a"));
  assertWorkspaceResponse("global URL update", store.updateGlobalUrls([], "window-a"));
  assertWorkspaceResponse("project update", store.updateProject(projectId, { name: "Renamed" }, "window-a"));
  assertWorkspaceResponse("home tab update", store.updateWebAppHomeTab(projectId, {
    id: "home:status",
    parentWebAppId: "preview",
    parentLabel: "Preview",
    label: "Status",
    url: "https://status.example.test"
  }, "window-a"));
  assertWorkspaceResponse("home tabs update", store.updateWebAppHomeTabs(projectId, [], "window-a"));
  assertWorkspaceResponse("project reorder", store.reorderProjects([projectId], "window-a"));
  assertWorkspaceResponse("plugin enabled update", store.updatePluginEnabled("vendor.plugin", false, "window-a"));
  assertWorkspaceResponse("global plugin update", store.updateGlobalPluginConfig("vendor.plugin", { enabled: true }, "window-a"));
  assertWorkspaceResponse("project plugin update", store.updateProjectPluginConfig(projectId, "vendor.plugin", { enabled: true }, "window-a"));

  const added = store.addProject({ name: "Temporary", sourcePath: "/workspace/temporary" }, "window-a");
  assertWorkspaceResponse("project add", added);
  const temporaryProjectId = added.projects.find((project: StoreProject) => project.name === "Temporary").id;
  assertWorkspaceResponse("project removal", store.removeProject(temporaryProjectId, "window-a"));
});

test("ProjectStore does not persist stale workspace navigation and panes after a shared mutation", () => {
  const { filePath, store } = createTempStore();
  store.load();
  const projectId = store.addProject({ name: "Project", sourcePath: "/workspace/project" }).projects[0].id;
  const oldLayout = { type: "pane", id: "old-pane" };
  const workspaceLayout = {
    type: "split",
    id: "workspace-split",
    direction: "vertical",
    ratio: 0.5,
    first: { type: "pane", id: "workspace-pane-a" },
    second: { type: "pane", id: "workspace-pane-b" }
  };

  store.updateNavigation({
    view: "project",
    projectId,
    collapsedProjectGroups: [],
    pinnedProjectIds: [],
    sidebarCollapsed: false
  });
  store.updatePaneLayout(projectId, oldLayout);
  store.ensureWorkspaceWindow("window-a", "group-a");
  store.updateWorkspaceNavigation("window-a", {
    view: "project",
    projectId,
    collapsedProjectGroups: [],
    pinnedProjectIds: [projectId],
    sidebarCollapsed: false
  });
  store.updateWorkspacePaneLayout("window-a", projectId, workspaceLayout);

  const rendererState = store.updateGlobalUrls([], "window-a");
  store.updateWorkspaceNavigation("window-a", rendererState.navigation);
  store.updateWorkspacePaneLayout("window-a", projectId, rendererState.paneLayouts[projectId]);

  const reloaded = new ProjectStore(filePath);
  const restoredWorkspace = reloaded.load().workspaceSession.windows["window-a"];
  assert.deepEqual(restoredWorkspace.navigation.pinnedProjectIds, [projectId]);
  assert.deepEqual(restoredWorkspace.paneLayouts[projectId], workspaceLayout);
});

test("ProjectStore persists global settings", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const state = store.updateSettings({
    projectsBasePath: "/workspace/projects",
    blurWebAppOverlays: false,
    compactPaneTabs: true,
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
    compactPaneTabs: true,
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
    faviconPageUrl: "http://localhost:3500/projects/demo/sessions/123",
    faviconUrl: "http://localhost:3500/assets/favicon.svg",
    url: "http://localhost:3500/projects/demo/sessions/123"
  });
  store.updateWebAppState("project:twicc", {
    url: "http://localhost:3500/projects/demo/sessions/456"
  });

  const reloaded = new ProjectStore(filePath);
  const state = reloaded.load();

  assert.equal(
    state.webApps["project:twicc"].url,
    "http://localhost:3500/projects/demo/sessions/456"
  );
  assert.equal(
    state.webApps["project:twicc"].faviconUrl,
    "http://localhost:3500/assets/favicon.svg"
  );
  assert.equal(
    reloaded.getWebAppUrl("project:twicc"),
    "http://localhost:3500/projects/demo/sessions/456"
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
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Health",
    url: "localhost:8080/api/health"
  });

  assert.deepEqual(state.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Health",
    url: "http://localhost:8080/api/health"
  }]);

  const updated = store.updateWebAppHomeTabs(projectId, [{
    id: "home:health",
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Status",
    url: "localhost:8080/status"
  }]);
  assert.deepEqual(updated.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Status",
    url: "http://localhost:8080/status"
  }]);

  const reloaded = new ProjectStore(filePath);
  assert.deepEqual(reloaded.load().projects[0].webAppHomeTabs, updated.projects[0].webAppHomeTabs);
  assert.deepEqual(reloaded.updateWebAppHomeTabs(projectId, []).projects[0].webAppHomeTabs, []);
  reloaded.updateWebAppHomeTab(projectId, {
    id: "home:health",
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Health",
    url: "localhost:8080/api/health"
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
        parentWebAppId: "monitoring",
        parentLabel: "Monitoring",
        label: "Health",
        url: "localhost:8080/api/health"
      }]
    }
  })}\n`);

  const state = new ProjectStore(filePath).load();
  assert.deepEqual(state.projects[0].webAppHomeTabs, [{
    id: "home:health",
    parentWebAppId: "monitoring",
    parentLabel: "Monitoring",
    label: "Health",
    url: "http://localhost:8080/api/health"
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

test("ProjectStore migrates project webapp references across every saved window", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "GitHub project",
    repoUrl: "https://github.com/octo-org/example",
    sourcePath: "/workspace/example"
  }).projects[0].id;
  store.updateProject(projectId, {
    webAppHomeTabs: [{
      id: "home:readme",
      label: "README",
      parentLabel: "Repo",
      parentWebAppId: "repo",
      url: "https://github.com/octo-org/example/blob/main/README.md"
    }],
    webAppOpenRules: [{
      label: "Repository links",
      pattern: "repo",
      scope: "source-app",
      target: "same-pane"
    }]
  });
  store.updatePaneLayout(projectId, {
    type: "split",
    id: `${projectId}:split:1`,
    direction: "vertical",
    ratio: 0.5,
    first: {
      type: "pane",
      id: `${projectId}:pane:1`,
      selectedWebAppId: "repo"
    },
    second: {
      type: "pane",
      id: `${projectId}:pane:2`,
      selectedWebAppId: "manual",
      transientWebApp: {
        id: "transient:repository-link",
        label: "Repository link",
        parentLabel: "Repo",
        parentWebAppId: "repo",
        url: "https://github.com/octo-org/example/issues/1"
      }
    }
  });
  store.updateWebAppState(`${projectId}:pane:1:repo`, {
    url: "https://github.com/octo-org/example/pulls"
  });
  store.ensureWorkspaceWindow("window-a", "group-a");
  store.updateWorkspacePaneLayout("window-a", projectId, {
    type: "pane",
    id: `${projectId}:window-pane:1`,
    selectedWebAppId: "repo"
  });
  store.updateWorkspaceWebAppState("window-a", `${projectId}:window-pane:1:repo`, {
    url: "https://github.com/octo-org/example/actions"
  });

  const migration = {
    sourceKey: "repo",
    sourceWebAppId: "repo",
    targetKey: "github",
    targetWebAppId: "boatyard.github.repository"
  };
  assert.equal(store.migrateProjectWebApp(projectId, migration), true);
  assert.equal(store.migrateProjectWebApp(projectId, migration), false);

  const state = store.getState();
  const mainLayout = state.paneLayouts[projectId];
  assert.equal(mainLayout.type, "split");
  if (mainLayout.type !== "split") {
    throw new Error("Expected a split layout.");
  }
  assert.equal(mainLayout.first.selectedWebAppId, "boatyard.github.repository");
  assert.equal(
    mainLayout.second.type === "pane" ? mainLayout.second.transientWebApp?.parentWebAppId : "",
    "boatyard.github.repository"
  );
  assert.equal(state.webApps[`${projectId}:pane:1:repo`], undefined);
  assert.equal(
    state.webApps[`${projectId}:pane:1:github`]?.url,
    "https://github.com/octo-org/example/pulls"
  );
  assert.equal(
    state.workspaceSession.windows["window-a"].paneLayouts[projectId].selectedWebAppId,
    "boatyard.github.repository"
  );
  assert.equal(state.workspaceSession.windows["window-a"].webApps[`${projectId}:window-pane:1:repo`], undefined);
  assert.equal(
    state.workspaceSession.windows["window-a"].webApps[`${projectId}:window-pane:1:github`]?.url,
    "https://github.com/octo-org/example/actions"
  );
  assert.equal(state.projects[0].webAppHomeTabs[0].parentWebAppId, "boatyard.github.repository");
  assert.equal(state.projects[0].webAppOpenRules[0].pattern, "boatyard.github.repository");

  assert.deepEqual(new ProjectStore(filePath).load(), state);
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

test("ProjectStore persists terminal state independently for each workspace window", () => {
  const { filePath, store } = createTempStore();

  store.load();
  const projectId = store.addProject({
    name: "Project",
    slug: "project",
    sourcePath: "/workspace/project"
  }).projects[0].id;
  const surfaceKey = `pane:${projectId}:pane:1`;

  store.ensureWorkspaceWindow("window-a", "group-a");
  store.ensureWorkspaceWindow("window-b", "group-b");
  store.updateWorkspaceTerminalSelection("window-a", projectId, surfaceKey, "@2");
  store.updateWorkspaceTerminalSelection("window-b", projectId, surfaceKey, "@3");
  store.updateWorkspaceTerminalTabOrder("window-a", projectId, ["@2", "@1", "@3"]);
  store.updateWorkspaceTerminalTabOrder("window-b", projectId, ["@3", "@1", "@2"]);

  const reloaded = new ProjectStore(filePath);
  reloaded.load();
  const windowA = reloaded.getStateForWorkspaceWindow("window-a");
  const windowB = reloaded.getStateForWorkspaceWindow("window-b");

  assert.equal(windowA.terminalSelections[projectId][surfaceKey], "@2");
  assert.equal(windowB.terminalSelections[projectId][surfaceKey], "@3");
  assert.deepEqual(windowA.terminalTabOrders[projectId], ["@2", "@1", "@3"]);
  assert.deepEqual(windowB.terminalTabOrders[projectId], ["@3", "@1", "@2"]);
  assert.equal(reloaded.getState().terminalSelections[projectId], undefined);
  assert.equal(reloaded.getState().terminalTabOrders[projectId], undefined);
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

test("ProjectStore exposes built-in layouts and persists portable custom layouts", () => {
  const { filePath, store } = createTempStore();
  store.load();

  const builtIns = store.listLayouts();
  assert.equal(builtIns.length, 1);
  assert.equal(builtIns[0].id, "boatyard.single-pane");
  assert.equal(builtIns[0].name, "Blank — single pane");
  assert.equal(builtIns[0].builtIn, true);
  assert.equal(builtIns[0].projectId, null);
  assert.deepEqual(builtIns[0].paneLayout, {
    type: "pane",
    id: "pane-1",
    paneTypeId: null
  });

  const saved = store.saveLayout({
    name: "Development — wide",
    paneLayout: {
      type: "split",
      id: "root",
      direction: "vertical",
      ratio: 0.65,
      first: {
        type: "pane",
        id: "source",
        paneTypeId: "pier",
        selectedWebAppId: "pier:feature",
        url: "https://feature.example.test/"
      },
      second: {
        type: "pane",
        id: "terminal",
        paneTypeId: "terminal"
      }
    }
  });

  assert.equal(saved.name, "Development — wide");
  assert.equal(saved.projectId, null);
  assert.equal(saved.paneLayout.first.paneTypeId, "pier");
  assert.equal("selectedWebAppId" in saved.paneLayout.first, false);
  assert.equal("url" in saved.paneLayout.first, false);

  const custom = new ProjectStore(filePath).load().layouts;
  assert.equal(custom.length, 1);
  assert.equal(custom[0].id, saved.id);
  assert.equal(new ProjectStore(filePath).load().paneLayouts[saved.id], undefined);
});

test("ProjectStore keeps project layouts scoped and removes them with their project", () => {
  const { filePath, store } = createTempStore();
  store.load();

  let state = store.addProject({
    name: "First",
    sourcePath: "/workspace/first"
  });
  const firstProjectId = state.projects[0].id;
  state = store.addProject({
    name: "Second",
    sourcePath: "/workspace/second"
  });
  const secondProjectId = state.projects[1].id;

  const globalLayout = store.saveLayout({
    name: "Shared",
    paneLayout: { type: "pane", id: "global-pane", paneTypeId: null },
    projectId: null
  });
  const firstLayout = store.saveLayout({
    name: "First project",
    paneLayout: { type: "pane", id: "first-pane", paneTypeId: "terminal" },
    projectId: firstProjectId
  });
  const secondLayout = store.saveLayout({
    name: "Second project",
    paneLayout: { type: "pane", id: "second-pane", paneTypeId: "twicc-plugin" },
    projectId: secondProjectId
  });

  assert.deepEqual(
    store.listLayouts().map((layout: { id: string }) => layout.id),
    ["boatyard.single-pane", globalLayout.id]
  );
  assert.deepEqual(
    store.listLayouts(firstProjectId).map((layout: { id: string }) => layout.id),
    ["boatyard.single-pane", firstLayout.id, globalLayout.id]
  );
  assert.deepEqual(
    store.listLayouts(secondProjectId).map((layout: { id: string }) => layout.id),
    ["boatyard.single-pane", secondLayout.id, globalLayout.id]
  );

  const updatedFirstLayout = store.saveLayout({
    id: firstLayout.id,
    name: "First project updated",
    paneLayout: { type: "pane", id: "updated-first-pane", paneTypeId: "terminal" }
  });
  assert.equal(updatedFirstLayout.projectId, firstProjectId);
  assert.throws(() => store.saveLayout({
    name: "Missing project",
    paneLayout: { type: "pane", id: "missing-pane", paneTypeId: null },
    projectId: "missing-project"
  }), /project does not exist/);

  const reloaded = new ProjectStore(filePath);
  assert.equal(
    reloaded.load().layouts.find((layout: { id: string }) => layout.id === firstLayout.id)?.projectId,
    firstProjectId
  );
  state = reloaded.removeProject(firstProjectId);
  assert.equal(state.layouts.some((layout: { id: string }) => layout.id === firstLayout.id), false);
  assert.equal(state.layouts.some((layout: { id: string }) => layout.id === globalLayout.id), true);
  assert.equal(state.layouts.some((layout: { id: string }) => layout.id === secondLayout.id), true);
});

test("ProjectStore migrates legacy window layouts to one proportional pane arrangement", () => {
  const { store } = createTempStore();
  store.load();

  const saved = store.saveLayout({
    name: "Legacy",
    windows: [{
      id: "first-window",
      placement: { display: "secondary", x: 0.5, y: 0, width: 0.5, height: 1 },
      paneLayout: { type: "pane", id: "kept-pane", paneTypeId: "twicc-plugin" }
    }, {
      id: "discarded-window",
      paneLayout: { type: "pane", id: "discarded-pane", paneTypeId: "terminal" }
    }]
  });

  assert.deepEqual(saved.paneLayout, {
    type: "pane",
    id: "kept-pane",
    paneTypeId: "twicc-plugin"
  });
  assert.equal("windows" in saved, false);
  assert.equal("placement" in saved, false);
});

test("ProjectStore protects built-in layouts and removes custom layouts", () => {
  const { store } = createTempStore();
  store.load();

  assert.throws(() => store.saveLayout({
    id: "boatyard.single-pane",
    name: "Replacement",
    paneLayout: { type: "pane", id: "pane", paneTypeId: null }
  }), /cannot be overwritten/);

  const custom = store.saveLayout({
    name: "Disposable",
    paneLayout: { type: "pane", id: "pane", paneTypeId: null }
  });
  assert.equal(store.removeLayout(custom.id), true);
  assert.equal(store.removeLayout(custom.id), false);
  assert.equal(store.removeLayout("boatyard.single-pane"), false);
});

export {};
