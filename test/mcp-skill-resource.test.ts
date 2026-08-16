import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

test("the packaged app build contains the complete Boatyard MCP skill", () => {
  const sourceDirectory = join(process.cwd(), "src", "resources", "skills", "boatyard-mcp");
  const buildDirectory = join(process.cwd(), "build", "resources", "skills", "boatyard-mcp");
  const sourceSkill = readFileSync(join(sourceDirectory, "SKILL.md"), "utf8");
  const buildSkill = readFileSync(join(buildDirectory, "SKILL.md"), "utf8");
  const sourceMetadata = readFileSync(join(sourceDirectory, "agents", "openai.yaml"), "utf8");
  const buildMetadata = readFileSync(join(buildDirectory, "agents", "openai.yaml"), "utf8");

  assert.equal(buildSkill, sourceSkill);
  assert.equal(buildMetadata, sourceMetadata);
  assert.match(buildSkill, /^---\nname: boatyard-mcp\n/);
  assert.match(buildSkill, /codex mcp add boatyard/);
  assert.match(buildSkill, /claude mcp add --transport http/);
  assert.match(buildSkill, /hermes mcp add boatyard/);
  assert.match(buildSkill, /list_windows/);
  assert.match(buildSkill, /update_pane/);
  assert.match(buildSkill, /navigate_pane/);
  assert.match(buildMetadata, /value: "boatyard"/);
});
