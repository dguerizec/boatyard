import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const changelogPath = path.join(root, "CHANGELOG.md");
const generatedPath = path.join(root, "src", "shared", "changelog.json");
const packagePath = path.join(root, "package.json");
const releaseCategories = ["Added", "Changed", "Fixed", "Removed", "Deprecated", "Security", "Documentation", "Internal"] as const;
const appChangelogCategories = new Set<string>(["Added", "Changed", "Fixed", "Removed", "Deprecated", "Security"]);
const now = new Date();
const today = [
  now.getFullYear(),
  String(now.getMonth() + 1).padStart(2, "0"),
  String(now.getDate()).padStart(2, "0")
].join("-");

type ReleaseCategory = typeof releaseCategories[number];
type ReleaseType = "major" | "minor" | "patch";
type ScriptMode = "prepare" | "agent" | "release" | "check-release";
type VersionParts = [number, number, number];
type JsonRecord = Record<string, unknown>;

type PackageJson = {
  version: string;
};

type ParsedArgs = {
  codex: string;
  mode: ScriptMode;
  type: ReleaseType | "";
  verbose: boolean;
  version: string;
};

type GitCommit = {
  body: string;
  hash: string;
  subject: string;
};

type GitContext = {
  commits: GitCommit[];
  log: string;
  names: string;
  range: string;
  stat: string;
  tag: string;
};

type ChangelogSummary = {
  body: string;
  sections: Partial<Record<ReleaseCategory, string[]>>;
  title: string;
};

type ChangelogFeature = {
  body: string;
  category: string;
  title: string;
};

type ChangelogRelease = {
  date: string;
  features: ChangelogFeature[];
  version: string;
};

type ChangelogHeader = {
  contentStart: number;
  date: string;
  start: number;
  version: string;
};

type ChangelogCategoryHeader = {
  contentStart: number;
  name: string;
  start: number;
};

type ChangelogSection = {
  body: string;
  end: number;
  header: string;
  headerEnd: number;
  start: number;
};

type CodexExecOptions = {
  verbose?: boolean;
};

type ExecFileError = Error & {
  status?: number;
};

function readJson<T = JsonRecord>(filePath: string): T {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function normalizeVersion(version: unknown) {
  return String(version || "").trim().replace(/^v/i, "");
}

function parseVersion(version: unknown): VersionParts | null {
  const match = normalizeVersion(version).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return match
    ? [
        Number.parseInt(match[1], 10),
        Number.parseInt(match[2], 10),
        Number.parseInt(match[3], 10)
      ]
    : null;
}

function bumpVersion(version: string, type: ReleaseType) {
  const parts = parseVersion(version);
  if (!parts) {
    throw new Error(`Invalid package version: ${version}`);
  }

  if (type === "major") {
    return `${parts[0] + 1}.0.0`;
  }

  if (type === "minor") {
    return `${parts[0]}.${parts[1] + 1}.0`;
  }

  if (type === "patch") {
    return `${parts[0]}.${parts[1]}.${parts[2] + 1}`;
  }

  throw new Error(`Invalid release type: ${type}. Use major, minor, or patch.`);
}

function isReleaseType(value: string): value is ReleaseType {
  return value === "major" || value === "minor" || value === "patch";
}

function parseArgs(argv: string[]): ParsedArgs {
  const args: ParsedArgs = {
    mode: "prepare",
    codex: "codex",
    type: "",
    verbose: false,
    version: ""
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--prepare") {
      args.mode = "prepare";
    } else if (arg === "--agent") {
      args.mode = "agent";
    } else if (arg === "--release") {
      args.mode = "release";
    } else if (arg === "--check-release") {
      args.mode = "check-release";
    } else if (arg === "--codex") {
      args.codex = argv[index + 1] || "";
      index += 1;
    } else if (arg === "--verbose") {
      const value = argv[index + 1] || "";
      args.verbose = ["1", "true", "yes", "on"].includes(value.toLowerCase());
      index += 1;
    } else if (arg === "--type") {
      const value = argv[index + 1] || "";
      if (!isReleaseType(value)) {
        throw new Error(`Invalid release type: ${value}. Use major, minor, or patch.`);
      }
      args.type = value;
      index += 1;
    } else if (arg === "--version") {
      args.version = argv[index + 1] || "";
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function runGit(args: string[], fallback = "") {
  try {
    return execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return fallback;
  }
}

function runGitRequired(args: string[]) {
  return execFileSync("git", args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    maxBuffer: 1024 * 1024 * 16
  }).trim();
}

function getLatestTag() {
  return runGit(["tag", "--list", "v*", "--sort=-v:refname"]).split("\n").filter(Boolean)[0] || "";
}

function getCommitsSince(tag: string): GitCommit[] {
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const output = runGit(["log", "--reverse", "--no-merges", "--format=%H%x1f%s%x1f%b%x1e", range]);

  return output
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [hash, subject, body] = entry.split("\x1f");
      return {
        hash: String(hash || "").trim(),
        subject: String(subject || "").trim(),
        body: String(body || "").trim()
      };
    })
    .filter((commit) => commit.subject && !/^release\b/i.test(commit.subject) && !/changelog/i.test(commit.subject));
}

