export type GitChangeKind = "conflict" | "modified" | "staged" | "untracked";

export type GitChangeEntry = {
  indexStatus: string;
  kind: GitChangeKind;
  originalPath: string;
  path: string;
  staged: boolean;
  workingTreeStatus: string;
};

export type GitStatusSnapshot = {
  ahead: number;
  behind: number;
  branch: string;
  changes: GitChangeEntry[];
};

const CONFLICT_STATUS_CODES = new Set([
  "DD",
  "AU",
  "UD",
  "UA",
  "DU",
  "AA",
  "UU"
]);

function normalizeStatus(value: unknown): string {
  const status = String(value || ".").slice(0, 1);
  return status === " " ? "." : status;
}

function createChange(
  path: string,
  indexStatus: unknown,
  workingTreeStatus: unknown,
  originalPath = "",
  forceConflict = false
): GitChangeEntry {
  const index = normalizeStatus(indexStatus);
  const workingTree = normalizeStatus(workingTreeStatus);
  const combined = `${index}${workingTree}`;
  const conflict = forceConflict || CONFLICT_STATUS_CODES.has(combined);
  const untracked = index === "?" && workingTree === "?";
  const staged = !untracked && index !== ".";
  const kind: GitChangeKind = conflict
    ? "conflict"
    : untracked
      ? "untracked"
      : workingTree !== "."
        ? "modified"
        : "staged";

  return {
    indexStatus: index,
    kind,
    originalPath,
    path,
    staged,
    workingTreeStatus: workingTree
  };
}

function parseOrdinaryRecord(record: string): GitChangeEntry | null {
  const match = record.match(/^1 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s);
  if (!match) {
    return null;
  }
  return createChange(match[2], match[1][0], match[1][1]);
}

function parseRenameRecord(record: string, originalPath: string): GitChangeEntry | null {
  const match = record.match(/^2 ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s);
  if (!match) {
    return null;
  }
  return createChange(match[2], match[1][0], match[1][1], originalPath);
}

function parseUnmergedRecord(record: string): GitChangeEntry | null {
  const match = record.match(/^u ([^ ]{2}) [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ [^ ]+ (.*)$/s);
  if (!match) {
    return null;
  }
  return createChange(match[2], match[1][0], match[1][1], "", true);
}

export function parseGitStatus(output: unknown): GitStatusSnapshot {
  const records = String(output || "").split("\0");
  const changes: GitChangeEntry[] = [];
  let ahead = 0;
  let behind = 0;
  let branch = "";

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (!record) {
      continue;
    }

    if (record.startsWith("# branch.head ")) {
      const head = record.slice("# branch.head ".length).trim();
      branch = head === "(detached)" ? "Detached HEAD" : head;
      continue;
    }

    if (record.startsWith("# branch.ab ")) {
      const match = record.match(/^# branch\.ab \+(\d+) -(\d+)$/);
      if (match) {
        ahead = Number(match[1]);
        behind = Number(match[2]);
      }
      continue;
    }

    let change: GitChangeEntry | null = null;
    if (record.startsWith("1 ")) {
      change = parseOrdinaryRecord(record);
    } else if (record.startsWith("2 ")) {
      change = parseRenameRecord(record, records[index + 1] || "");
      index += 1;
    } else if (record.startsWith("u ")) {
      change = parseUnmergedRecord(record);
    } else if (record.startsWith("? ")) {
      change = createChange(record.slice(2), "?", "?");
    }

    if (change) {
      changes.push(change);
    }
  }

  changes.sort((left, right) => (
    left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" })
  ));

  return { ahead, behind, branch, changes };
}
