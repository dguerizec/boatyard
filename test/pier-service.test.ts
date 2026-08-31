"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { activate, inspectPierProjectAvailability } = require(`${process.cwd()}/build/plugins/pier/main`);

test("inspectPierProjectAvailability requires a Pier manifest and CLI", async () => {
  const commands: string[] = [];
  const result = await inspectPierProjectAvailability("/workspace/project", {
    existsSync: (candidate: string) => candidate === "/workspace/project/.pier.toml",
    execFileAsync: async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(" ")}`);
      if (command === "git") {
        return { stdout: "/workspace/project\n" };
      }
      assert.equal(command, "pier");
      assert.deepEqual(args, ["--version"]);
      return { stdout: "pier 1.0.0\n" };
    }
  });

  assert.deepEqual(result, { available: true });
  assert.deepEqual(commands, ["git rev-parse --show-toplevel", "pier --version"]);
});

test("inspectPierProjectAvailability stays unavailable for a non-Pier repo", async () => {
  const commands: string[] = [];
  const result = await inspectPierProjectAvailability("/workspace/project", {
    existsSync: () => false,
    execFileAsync: async (command: string, args: string[]) => {
      commands.push(`${command} ${args.join(" ")}`);
      return { stdout: "/workspace/project\n" };
    }
  });

  assert.deepEqual(result, { available: false });
  assert.deepEqual(commands, ["git rev-parse --show-toplevel"]);
});

test("inspectPierProjectAvailability stays unavailable when the Pier CLI is missing", async () => {
  const result = await inspectPierProjectAvailability("/workspace/project", {
    existsSync: () => true,
    execFileAsync: async (command: string) => {
      if (command === "git") {
        return { stdout: "/workspace/project\n" };
      }
      throw new Error("spawn pier ENOENT");
    }
  });

  assert.deepEqual(result, { available: false });
});

test("Pier availability action includes the configured worktree pattern", async () => {
  const actions = new Map<string, (payload?: Record<string, unknown>) => Promise<unknown>>();
  const resourceProviders: string[] = [];
  activate({
    actions: {
      handle(name: string, handler: (payload?: Record<string, unknown>) => Promise<unknown>) {
        actions.set(name, handler);
      }
    },
    execFileAsync: async () => {
      throw new Error("not a Git repository");
    },
    getState: () => ({
      pluginConfig: {
        global: {
          "boatyard.pier": {
            pierWorktreePattern: "<repo>/../<project>-<worktree>"
          }
        }
      }
    }),
    plugin: { id: "boatyard.pier" },
    resources: {
      registerProvider(id: string) {
        resourceProviders.push(id);
      }
    },
    stateMigrations: { register() {} }
  });

  const availability = await actions.get("projectAvailability")?.({ cwd: "/workspace/project" });
  assert.deepEqual(availability, {
    available: false,
    worktreePattern: "<repo>/../<project>-<worktree>"
  });
  assert.deepEqual(resourceProviders, ["boatyard.pier.systemResources"]);
});

test("Pier worktree removal preserves volumes and images only when requested", async () => {
  const actions = new Map<string, (payload?: Record<string, unknown>) => Promise<unknown>>();
  const commands: Array<{ args: string[]; command: string; cwd?: string }> = [];
  activate({
    actions: {
      handle(name: string, handler: (payload?: Record<string, unknown>) => Promise<unknown>) {
        actions.set(name, handler);
      }
    },
    execFileAsync: async (command: string, args: string[], options: { cwd?: string } = {}) => {
      commands.push({ args, command, cwd: options.cwd });
      return { stdout: "" };
    },
    getState: () => ({}),
    plugin: { id: "boatyard.pier" },
    resources: { registerProvider() {} },
    stateMigrations: { register() {} }
  });

  const removeWorktree = actions.get("removeWorktree");
  if (!removeWorktree) {
    throw new Error("Pier removeWorktree action was not registered.");
  }
  await removeWorktree({
    cwd: "/workspace/project",
    worktreePath: "/workspace/project/worktrees/feature"
  });
  await removeWorktree({
    cwd: "/workspace/project",
    force: true,
    keepImages: true,
    keepVolumes: true,
    skipDown: true,
    worktreePath: "/workspace/project/worktrees/feature"
  });

  assert.deepEqual(commands, [
    {
      args: ["worktree", "rm", "/workspace/project/worktrees/feature"],
      command: "pier",
      cwd: "/workspace/project"
    },
    {
      args: [
        "worktree",
        "rm",
        "/workspace/project/worktrees/feature",
        "--force",
        "--skip-down",
        "--keep-volumes",
        "--keep-images"
      ],
      command: "pier",
      cwd: "/workspace/project"
    }
  ]);
});

export {};