function buildGitContext(): GitContext {
  const tag = getLatestTag();
  const range = tag ? `${tag}..HEAD` : "HEAD";
  const commits = getCommitsSince(tag);

  if (!commits.length) {
    throw new Error(tag ? `No commits found since ${tag}.` : "No commits found.");
  }

  const log = runGitRequired([
    "log",
    "--reverse",
    "--no-merges",
    "--format=commit %H%nsubject: %s%nbody:%n%b%nfiles:",
    "--name-status",
    range
  ]);
  const stat = runGit(["diff", "--stat", range]);
  const names = runGit(["diff", "--name-status", range]);

  return {
    tag,
    range,
    commits,
    log,
    stat,
    names
  };
}

function humanizeSubject(subject: string) {
  return subject
    .replace(/^[a-z]+(?:\([^)]+\))?!?:\s*/i, "")
    .replace(/\.$/, "")
    .trim();
}

function toTitle(text: string) {
  const cleaned = humanizeSubject(text);
  return cleaned ? `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)}` : "Boatyard update";
}

function classifyCommit(subject: string): ReleaseCategory {
  const normalized = subject.toLowerCase();

  if (/^(fix|bugfix|hotfix)(\b|\(|:)/.test(normalized) || normalized.includes("fix")) {
    return "Fixed";
  }

  if (/^(feat|add)(\b|\(|:)/.test(normalized) || normalized.includes("add")) {
    return "Added";
  }

  return "Changed";
}

function summarizeCommits(commits: GitCommit[]): ChangelogSummary {
  if (!commits.length) {
    return {
      title: "Unreleased: Maintenance update",
      body: "small maintenance improvements and cleanup.",
      sections: {
        Changed: ["**Maintenance** — small internal improvements and cleanup."]
      }
    };
  }

  const sections: Partial<Record<ReleaseCategory, string[]>> = {};
  for (const commit of commits) {
    const category = classifyCommit(commit.subject);
    const title = toTitle(commit.subject);
    const body = commit.body.split("\n").find((line) => line.trim()) || `${humanizeSubject(commit.subject)}.`;
    sections[category] ||= [];
    sections[category].push(`**${title}** — ${body.replace(/\s+/g, " ").trim()}`);
  }

  return {
    title: `Unreleased: ${toTitle(commits[0].subject)}`,
    body: `${commits.length} user-facing changes since the previous release.`,
    sections
  };
}

function changelogPreamble() {
  return [
    "# Changelog",
    "",
    "All notable changes to this project will be documented in this file.",
    "",
    "The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html). As a small deviation, each release opens with a one-line **Summary** recapping its highlights, and some entries include illustrative screenshots in nested sub-lists.",
    ""
  ].join("\n");
}

function latestReleaseExample(markdown: string) {
  const release = parseChangelog(markdown).find((entry) => entry.version !== "Unreleased");
  if (!release) {
    return "";
  }

  const section = findSection(markdown, release.version);
  return section ? markdown.slice(section.start, section.end).trim() : "";
}

function buildAgentPrompt() {
  const markdown = readChangelog();
  const context = buildGitContext();
  const existingUnreleased = findSection(markdown, "Unreleased");
  const previousRelease = latestReleaseExample(markdown);
  const existingSection = existingUnreleased
    ? markdown.slice(existingUnreleased.start, existingUnreleased.end).trim()
    : "";

  return [
    "You are writing the Boatyard changelog.",
    "",
    "Task:",
    "- Generate a polished Keep a Changelog `## [Unreleased]` section from the Git changes since the latest release tag.",
    "- Output only Markdown for that section. Do not wrap it in a code fence. Do not edit files.",
    "- The first line must be exactly `## [Unreleased]`.",
    "",
    "Audience and tone:",
    "- Write for users, not maintainers.",
    "- Keep entries concise, concrete, and user-facing.",
    "- Focus the app-visible categories on features, UI changes, update behavior, and fixes that affect users after the update is installed.",
    "- Do not put first-install instructions, release-author workflow, CI, packaging internals, variable renames, mechanical cleanup, or dependency churn in app-visible categories.",
    "- If a documentation-only change is worth noting, put it under `### Documentation`.",
    "- If a maintainer/release/development workflow change is worth noting, put it under `### Internal`.",
    "- Use `Documentation` and `Internal` for the human CHANGELOG.md only; they will not be shown in Boatyard's in-app What's new dialog.",
    "- Ignore purely internal refactors unless they change behavior users can observe.",
    "- Do not mention commit hashes.",
    "- Keep all text in English.",
    "",
    "Required format:",
    "- Start with `## [Unreleased]`.",
    "- Include `### Summary` with exactly one bullet.",
    "- The summary bullet must look like `- **Unreleased: Short release name** — one sentence recap.`",
    "- Then include only useful categories, chosen from `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, `Security`, `Documentation`, and `Internal`.",
    "- `Added`, `Changed`, `Fixed`, `Removed`, `Deprecated`, and `Security` must be useful inside the in-app post-update dialog.",
    "- `Documentation` and `Internal` must be understandable in CHANGELOG.md but are not app-visible.",
    "- Each item must look like `- **Short title** — brief user-facing explanation.`",
    "- Do not include empty categories.",
    "",
    "Investigation rules:",
    "- The compact Git context below is the primary source.",
    "- If a commit is ambiguous, you may inspect it with `git show <hash>` in this repository.",
    "- Do not run broad searches unless the compact context and targeted `git show` are insufficient.",
    "",
    previousRelease ? ["Latest existing release style:", "```markdown", previousRelease, "```", ""].join("\n") : "",
    existingSection ? ["Existing [Unreleased] draft, if useful:", "```markdown", existingSection, "```", ""].join("\n") : "",
    `Latest release tag: ${context.tag || "(none)"}`,
    `Git range: ${context.range}`,
    "",
    "Diff stat:",
    "```text",
    context.stat || "(none)",
    "```",
    "",
    "Changed files:",
    "```text",
    context.names || "(none)",
    "```",
    "",
    "Compact git log:",
    "```text",
    context.log,
    "```"
  ].filter((part) => part !== "").join("\n");
}

function buildDraftSection(commits: GitCommit[]) {
  const summary = summarizeCommits(commits);
  const lines = [
    "## [Unreleased]",
    "",
    "### Summary",
    "",
    `- **${summary.title}** — ${summary.body}`,
    ""
  ];

  for (const category of releaseCategories) {
    const items = summary.sections[category] || [];
    if (!items.length) {
      continue;
    }

    lines.push(`### ${category}`, "");
    for (const item of items) {
      lines.push(`- ${item}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

function readChangelog() {
  return fs.existsSync(changelogPath)
    ? fs.readFileSync(changelogPath, "utf8").trimEnd()
    : changelogPreamble().trimEnd();
}

function extractUnreleasedSection(output: string) {
  let cleaned = output.trim();
  const fenced = cleaned.match(/^```(?:markdown|md)?\s*\n([\s\S]*?)\n```$/i);
  if (fenced) {
    cleaned = fenced[1].trim();
  }

  const sections: string[] = [];
  const headingPattern = /^## \[Unreleased\](?:\s*-.*)?$/gm;
  let match = null;
  while ((match = headingPattern.exec(cleaned)) !== null) {
    const nextPattern = /^## \[/gm;
    nextPattern.lastIndex = match.index + match[0].length;
    const next = nextPattern.exec(cleaned);
    sections.push(cleaned.slice(match.index, next ? next.index : cleaned.length).trimEnd());
  }

  const section = sections.at(-1);
  if (!section) {
    throw new Error("Codex did not output a `## [Unreleased]` section.");
  }

  return section;
}

function replaceUnreleasedSection(section: string) {
  const current = readChangelog();
  const existing = findSection(current, "Unreleased");

  if (existing) {
    const next = `${current.slice(0, existing.start)}${section}${current.slice(existing.end)}`;
    fs.writeFileSync(changelogPath, `${next.trimEnd()}\n`);
    return;
  }

  const firstReleaseIndex = current.search(/^## \[/m);
  const content = current.startsWith("# Changelog") && firstReleaseIndex >= 0
    ? `${current.slice(0, firstReleaseIndex).trimEnd()}\n\n${section}\n\n${current.slice(firstReleaseIndex).trimStart()}`
    : current.startsWith("# Changelog")
      ? `${current}\n\n${section}`
      : `${changelogPreamble()}${section}\n\n${current}\n`;

  fs.writeFileSync(changelogPath, `${content.trimEnd()}\n`);
}

function tailFile(filePath: string, lineCount = 80) {
  try {
    return fs.readFileSync(filePath, "utf8").trimEnd().split("\n").slice(-lineCount).join("\n");
  } catch {
    return "";
  }
}

function runCodexExec(codexCommand: string, prompt: string, { verbose = false }: CodexExecOptions = {}) {
  if (!codexCommand.trim()) {
    throw new Error("--codex cannot be empty.");
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-changelog-"));
  const outputPath = path.join(tmpDir, "last-message.md");
  const logPath = path.join(tmpDir, "codex.log");
  const logFd = verbose ? "inherit" : fs.openSync(logPath, "w");

  try {
    console.log("Generating CHANGELOG.md with Codex...");
    execFileSync(
      "sh",
      ["-lc", `${codexCommand} exec --ephemeral --color never --output-last-message "$2" "$1"`, "codex-changelog", prompt, outputPath],
      {
        cwd: root,
        encoding: "utf8",
        stdio: ["ignore", logFd, logFd],
        maxBuffer: 1024 * 1024 * 16
      }
    );

    return fs.readFileSync(outputPath, "utf8");
  } catch (error) {
    const execError = error as ExecFileError;
    if (execError.status === 127) {
      throw new Error(`Cannot run ${codexCommand}. Set CODEX to the Codex CLI command, for example: make changelog CODEX=/path/to/codex`);
    }
    const logTail = verbose ? "" : tailFile(logPath);
    if (logTail) {
      console.error("Codex changelog generation failed. Last log lines:");
      console.error(logTail);
    }
    throw error;
  } finally {
    if (typeof logFd === "number") {
      fs.closeSync(logFd);
    }
    fs.rmSync(tmpDir, { force: true, recursive: true });
  }
}

function generateUnreleasedWithAgent(codexCommand: string, options: CodexExecOptions = {}) {
  const prompt = buildAgentPrompt();
  const output = runCodexExec(codexCommand, prompt, options);
  const section = extractUnreleasedSection(output);
  replaceUnreleasedSection(section);
}

function findSection(markdown: string, name: string): ChangelogSection | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`^## \\[${escaped}\\](?:\\s*-\\s*.*)?$`, "m").exec(markdown);
  if (!match) {
    return null;
  }

  const nextMatch = /^## \[/gm;
  nextMatch.lastIndex = match.index + match[0].length;
  const next = nextMatch.exec(markdown);

  return {
    start: match.index,
    headerEnd: match.index + match[0].length,
    end: next ? next.index : markdown.length,
    header: match[0],
    body: markdown.slice(match.index + match[0].length, next ? next.index : markdown.length).trim()
  };
}

function ensureUnreleasedSection() {
  const current = readChangelog();
  const existing = findSection(current, "Unreleased");

  if (existing) {
    return false;
  }

  const draft = buildDraftSection(getCommitsSince(getLatestTag()));
  const firstReleaseIndex = current.search(/^## \[/m);
  const content = current.startsWith("# Changelog") && firstReleaseIndex >= 0
    ? `${current.slice(0, firstReleaseIndex).trimEnd()}\n\n${draft}\n\n${current.slice(firstReleaseIndex).trimStart()}`
    : current.startsWith("# Changelog")
      ? `${current}\n\n${draft}`
      : `${changelogPreamble()}${draft}\n\n${current}\n`;

  fs.writeFileSync(changelogPath, `${content.trimEnd()}\n`);
  return true;
}

function promoteUnreleased(version: string) {
  const current = readChangelog();
  const existingRelease = findSection(current, version);
  if (existingRelease) {
    return false;
  }

  const unreleased = findSection(current, "Unreleased");
  if (!unreleased) {
    throw new Error("CHANGELOG.md is missing an [Unreleased] section. Run make changelog and review it first.");
  }

  const releaseBody = current
    .slice(unreleased.headerEnd, unreleased.end)
    .replace(/^- \*\*Unreleased:/m, `- **v${version}:`);
  const replacement = `## [${version}] - ${today}${releaseBody}`;
  const next = `${current.slice(0, unreleased.start)}${replacement}${current.slice(unreleased.end)}`;
  fs.writeFileSync(changelogPath, `${next.trimEnd()}\n`);
  return true;
}

function parseFeature(line: string, category: string): ChangelogFeature {
  const boldMatch = line.match(/^\*\*(.+?)\*\*\s*[—-]\s*(.+)$/);
  if (boldMatch) {
    return {
      category,
      title: boldMatch[1].trim(),
      body: boldMatch[2].trim()
    };
  }

  const [title, ...rest] = line.split(/\s+[—-]\s+/);
  return {
    category,
    title: (title || category).trim(),
    body: (rest.join(" — ") || line).trim()
  };
}

function parseChangelog(markdown: string): ChangelogRelease[] {
  const releaseHeaderPattern = /^## \[([^\]]+)\](?:\s*-\s*(.+))?$/gm;
  const headers: ChangelogHeader[] = [];
  let match = null;

  while ((match = releaseHeaderPattern.exec(markdown)) !== null) {
    headers.push({
      version: normalizeVersion(match[1]),
      date: String(match[2] || "").trim(),
      start: match.index,
      contentStart: releaseHeaderPattern.lastIndex
    });
  }

  return headers.map((header, index) => {
    const end = headers[index + 1]?.start ?? markdown.length;
    const content = markdown.slice(header.contentStart, end);
    const categoryPattern = /^### (.+)$/gm;
    const categories: ChangelogCategoryHeader[] = [];
    let categoryMatch = null;

    while ((categoryMatch = categoryPattern.exec(content)) !== null) {
      categories.push({
        name: categoryMatch[1].trim(),
        start: categoryMatch.index,
        contentStart: categoryPattern.lastIndex
      });
    }

    const features: ChangelogFeature[] = [];
    for (let categoryIndex = 0; categoryIndex < categories.length; categoryIndex += 1) {
      const category = categories[categoryIndex];
      if (category.name.toLowerCase() === "summary" || !appChangelogCategories.has(category.name)) {
        continue;
      }

      const categoryEnd = categories[categoryIndex + 1]?.start ?? content.length;
      const categoryContent = content.slice(category.contentStart, categoryEnd);
      for (const line of categoryContent.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("- ") && !trimmed.startsWith("- ![")) {
          features.push(parseFeature(trimmed.slice(2).trim(), category.name));
        }
      }
    }

    return {
      version: header.version,
      date: header.date,
      features
    };
  }).filter((release) => parseVersion(release.version));
}

function buildGeneratedJson(version = "") {
  if (!fs.existsSync(changelogPath)) {
    throw new Error("CHANGELOG.md is missing. Run make changelog first.");
  }

  const releases = parseChangelog(fs.readFileSync(changelogPath, "utf8"));

  if (version) {
    const release = releases.find((entry) => entry.version === version);

    if (!release) {
      throw new Error(`CHANGELOG.md is missing a section for ${version}. Run make changelog and then make patch/minor/major.`);
    }

    if (!release.features.length) {
      throw new Error(`CHANGELOG.md section ${version} has no feature entries outside Summary.`);
    }
  }

  return `${JSON.stringify({
    generatedForVersion: version || readJson<PackageJson>(packagePath).version,
    releases
  }, null, 2)}\n`;
}

function generateJson(version = "") {
  fs.mkdirSync(path.dirname(generatedPath), { recursive: true });
  fs.writeFileSync(generatedPath, buildGeneratedJson(version));
}

function validateGeneratedJson(version: string) {
  const expected = buildGeneratedJson(version);
  const actual = fs.existsSync(generatedPath) ? fs.readFileSync(generatedPath, "utf8") : "";

  if (actual !== expected) {
    throw new Error(`${path.relative(root, generatedPath)} is missing or stale. Run make changelog or make ${args.type}.`);
  }
}

const args = parseArgs(process.argv.slice(2));
const currentVersion = readJson<PackageJson>(packagePath).version;
const targetVersion = args.version
  ? normalizeVersion(args.version)
  : args.type
    ? bumpVersion(currentVersion, args.type)
    : "";

if (targetVersion && !parseVersion(targetVersion)) {
  throw new Error(`Invalid target version: ${targetVersion}`);
}

if (args.mode === "agent") {
  generateUnreleasedWithAgent(args.codex, { verbose: args.verbose });
  console.log("Generated CHANGELOG.md [Unreleased] with Codex.");
  generateJson();
  console.log(`Generated ${path.relative(root, generatedPath)} from versioned changelog sections.`);
} else if (args.mode === "prepare") {
  const created = ensureUnreleasedSection();
  console.log(created
    ? "Created CHANGELOG.md [Unreleased] section. Review it before release."
    : "CHANGELOG.md already contains [Unreleased]. Keeping existing review text.");
  generateJson();
  console.log(`Generated ${path.relative(root, generatedPath)} from versioned changelog sections.`);
} else if (args.mode === "release") {
  if (!targetVersion) {
    throw new Error("--release requires --type or --version.");
  }
  promoteUnreleased(targetVersion);
  generateJson(targetVersion);
  console.log(`Promoted CHANGELOG.md [Unreleased] to ${targetVersion}.`);
  console.log(`Generated ${path.relative(root, generatedPath)} for ${targetVersion}.`);
} else if (args.mode === "check-release") {
  if (!targetVersion) {
    throw new Error("--check-release requires --type or --version.");
  }
  validateGeneratedJson(targetVersion);
  console.log(`Validated changelog data for ${targetVersion}.`);
}
