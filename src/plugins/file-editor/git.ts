import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { parseGitStatus, type GitChangeEntry } from "../../main/gitStatus";
import { byteContent } from "./bytes";
import { MAX_FILE_BYTES } from "./service";

export type EditorGitStatus = { available: boolean; changes: GitChangeEntry[] };
export type GitBaseline = { available: boolean; text: string; revision: string; deleted: boolean; label: string; reason?: string };
const exec = promisify(execFile);
async function git(cwd: string, args: string[]) {
  return (await exec("git", ["--literal-pathspecs", ...args], {
    cwd, encoding: "buffer", timeout: 10000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" }
  })).stdout;
}
async function repository(cwd: string): Promise<string | undefined> {
  try { return (await git(cwd, ["rev-parse", "--show-toplevel"])).toString().trimEnd(); }
  catch (error) {
    if (String((error as { stderr?: Buffer }).stderr).includes("not a git repository")) return;
    throw error;
  }
}
function inside(path: string) { return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path); }

export async function editorGitStatus(root: string): Promise<EditorGitStatus> {
  const base = await realpath(root);
  const repo = await repository(base);
  if (!repo) return { available: false, changes: [] };
  const output = await git(base, ["status", "--porcelain=v2", "-z", "--untracked-files=all", "--", "."]);
  const changes = parseGitStatus(output.toString()).changes.flatMap((entry) => {
    const path = relative(base, resolve(repo, entry.path));
    if (!inside(path)) return [];
    return [{ ...entry, path: path.split(sep).join("/"), originalPath: entry.originalPath
      ? relative(base, resolve(repo, entry.originalPath)).split(sep).join("/") : "" }];
  });
  return { available: true, changes };
}

export async function editorGitBaseline(root: string, file: string): Promise<GitBaseline> {
  if (!file || file.includes("\0")) throw new Error("Choose a file path.");
  const base = await realpath(root);
  let target = resolve(base, file), deleted = false;
  try { target = await realpath(target); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    // Deleted files still have a repository identity, even if their parent was removed.
    deleted = true;
    let parent = dirname(target);
    while (true) {
      try { target = resolve(await realpath(parent), relative(parent, target)); break; }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(parent) === parent) throw error;
        parent = dirname(parent);
      }
    }
  }
  if (!isAbsolute(file) && !inside(relative(base, target))) throw new Error("The file must be inside this project.");
  let directory = dirname(target);
  while (true) {
    try { await stat(directory); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT" || dirname(directory) === directory) throw error;
      directory = dirname(directory);
    }
  }
  const repo = await repository(directory);
  const unavailable = (reason: string): GitBaseline => ({ available: false, text: "", revision: "", deleted, label: "HEAD", reason });
  if (!repo) return unavailable("This file is not in a Git working tree.");
  const path = relative(repo, target).split(sep).join("/");
  let revision: string;
  try { revision = (await git(repo, ["rev-parse", "--verify", "HEAD^{commit}"])).toString().trim(); }
  catch (error) {
    // An unborn branch has no baseline; other failures must remain visible.
    if ((error as { code?: number }).code !== 128) throw error;
    await git(repo, ["symbolic-ref", "HEAD"]);
    return { available: true, text: "", revision: "unborn", deleted, label: "HEAD (no commits)" };
  }
  const status = parseGitStatus((await git(repo, ["status", "--porcelain=v2", "-z", "--untracked-files=no"])).toString());
  const originalPath = status.changes.find((entry) => entry.path === path)?.originalPath || path;
  const entry = (await git(repo, ["ls-tree", "-l", "-z", revision, "--", originalPath])).toString();
  if (!entry) return { available: true, text: "", revision, deleted, label: "HEAD (new file)" };
  const match = entry.match(/^\d+ blob ([a-f\d]+)\s+(\d+)\t/);
  if (!match) return unavailable("Git diff is available for regular text files only.");
  if (Number(match[2]) > MAX_FILE_BYTES) return unavailable(`The HEAD version is larger than ${MAX_FILE_BYTES / 1024 / 1024} MiB. Git diff currently requires a complete text file.`);
  const content = byteContent(await git(repo, ["cat-file", "blob", match[1]]));
  if (content.encoding === "hex") return unavailable("The HEAD version is binary. Use Hex mode to inspect the current file.");
  return { available: true, text: content.text, revision, deleted, label: originalPath === path ? "HEAD" : `HEAD · ${originalPath}` };
}
