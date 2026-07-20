import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { ProjectStore } = require(`${process.cwd()}/build/main/store`);

test("configuration roots keep projects, settings, and workspace sessions isolated", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-configurations-"));
  const firstDirectory = path.join(root, "first");
  const secondDirectory = path.join(root, "second");
  const first = new ProjectStore({ configDirectory: firstDirectory });
  const second = new ProjectStore({ configDirectory: secondDirectory });

  first.load();
  second.load();
  const firstProject = first.addProject({ name: "First", sourcePath: "/workspace/first" }).projects[0];
  first.updateSettings({ projectsBasePath: "/workspace/first" });
  first.ensureWorkspaceWindow("shared-window-id", "first-group");
  first.updateWorkspaceNavigation("shared-window-id", { view: "project", projectId: firstProject.id });

  const secondProject = second.addProject({ name: "Second", sourcePath: "/workspace/second" }).projects[0];
  second.updateSettings({ projectsBasePath: "/workspace/second" });
  second.ensureWorkspaceWindow("shared-window-id", "second-group");
  second.updateWorkspaceNavigation("shared-window-id", { view: "project", projectId: secondProject.id });

  const firstReloaded = new ProjectStore({ configDirectory: firstDirectory }).load();
  const secondReloaded = new ProjectStore({ configDirectory: secondDirectory }).load();
  assert.deepEqual(firstReloaded.projects.map((project: { name: string }) => project.name), ["First"]);
  assert.deepEqual(secondReloaded.projects.map((project: { name: string }) => project.name), ["Second"]);
  assert.equal(firstReloaded.settings.projectsBasePath, "/workspace/first");
  assert.equal(secondReloaded.settings.projectsBasePath, "/workspace/second");
  assert.equal(firstReloaded.workspaceSession.windows["shared-window-id"].syncGroupId, "first-group");
  assert.equal(secondReloaded.workspaceSession.windows["shared-window-id"].syncGroupId, "second-group");
});
