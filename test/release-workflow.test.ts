"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

function createReleaseFixture(changelog: string) {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-release-workflow-"));
  const scriptDirectory = path.join(fixtureRoot, "build-scripts", "scripts");
  const scriptPath = path.join(scriptDirectory, "update-changelog.js");

  fs.mkdirSync(scriptDirectory, { recursive: true });
  fs.mkdirSync(path.join(fixtureRoot, "src", "shared"), { recursive: true });
  fs.copyFileSync(
    path.join(process.cwd(), "build-scripts", "scripts", "update-changelog.js"),
    scriptPath
  );
  fs.writeFileSync(path.join(fixtureRoot, "package.json"), `${JSON.stringify({ version: "0.9.6" }, null, 2)}\n`);
  fs.writeFileSync(path.join(fixtureRoot, "CHANGELOG.md"), changelog);

  return { fixtureRoot, scriptPath };
}

function runPreflight(fixtureRoot: string, scriptPath: string) {
  return spawnSync(
    process.execPath,
    [scriptPath, "--preflight-release", "--type", "patch"],
    { cwd: fixtureRoot, encoding: "utf8" }
  );
}

test("release preflight rejects a missing Unreleased section without modifying files", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [0.9.6] - 2026-07-30",
    "",
    "### Fixed",
    "",
    "- **Previous fix** — Already released.",
    ""
  ].join("\n");
  const { fixtureRoot, scriptPath } = createReleaseFixture(changelog);
  const packagePath = path.join(fixtureRoot, "package.json");
  const generatedPath = path.join(fixtureRoot, "src", "shared", "changelog.json");
  const originalPackage = fs.readFileSync(packagePath, "utf8");

  try {
    const result = runPreflight(fixtureRoot, scriptPath);

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /missing an \[Unreleased\] section/);
    assert.equal(fs.readFileSync(path.join(fixtureRoot, "CHANGELOG.md"), "utf8"), changelog);
    assert.equal(fs.readFileSync(packagePath, "utf8"), originalPackage);
    assert.equal(fs.existsSync(generatedPath), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("release preflight validates a reviewed Unreleased section without modifying files", () => {
  const changelog = [
    "# Changelog",
    "",
    "## [Unreleased]",
    "",
    "### Summary",
    "",
    "- **Unreleased: Safer releases** — Release commands stop before changing versioned files.",
    "",
    "### Fixed",
    "",
    "- **Release workflow** — Missing changelog data blocks the release.",
    "",
    "## [0.9.6] - 2026-07-30",
    "",
    "### Fixed",
    "",
    "- **Previous fix** — Already released.",
    ""
  ].join("\n");
  const { fixtureRoot, scriptPath } = createReleaseFixture(changelog);
  const packagePath = path.join(fixtureRoot, "package.json");
  const generatedPath = path.join(fixtureRoot, "src", "shared", "changelog.json");
  const originalPackage = fs.readFileSync(packagePath, "utf8");

  try {
    const result = runPreflight(fixtureRoot, scriptPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Validated CHANGELOG\.md for 0\.9\.7 without modifying release files/);
    assert.equal(fs.readFileSync(path.join(fixtureRoot, "CHANGELOG.md"), "utf8"), changelog);
    assert.equal(fs.readFileSync(packagePath, "utf8"), originalPackage);
    assert.equal(fs.existsSync(generatedPath), false);
  } finally {
    fs.rmSync(fixtureRoot, { recursive: true, force: true });
  }
});

test("the Make release recipe fails fast and runs preflight before release mutations", () => {
  const makefile = fs.readFileSync(path.join(process.cwd(), "Makefile"), "utf8");
  const releaseRecipe = makefile.slice(
    makefile.indexOf("release:"),
    makefile.indexOf("\ntag:", makefile.indexOf("release:"))
  );

  assert.match(releaseRecipe, /@set -eu;/);
  const preflightIndex = releaseRecipe.indexOf("--preflight-release");
  assert.ok(preflightIndex >= 0);
  assert.ok(preflightIndex < releaseRecipe.indexOf("--release --version"));
  assert.ok(preflightIndex < releaseRecipe.indexOf("npm version"));
  assert.ok(preflightIndex < releaseRecipe.indexOf("git commit"));
  assert.ok(preflightIndex < releaseRecipe.indexOf("git push"));
});

export {};
