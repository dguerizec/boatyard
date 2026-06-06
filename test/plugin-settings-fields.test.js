"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  readFieldValue,
  resolveFieldDefault
} = require("../src/renderer/pluginSettingsFields");

test("plugin settings fields persist dynamic defaults when user value is empty", () => {
  const input = {
    value: "",
    dataset: {
      defaultValue: "dashtop:main"
    }
  };

  assert.equal(
    readFieldValue({ key: "hawserMainSession", label: "Hawser main session" }, input),
    "dashtop:main"
  );
});

test("plugin settings fields keep explicit user values over dynamic defaults", () => {
  const input = {
    value: "custom:session",
    dataset: {
      defaultValue: "dashtop:main"
    }
  };

  assert.equal(
    readFieldValue({ key: "hawserMainSession", label: "Hawser main session" }, input),
    "custom:session"
  );
});

test("plugin settings fields resolve function defaults from context", () => {
  assert.equal(
    resolveFieldDefault({
      defaultValue({ project }) {
        return `${project.slug}:${project.devBranch || "main"}`;
      }
    }, {
      project: {
        slug: "dashtop",
        devBranch: "feature"
      }
    }),
    "dashtop:feature"
  );
});

test("plugin settings fields validate required empty values", () => {
  assert.throws(
    () => readFieldValue({
      key: "required",
      label: "Required field",
      required: true
    }, {
      value: "",
      dataset: {}
    }),
    /Required field is required/
  );
});

test("plugin settings fields normalize URL values through caller hook", () => {
  const input = {
    value: "localhost:3500",
    dataset: {}
  };

  assert.equal(
    readFieldValue({ valueType: "url" }, input, {
      normalizeUrl(value) {
        return `normalized:${value}`;
      }
    }),
    "normalized:localhost:3500"
  );
});
