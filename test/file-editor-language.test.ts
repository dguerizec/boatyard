import assert from "node:assert/strict";
import { test } from "node:test";
import { EditorState } from "@codemirror/state";
import { syntaxTree } from "@codemirror/language";
import { language } from "../src/plugins/file-editor/language";

function tokens(path: string, doc: string) {
  const state = EditorState.create({ doc, extensions: [language(path)] });
  const result: Record<string, string[]> = {};
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "Document") (result[node.name] ??= []).push(doc.slice(node.from, node.to));
  } });
  return result;
}

test("TOML paths enable highlighting for configuration keys and values", () => {
  for (const path of ["pyproject.toml", "/workspace/example/.pier.toml", "config/SETTINGS.TOML"]) {
    const result = tokens(path, '# config\n[server]\nport = 8080\nname = "web"\nenabled = true');
    assert.deepEqual(result.comment, ["# config"]);
    assert.deepEqual(result.propertyName, ["port", "name", "enabled"]);
    assert.deepEqual(result.string, ['"web"']);
    assert.deepEqual(result.number, ["8080"]);
    assert.deepEqual(result.atom, ["[server]", "true"]);
  }
});

test("Docker build filenames enable instruction highlighting without treating parent directories as extensions", () => {
  const doc = '# build\nFROM alpine:3\nRUN echo "hello"\nEXPOSE 8080';
  for (const path of ["Dockerfile", "docker/Dockerfile.dev", "build/api.dockerfile", "Containerfile", "Containerfile.prod", "api.containerfile", "C:\\workspace\\Dockerfile"]) {
    const result = tokens(path, doc);
    assert.deepEqual(result.keyword, ["FROM", "RUN", "EXPOSE"], path);
    assert.deepEqual(result.comment, ["# build"], path);
    assert.deepEqual(result.string, ['"hello"'], path);
    assert.deepEqual(result.number, ["8080"], path);
  }
  for (const path of ["notes.txt", "folder.toml/README", "Dockerfile/README"]) {
    assert.deepEqual(tokens(path, doc), {}, path);
  }
});

test("paged highlighting is line-oriented and skips a continued first fragment", () => {
  const doc = '"partial string\n{"level":"INFO","count":42}\n';
  const state = EditorState.create({ doc, extensions: [language("events.jsonl", { continuation: true })] });
  const ranges: { name: string; from: number; text: string }[] = [];
  syntaxTree(state).iterate({ enter(node) {
    if (node.name !== "Document") ranges.push({ name: node.name, from: node.from, text: doc.slice(node.from, node.to) });
  } });
  assert.ok(ranges.length > 0);
  assert.ok(ranges.every(range => range.from >= doc.indexOf("\n") + 1));
  assert.ok(ranges.some(range => range.text === "42"));
  assert.deepEqual(language("nested.json", { continuation: false }), []);
  assert.deepEqual(language("module.ts", { continuation: false }), []);
  assert.ok(Object.keys(tokens("app.log", "2026-09-21 INFO connected\nERROR failed")).length > 0);
});
