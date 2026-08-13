"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  collectPierResourceSnapshot,
  parseByteSize,
  parseDockerStats
} = require(`${process.cwd()}/build/plugins/pier/resources`);

test("Pier resource parsers normalize Docker memory values", () => {
  assert.equal(parseByteSize("1.5GiB"), 1.5 * (1024 ** 3));
  assert.equal(parseByteSize("256 MiB"), 256 * (1024 ** 2));
  assert.deepEqual(
    [...parseDockerStats([
      JSON.stringify({ Name: "alpha-api", MemUsage: "64MiB / 8GiB" }),
      "not-json",
      JSON.stringify({ Name: "alpha-db", MemUsage: "1.25GiB / 8GiB" })
    ].join("\n"))],
    [
      ["alpha-api", 64 * (1024 ** 2)],
      ["alpha-db", 1.25 * (1024 ** 3)]
    ]
  );
});

test("Pier resources collect running workload container memory", async () => {
  const commands: Array<{ command: string; args: string[] }> = [];
  const snapshot = await collectPierResourceSnapshot({
    execFileAsync: async (command: string, args: string[]) => {
      commands.push({ command, args });
      return {
        stdout: [
          JSON.stringify({ Name: "alpha-api", MemUsage: "64MiB / 8GiB" }),
          JSON.stringify({ Name: "alpha-db", MemUsage: "128MiB / 8GiB" })
        ].join("\n")
      };
    },
    fetchJson: async (url: string) => {
      if (url.endsWith("/api/v1/projects")) {
        return [
          { name: "alpha", repo_path: "/workspace/alpha", has_manifest: true },
          { name: "idle", repo_path: "/workspace/idle", has_manifest: true }
        ];
      }
      if (url.endsWith("/api/v1/projects/idle/worktrees")) {
        return [];
      }
      return [{
        has_workload: true,
        path: "/workspace/alpha",
        workload: {
          project: "alpha",
          slug: "main",
          status: "running",
          containers: [
            { name: "alpha-api", status: "running" },
            { name: "alpha-db", status: "running" }
          ]
        }
      }];
    },
    state: {
      projects: [
        { id: "alpha", name: "Alpha", slug: "alpha", sourcePath: "/workspace/alpha" },
        { id: "idle", name: "Idle", slug: "idle", sourcePath: "/workspace/idle" }
      ]
    }
  });

  const memoryBytes = 192 * (1024 ** 2);
  assert.equal(snapshot.memoryBytes, memoryBytes);
  assert.deepEqual(snapshot.projects.map((project: { projectId: string }) => project.projectId), ["alpha"]);
  assert.equal(snapshot.projects[0].projectName, "Alpha");
  assert.equal(snapshot.projects[0].workloads.length, 1);
  assert.equal(snapshot.projects[0].memoryBytes, memoryBytes);
  assert.deepEqual(commands[0].args.slice(-2), ["alpha-api", "alpha-db"]);
});

test("Pier resources ignore configured projects that are not registered with Pier", async () => {
  const requestedUrls: string[] = [];
  const snapshot = await collectPierResourceSnapshot({
    execFileAsync: async () => ({ stdout: "" }),
    fetchJson: async (url: string) => {
      requestedUrls.push(url);
      return url.endsWith("/api/v1/projects")
        ? [{ name: "registered", repo_path: "/workspace/registered", has_manifest: false }]
        : [];
    },
    state: {
      pluginConfig: {
        projects: {
          missing: {
            "boatyard.pier": { pierProjectName: "missing" }
          }
        }
      },
      projects: [
        { id: "registered", name: "Registered", sourcePath: "/workspace/registered" },
        { id: "missing", name: "Missing", sourcePath: "/workspace/missing" }
      ]
    }
  });

  assert.deepEqual(snapshot.projects, []);
  assert.deepEqual(snapshot.errors, []);
  assert.deepEqual(requestedUrls, ["http://pier.test/api/v1/projects"]);
});

export {};
