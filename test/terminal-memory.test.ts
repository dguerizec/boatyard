import assert from "node:assert/strict";
import test from "node:test";
const { getWindowMemoryBytes, parseProcessMemoryRows } = require(`${process.cwd()}/build/main/terminalMemory`);

test("terminal RAM includes all pane descendants once and excludes unrelated processes", () => {
  const processes = parseProcessMemoryRows([
    "  10  1  1024",
    "11 10 2048",
    "12 11 4096",
    "20 1 512",
    "21 20 256",
    "30 1 128",
    "99 1 999999",
    "invalid row",
    "0 1 100",
    "40 1 NaN"
  ].join("\n"));
  const memory = getWindowMemoryBytes("@1\t10\n@1\t20\n@1\t11\n@2\t30\n@3\t404", processes);
  assert.equal(memory.get("@1"), (1024 + 2048 + 4096 + 512 + 256) * 1024);
  assert.equal(memory.get("@2"), 128 * 1024);
  assert.equal(memory.get("@3"), null);
});

test("missing process samples are unavailable while a valid zero remains zero", () => {
  assert.equal(getWindowMemoryBytes("@1\t10", []).get("@1"), null);
  assert.equal(getWindowMemoryBytes("@1\t10", parseProcessMemoryRows("10 1 0")).get("@1"), 0);
  assert.equal(getWindowMemoryBytes("@1\t10\n@1\t20", parseProcessMemoryRows("10 1 10")).get("@1"), null);
});

test("terminal memory sampling deduplicates simultaneous process reads and handles failure", async () => {
  const childProcess = require("node:child_process");
  const { promisify } = require("node:util");
  const original = childProcess.execFile;
  const modulePath = require.resolve(`${process.cwd()}/build/main/terminalMemory`);
  let calls = 0;
  const mock = () => {};
  Object.assign(mock, { [promisify.custom]: async () => {
    calls += 1;
    if (calls > 1) throw new Error("ps unavailable");
    return { stdout: "10 1 2048\n11 10 1024" };
  } });
  childProcess.execFile = mock;
  delete require.cache[modulePath];
  try {
    const { createTerminalMemoryReader } = require(modulePath);
    const read = createTerminalMemoryReader();
    const [first, second] = await Promise.all([read("@1\t10"), read("@2\t11")]);
    assert.equal(calls, 1);
    assert.equal(first.get("@1"), 3072 * 1024);
    assert.equal(second.get("@2"), 1024 * 1024);
    const failed = await createTerminalMemoryReader()("@1\t10");
    assert.equal(failed.get("@1"), null);
  } finally {
    childProcess.execFile = original;
    delete require.cache[modulePath];
  }
});
