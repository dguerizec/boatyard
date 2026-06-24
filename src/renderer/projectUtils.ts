type ProjectSearchTarget = {
  group?: unknown;
  name?: unknown;
  slug?: unknown;
  sourcePath?: unknown;
};

export function slugify(value: unknown) {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function deriveRepoUrl(gitUrl: unknown) {
  const trimmed = String(gitUrl || "").trim();

  if (!trimmed) {
    return "";
  }

  const stripGitSuffix = (pathname: string) => pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
  const scpLikeMatch = trimmed.match(/^git@([^:]+):(.+)$/);
  if (scpLikeMatch) {
    return `https://${scpLikeMatch[1]}/${stripGitSuffix(scpLikeMatch[2])}`;
  }

  try {
    const parsed = new URL(trimmed);

    if (parsed.protocol === "ssh:" && parsed.username === "git") {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }

    if (["http:", "https:"].includes(parsed.protocol)) {
      return `https://${parsed.host}${stripGitSuffix(parsed.pathname)}`;
    }
  } catch {
    return "";
  }

  return "";
}

export function deriveProjectNameFromPath(sourcePath: unknown) {
  const segments = String(sourcePath || "")
    .trim()
    .replace(/[/\\]+$/g, "")
    .split(/[/\\]+/)
    .filter(Boolean);

  return segments.at(-1) || "";
}

export function formatProjectNameFromPath(sourcePath: unknown) {
  const projectName = deriveProjectNameFromPath(sourcePath).replace(/[-_]+/g, " ").trim();
  return projectName ? `${projectName.charAt(0).toUpperCase()}${projectName.slice(1)}` : "";
}

export function normalizeProjectSearchText(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

export function projectMatchesSearch(project: ProjectSearchTarget, query: unknown) {
  const normalizedQuery = normalizeProjectSearchText(query);
  if (!normalizedQuery) {
    return true;
  }

  const groupName = String(project.group || "").trim();
  return [
    project.name,
    project.slug,
    project.sourcePath,
    groupName
  ].some((value) => String(value || "").toLowerCase().includes(normalizedQuery));
}
