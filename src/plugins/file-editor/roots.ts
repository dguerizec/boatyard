import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";
import type { ExecFileAsync } from "../../shared/pluginTypes";
import { listProjectGitWorktrees } from "../git-worktrees/main";

export type EditorRoot = { path: string; label: string; usable: boolean; project: boolean };

/** Only the project directory and its registered Git worktrees are selectable roots. */
export async function listEditorRoots(sourcePath: string, execFileAsync: ExecFileAsync): Promise<EditorRoot[]> {
  const projectPath = await realpath(sourcePath);
  const roots: EditorRoot[] = [{ path: sourcePath, label: "Project files", usable: true, project: true }];
  try {
    const snapshot = await listProjectGitWorktrees(sourcePath, { execFileAsync });
    for (const worktree of snapshot.worktrees) {
      let path = worktree.path, usable = worktree.usable;
      try { path = await realpath(path); usable &&= (await stat(path)).isDirectory(); }
      catch { usable = false; }
      const label = worktree.branch || (worktree.detached ? "Detached HEAD" : basename(path));
      const existing = roots.find(root => root.path === path || (root.project && path === projectPath));
      if (existing) existing.label = label;
      else roots.push({ path, label, usable, project: false });
    }
  } catch (error) {
    if (!String(error).includes("not a git repository")) throw error;
  }
  return roots;
}

export async function resolveEditorRoot(sourcePath: string, selected: string | undefined, execFileAsync: ExecFileAsync): Promise<string> {
  if (!selected) return sourcePath;
  const projectPath = await realpath(sourcePath);
  if (selected === sourcePath || selected === projectPath) return projectPath;
  const roots = await listEditorRoots(sourcePath, execFileAsync);
  const root = roots.find(root => root.path === selected && root.usable);
  if (!root) throw new Error("This worktree is no longer available. Choose another project root.");
  return root.path;
}
