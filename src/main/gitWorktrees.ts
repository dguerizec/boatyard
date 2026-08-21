export type GitWorktreeEntry = {
  branch: string;
  detached: boolean;
  path: string;
  usable: boolean;
};

export type GitWorktreeHeadEntry = GitWorktreeEntry & {
  head: string;
};

export function parseGitWorktreesWithHead(output: unknown): GitWorktreeHeadEntry[] {
  const entries: GitWorktreeHeadEntry[] = [];
  let current: Partial<GitWorktreeHeadEntry> | null = null;

  function flush(): void {
    if (current?.path) {
      entries.push({
        branch: current.branch || "",
        detached: current.detached === true,
        head: current.head || "",
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
    } else if (current && key === "HEAD") {
      current.head = value;
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

export function parseGitWorktrees(output: unknown): GitWorktreeEntry[] {
  return parseGitWorktreesWithHead(output).map(({ head: _head, ...worktree }) => worktree);
}
