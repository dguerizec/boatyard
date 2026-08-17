export type GitWorktreeEntry = {
  branch: string;
  detached: boolean;
  path: string;
  usable: boolean;
};

export function parseGitWorktrees(output: unknown): GitWorktreeEntry[] {
  const entries: GitWorktreeEntry[] = [];
  let current: Partial<GitWorktreeEntry> | null = null;

  function flush(): void {
    if (current?.path) {
      entries.push({
        branch: current.branch || "",
        detached: current.detached === true,
        path: current.path,
        usable: current.usable !== false
      });
    }
    current = null;
  }

  for (const line of String(output || "").split(/\r?\n/)) {
    if (!line.trim()) {
      flush();
      continue;
    }

    const [key, ...rest] = line.split(" ");
    const value = rest.join(" ").trim();
    if (key === "worktree") {
      flush();
      current = { path: value, usable: true };
    } else if (current && key === "branch") {
      current.branch = value.replace(/^refs\/heads\//, "");
    } else if (current && key === "detached") {
      current.detached = true;
    } else if (current && key === "prunable") {
      current.usable = false;
    }
  }
  flush();
  return entries;
}
