export type UnknownRecord = Record<string, unknown>;

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type VersionParts = [number, number, number];

export const DEFAULT_BOUNDS = {
  x: 48,
  y: 92,
  width: 720,
  height: 460
};

export const DEFAULT_WINDOW_BOUNDS = {
  x: 80,
  y: 60,
  width: 1280,
  height: 820
};

export function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function toRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

export function getErrorCode(error: unknown): string {
  return isRecord(error) ? String(error.code || "") : "";
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

export function normalizeUrl(rawUrl: unknown): string {
  const trimmed = String(rawUrl || "").trim();

  if (!trimmed) {
    throw new Error("URL is required.");
  }

  const hasProtocol = /^[a-zA-Z][a-zA-Z\d+\-.]*:\/\//.test(trimmed);
  const isLocalhost = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d+)?(?:\/|$)/.test(trimmed);
  const withProtocol = hasProtocol
    ? trimmed
    : `${isLocalhost ? "http" : "https"}://${trimmed}`;
  const parsed = new URL(withProtocol);

  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https URLs are supported.");
  }

  return parsed.toString();
}

export function normalizeOptionalUrl(rawUrl: unknown): string {
  const trimmed = String(rawUrl || "").trim();
  return trimmed ? normalizeUrl(trimmed) : "";
}

export function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

export function normalizeMultilineText(value: unknown): string {
  return String(value || "").replace(/\r\n?/g, "\n").trim();
}

function stripGitSuffix(pathname: string): string {
  return pathname.replace(/\/+$/g, "").replace(/\.git$/i, "");
}

export function deriveRepoUrl(gitUrl: unknown): string {
  const trimmed = normalizeText(gitUrl);

  if (!trimmed) {
    return "";
  }

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

export function slugify(value: unknown): string {
  return String(value || "")
    .trim()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function normalizeSlug(slug: unknown, name: unknown): string {
  const normalized = slugify(slug || name);

  if (!normalized) {
    throw new Error("Slug is required.");
  }

  return normalized;
}

export function normalizeBounds(
  bounds: unknown,
  fallback: Bounds = DEFAULT_BOUNDS
): Bounds {
  const source = toRecord(bounds);
  const x = Number(source.x);
  const y = Number(source.y);
  const width = Number(source.width);
  const height = Number(source.height);
  const next = {
    x: Number.isFinite(x) ? x : fallback.x,
    y: Number.isFinite(y) ? y : fallback.y,
    width: Number.isFinite(width) ? width : fallback.width,
    height: Number.isFinite(height) ? height : fallback.height
  };

  return {
    x: Math.max(0, Math.round(next.x)),
    y: Math.max(0, Math.round(next.y)),
    width: Math.max(260, Math.round(next.width)),
    height: Math.max(200, Math.round(next.height))
  };
}

export function normalizeWindowBounds(bounds: unknown, fallback: Bounds = DEFAULT_WINDOW_BOUNDS): Bounds {
  const normalized = normalizeBounds(bounds, fallback);

  return {
    ...normalized,
    width: Math.max(920, normalized.width),
    height: Math.max(620, normalized.height)
  };
}

function parseVersion(version: unknown): VersionParts | null {
  const match = normalizeText(version).match(/^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/i);
  return match
    ? [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10)
      ]
    : null;
}

export function compareVersions(left: unknown, right: unknown): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);

  if (!leftParts || !rightParts) {
    return 0;
  }

  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) {
      return 1;
    }

    if (leftParts[index] < rightParts[index]) {
      return -1;
    }
  }

  return 0;
}
