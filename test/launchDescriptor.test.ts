import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const {
  LAUNCH_DESCRIPTOR_VERSION,
  normalizeProfileName,
  parseLaunchDescriptor,
  resolveProfileLaunch,
  routeLaunchDescriptor
} = require(`${process.cwd()}/build/main/launchDescriptor`);

test("profile launch descriptors resolve named profiles below the configuration root", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-launch-"));
  const descriptor = resolveProfileLaunch({ argv: ["electron", ".", "--profile", "work"], configurationRoot: root });

  assert.deepEqual(descriptor, {
    version: LAUNCH_DESCRIPTOR_VERSION,
    profile: "work",
    configurationRoot: root,
    configDirectory: path.join(root, "work"),
    openingTarget: null
  });
  assert.deepEqual(parseLaunchDescriptor(descriptor), descriptor);
  assert.equal(parseLaunchDescriptor({ ...descriptor, version: 2 }), null);
  assert.equal(parseLaunchDescriptor({ ...descriptor, profile: "../outside" }), null);
  assert.equal(parseLaunchDescriptor({ ...descriptor, configDirectory: path.join(root, "other") }), null);
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
