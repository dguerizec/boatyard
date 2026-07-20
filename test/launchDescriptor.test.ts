import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  LAUNCH_DESCRIPTOR_VERSION,
  migrateConfigurationRootToProfiles,
  normalizeProfileName,
  parseLaunchDescriptor,
  resolveDefaultConfigurationRoot,
  resolveProfileLaunch,
  routeLaunchDescriptor
} = require(`${process.cwd()}/build/main/launchDescriptor`);

test("development and packaged builds use separate default configuration roots", () => {
  assert.equal(
    resolveDefaultConfigurationRoot({
      cwd: "/workspace/boatyard",
      home: "/home/example",
      isPackaged: false
    }),
    "/workspace/boatyard/.boatyard"
  );
  assert.equal(
    resolveDefaultConfigurationRoot({
      cwd: "/workspace/boatyard",
      home: "/home/example",
      isPackaged: true
    }),
    "/home/example/.boatyard"
  );
});

test("profile launch descriptors resolve named profiles below the configuration root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-launch-"));
  const descriptor = resolveProfileLaunch({ argv: ["electron", ".", "--profile", "work"], configurationRoot: root });

  assert.deepEqual(descriptor, {
    version: LAUNCH_DESCRIPTOR_VERSION,
    profile: "work",
    configurationRoot: root,
    configDirectory: path.join(root, "profiles", "work"),
    openingTarget: null
  });
  assert.deepEqual(parseLaunchDescriptor(descriptor), descriptor);
  assert.equal(parseLaunchDescriptor({ ...descriptor, version: 2 }), null);
  assert.equal(parseLaunchDescriptor({ ...descriptor, profile: "../outside" }), null);
  assert.equal(parseLaunchDescriptor({ ...descriptor, configDirectory: path.join(root, "profiles", "other") }), null);
});

test("configuration root migration moves profile directories without touching root services", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-profile-migration-"));
  const defaultDirectory = path.join(root, "default");
  const workDirectory = path.join(root, "work");
  fs.mkdirSync(defaultDirectory);
  fs.mkdirSync(workDirectory);
  fs.mkdirSync(path.join(root, "bin"));
  fs.mkdirSync(path.join(root, "staging"));
  fs.writeFileSync(path.join(defaultDirectory, "settings.json"), "{}\n");
  fs.writeFileSync(path.join(workDirectory, "projects.json"), "{}\n");
  fs.writeFileSync(path.join(root, "secrets.json"), "{}\n");

  migrateConfigurationRootToProfiles(root);

  assert.equal(fs.existsSync(path.join(root, "profiles", "default", "settings.json")), true);
  assert.equal(fs.existsSync(path.join(root, "profiles", "work", "projects.json")), true);
  assert.equal(fs.existsSync(path.join(root, "default")), false);
  assert.equal(fs.existsSync(path.join(root, "work")), false);
  assert.equal(fs.existsSync(path.join(root, "bin")), true);
  assert.equal(fs.existsSync(path.join(root, "staging")), true);
  assert.equal(fs.existsSync(path.join(root, "secrets.json")), true);

  migrateConfigurationRootToProfiles(root);
  assert.equal(fs.existsSync(path.join(root, "profiles", "default", "settings.json")), true);
});

test("configuration root migration moves root-level state into the default profile", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-root-state-migration-"));
  fs.writeFileSync(path.join(root, "settings.json"), "{}\n");
  fs.writeFileSync(path.join(root, "projects.json"), "{}\n");
  fs.writeFileSync(path.join(root, "workspace-session.json"), "{}\n");

  migrateConfigurationRootToProfiles(root);

  assert.equal(fs.existsSync(path.join(root, "profiles", "default", "settings.json")), true);
  assert.equal(fs.existsSync(path.join(root, "profiles", "default", "projects.json")), true);
  assert.equal(fs.existsSync(path.join(root, "profiles", "default", "workspace-session.json")), true);
  assert.equal(fs.existsSync(path.join(root, "settings.json")), false);
  assert.equal(fs.existsSync(path.join(root, "projects.json")), false);
  assert.equal(fs.existsSync(path.join(root, "workspace-session.json")), false);
});

test("--profile defaults to default and rejects path-like names", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-launch-"));
  assert.equal(resolveProfileLaunch({ argv: ["electron", "."], configurationRoot: root }).profile, "default");
  assert.equal(resolveProfileLaunch({ argv: ["electron", ".", "--profile=remote_2"], configurationRoot: root }).profile, "remote_2");
  assert.throws(() => normalizeProfileName("../outside"), /only letters/);
  assert.throws(() => resolveProfileLaunch({ argv: ["electron", ".", "--profile"], configurationRoot: root }), /requires/);
});

test("launch routing focuses an existing profile and creates an unhosted one", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-launch-routing-"));
  const descriptor = resolveProfileLaunch({ argv: ["electron", "."], configurationRoot: root });

  assert.equal(routeLaunchDescriptor(descriptor, [descriptor.configDirectory]), "focus");
  assert.equal(routeLaunchDescriptor(descriptor, []), "create");
});
