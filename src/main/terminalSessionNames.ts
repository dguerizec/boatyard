type TerminalProjectIdentity = {
  id?: string;
  name?: string;
  slug?: string;
};

export function slugifyTmuxName(value: unknown, fallback = "session"): string {
  const normalized = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

export function getProjectTmuxSessionName(
  project: TerminalProjectIdentity,
  sessionPrefix = "boatyard"
): string {
  return `${slugifyTmuxName(sessionPrefix, "boatyard")}-${slugifyTmuxName(
    project.slug || project.name || project.id,
    "project"
  )}`;
}

export function getTerminalClientSessionName(projectSession: string, terminalId: unknown): string {
  return `${projectSession}-client-${slugifyTmuxName(String(terminalId).slice(0, 8), "terminal")}`;
}
