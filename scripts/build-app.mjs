import { cpSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const sourceRoot = "src";
const buildRoot = "build";
const copyExtensions = new Set([
  ".css",
  ".html",
  ".json",
  ".png",
  ".svg"
]);

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: "inherit"
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function copyStaticAssets(directory) {
  for (const entry of readdirSync(directory)) {
    const sourcePath = join(directory, entry);
    const stats = statSync(sourcePath);

    if (stats.isDirectory()) {
      copyStaticAssets(sourcePath);
      continue;
    }

    if (!copyExtensions.has(extname(entry))) {
      continue;
    }

    const targetPath = join(buildRoot, relative(sourceRoot, sourcePath));
    mkdirSync(dirname(targetPath), { recursive: true });
    cpSync(sourcePath, targetPath);
  }
}

rmSync(buildRoot, { recursive: true, force: true });
run("npx", ["tsc", "-p", "tsconfig.build.json"]);
copyStaticAssets(sourceRoot);
writeFileSync(
  join(buildRoot, "package.json"),
  `${JSON.stringify({ main: "main/main.js" }, null, 2)}\n`
);
