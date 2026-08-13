"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { activate } = require(`${process.cwd()}/build/plugins/twicc/main`);

test("TwiCC main plugin registers its system resource provider", () => {
  const resourceProviders: string[] = [];
  activate({
    actions: { handle() {} },
    execFileAsync: async () => ({ stdout: "[]" }),
    getState: () => ({}),
    projectInspectors: { register() {} },
    resources: {
      registerProvider(id: string) {
        resourceProviders.push(id);
      }
    }
  });

  assert.deepEqual(resourceProviders, ["boatyard.twicc.systemResources"]);
});

export {};
