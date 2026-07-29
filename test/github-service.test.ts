"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  getGitHubProjectStatus,
  parseGitHubRepositoryUrl,
  resolveGitHubRepository
} = require(`${process.cwd()}/build/plugins/github/service`);

type CommandError = Error & {
  code?: string;
  stderr?: string;
};

test("parseGitHubRepositoryUrl normalizes supported GitHub remote formats", () => {
  const expected = {
    host: "github.com",
    owner: "octo-org",
    repo: "example"
  };

  for (const value of [
    "https://github.com/octo-org/example",
    "https://www.github.com/octo-org/example.git",
    "https://github.com/octo-org/example/tree/main/src",
    "git@github.com:octo-org/example.git",
    "ssh://git@github.com/octo-org/example.git"
  ]) {
    assert.deepEqual(parseGitHubRepositoryUrl(value), expected);
  }
});

test("parseGitHubRepositoryUrl rejects malformed and unsupported repository URLs", () => {
  for (const value of [
    "",
    "github.com/octo-org/example",
    "https://github.com/octo-org",
    "https://gitlab.com/octo-org/example",
    "git@gitlab.com:octo-org/example.git",
    "not a repository"
  ]) {
    assert.equal(parseGitHubRepositoryUrl(value), null);
  }
});

test("resolveGitHubRepository prefers repoUrl and falls back to gitUrl", () => {
  assert.deepEqual(resolveGitHubRepository({
    repoUrl: "https://github.com/octo-org/from-repo-url/tree/main/docs",
    gitUrl: "git@github.com:octo-org/from-git-url.git"
  }), {
    host: "github.com",
    owner: "octo-org",
    repo: "from-repo-url"
  });

  assert.deepEqual(resolveGitHubRepository({
    repoUrl: "https://gitlab.com/octo-org/example",
    gitUrl: "git@github.com:octo-org/from-git-url.git"
  }), {
    host: "github.com",
    owner: "octo-org",
    repo: "from-git-url"
  });
});

test("getGitHubProjectStatus reports authenticated GitHub CLI state", async () => {
  const calls: Array<{ command: string; args: string[] }> = [];
  const status = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async (command: string, args: string[]) => {
      calls.push({ command, args });
      return { stdout: "" };
    }
  });

  assert.deepEqual(calls, [{
    command: "gh",
    args: ["auth", "status", "--hostname", "github.com"]
  }]);
  assert.deepEqual(status, {
    state: "ready",
    summary: "Authenticated for octo-org/example.",
    details: {
      authenticated: true,
      host: "github.com",
      owner: "octo-org",
      repo: "example"
    }
  });
});

test("getGitHubProjectStatus distinguishes missing repositories, CLI, and authentication", async () => {
  assert.equal((await getGitHubProjectStatus({})).state, "notConfigured");

  const missingCli = new Error("spawn gh ENOENT") as CommandError;
  missingCli.code = "ENOENT";
  const unavailable = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw missingCli;
    }
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal(unavailable.summary, "GitHub CLI was not found in PATH.");

  const missingAuth = new Error("authentication failed") as CommandError;
  missingAuth.stderr = "You are not logged into any GitHub hosts. Run gh auth login.";
  const notConfigured = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw missingAuth;
    }
  });
  assert.equal(notConfigured.state, "notConfigured");
  assert.equal(notConfigured.summary, "Authenticate GitHub CLI for github.com.");
});

test("getGitHubProjectStatus does not expose command errors in renderer details", async () => {
  const commandError = new Error("secret command detail") as CommandError;
  commandError.stderr = "sensitive stderr";
  const status = await getGitHubProjectStatus({
    repoUrl: "https://github.com/octo-org/example"
  }, {
    execFileAsync: async () => {
      throw commandError;
    }
  });

  assert.equal(status.state, "error");
  assert.doesNotMatch(JSON.stringify(status), /secret|sensitive/);
});

export {};
