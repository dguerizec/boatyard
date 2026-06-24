import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const roots = ["src", "scripts", "test"];
const jsFiles = [];

function collectJsFiles(directory) {
  for (const entry of readdirSync(directory)) {
    const fullPath = join(directory, entry);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      collectJsFiles(fullPath);
    } else if (/\.[cm]?js$/.test(entry)) {
      jsFiles.push(fullPath);
    }
  }
}

for (const root of roots) {
  try {
    collectJsFiles(root);
  } catch (error) {
    if (error.code !== "ENOENT") {
      throw error;
    }
  }
}

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ["--check", file], {
    encoding: "utf8"
  });

  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }
}

console.log(`Checked ${jsFiles.length} JavaScript files.`);
