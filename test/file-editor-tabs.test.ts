import assert from "node:assert/strict";
import { test } from "node:test";
import type { BrowserWindow, OpenDialogOptions } from "electron";
import { FileTabs } from "../src/plugins/file-editor/tabs";
import { selectEditorFiles } from "../src/main/filePicker";

test("file tabs restore valid paths, reuse opened tabs, and select the adjacent tab on close", () => {
  const tabs = new FileTabs(["src/a.ts", "src/a.ts", null, "", "bad\0path", "/workspace/external.txt", "src/b.ts"]);
  assert.deepEqual(tabs.paths, ["src/a.ts", "/workspace/external.txt", "src/b.ts"]);
  tabs.open("src/a.ts");
  assert.equal(tabs.paths.length, 3);
  assert.equal(tabs.neighbor("src/a.ts"), "/workspace/external.txt");
  tabs.close("src/a.ts");
  assert.equal(tabs.active, "/workspace/external.txt");
  tabs.close("src/b.ts");
  assert.equal(tabs.active, "/workspace/external.txt");
  tabs.close("/workspace/external.txt");
  assert.equal(tabs.active, "");
  assert.deepEqual(tabs.paths, []);
  assert.deepEqual(new FileTabs({ paths: ["bad"] }).paths, []);
});

test("native file picker uses the requesting window, supports multiple files, and treats cancellation as empty", async () => {
  const parent = {} as BrowserWindow;
  const calls: unknown[][] = [];
  let canceled = false;
  const dialog = { async showOpenDialog(...args: unknown[]) {
    calls.push(args); return { canceled, filePaths: ["/workspace/a.txt", "/workspace/b.md"] };
  } };
  assert.deepEqual(await selectEditorFiles(dialog, parent, "/workspace/current.txt"), ["/workspace/a.txt", "/workspace/b.md"]);
  assert.equal(calls[0][0], parent);
  const options = calls[0][1] as OpenDialogOptions;
  assert.deepEqual(options.properties, ["openFile", "multiSelections"]);
  assert.equal(options.defaultPath, "/workspace/current.txt");
  canceled = true;
  assert.deepEqual(await selectEditorFiles(dialog, undefined, null), []);
  assert.equal(calls[1].length, 1);
  assert.equal((calls[1][0] as OpenDialogOptions).defaultPath, undefined);
});
