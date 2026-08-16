import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const MANIFEST_FILE_NAME = ".boatyard-managed.json";
const MANIFEST_SCHEMA_VERSION = 1;

export const MCP_SKILL_ID = "boatyard-mcp";

export type McpSkillTargetId = "codex" | "claude-code" | "hermes";
export type McpSkillStatusState =
  | "conflict"
  | "installed"
  | "modified"
  | "notInstalled"
  | "unavailable"
  | "updateAvailable";

export type McpSkillTargetStatus = {
  detail: string;
  id: McpSkillTargetId;
  installPath: string;
  label: string;
  modifiedFiles: string[];
  sourceVersion: string;
  state: McpSkillStatusState;
};

export type McpSkillMutationResult = {
  message: string;
  target: McpSkillTargetStatus;
};

type McpSkillInstallerOptions = {
  environment?: Record<string, string | undefined>;
  homeDirectory: string;
  sourceDirectory: string;
};

type SkillTarget = {
  id: McpSkillTargetId;
  installPath: string;
  label: string;
};

type SkillSnapshot = {
  digest: string;
  files: Map<string, Buffer>;
  hashes: Record<string, string>;
};

type ManagedManifest = {
  files: Record<string, string>;
  schemaVersion: 1;
  skillId: typeof MCP_SKILL_ID;
  sourceVersion: string;
  targetId: McpSkillTargetId;
};

type Inspection = {
  manifest: ManagedManifest | null;
  snapshot: SkillSnapshot | null;
  status: McpSkillTargetStatus;
  target: SkillTarget;
};

function hashBuffer(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeRelativePath(value: string): string {
  return value.split(sep).join("/");
}

function isSafeRelativePath(value: string): boolean {
  return Boolean(value) &&
    !isAbsolute(value) &&
    !value.split("/").some((part) => !part || part === "." || part === "..");
}

function resolveConfiguredDirectory(value: string | undefined, fallback: string): string {
  const configured = String(value || "").trim();
  return configured && isAbsolute(configured) ? resolve(configured) : fallback;
}

function collectRegularFiles(directory: string, rootDirectory = directory): Map<string, Buffer> {
  const files = new Map<string, Buffer>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    if (entry.isDirectory()) {
      for (const [name, contents] of collectRegularFiles(filePath, rootDirectory)) {
        files.set(name, contents);
      }
      continue;
    }
    if (!entry.isFile()) {
      throw new Error(`Bundled MCP skill contains an unsupported file: ${entry.name}`);
    }
    files.set(normalizeRelativePath(relative(rootDirectory, filePath)), readFileSync(filePath));
  }
  return files;
}

function createSnapshot(sourceDirectory: string): SkillSnapshot {
  const stats = lstatSync(sourceDirectory);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("Bundled MCP skill directory is unavailable.");
  }
  const files = collectRegularFiles(sourceDirectory);
  if (!files.has("SKILL.md")) {
    throw new Error("Bundled MCP skill is missing SKILL.md.");
  }
  const hashes: Record<string, string> = {};
  for (const [name, contents] of [...files].sort(([left], [right]) => left.localeCompare(right))) {
    hashes[name] = hashBuffer(contents);
  }
  const digest = hashBuffer(Buffer.from(
    Object.entries(hashes).map(([name, hash]) => `${name}\0${hash}\n`).join(""),
    "utf8"
  ));
  return { digest, files, hashes };
}

function readManifest(target: SkillTarget): ManagedManifest | null {
  const manifestPath = join(target.installPath, MANIFEST_FILE_NAME);
  if (!existsSync(manifestPath)) {
    return null;
  }
  const stats = lstatSync(manifestPath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error("The Boatyard ownership manifest is not a regular file.");
  }
  const parsed: unknown = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("The Boatyard ownership manifest is invalid.");
  }
  const source = parsed as Record<string, unknown>;
  const filesSource = source.files;
  if (
    source.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    source.skillId !== MCP_SKILL_ID ||
    source.targetId !== target.id ||
    typeof source.sourceVersion !== "string" ||
    !filesSource ||
    typeof filesSource !== "object" ||
    Array.isArray(filesSource)
  ) {
    throw new Error("The Boatyard ownership manifest does not match this installation.");
  }
  const files: Record<string, string> = {};
  for (const [name, hash] of Object.entries(filesSource as Record<string, unknown>)) {
    if (!isSafeRelativePath(name) || typeof hash !== "string" || !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error("The Boatyard ownership manifest contains an invalid file entry.");
    }
    files[name] = hash;
  }
  return {
    files,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skillId: MCP_SKILL_ID,
    sourceVersion: source.sourceVersion,
    targetId: target.id
  };
}

function listInstalledFilePaths(directory: string, rootDirectory = directory): string[] {
  const paths: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const filePath = join(directory, entry.name);
    const relativePath = normalizeRelativePath(relative(rootDirectory, filePath));
    if (entry.isDirectory()) {
      paths.push(...listInstalledFilePaths(filePath, rootDirectory));
    } else if (relativePath !== MANIFEST_FILE_NAME) {
      paths.push(relativePath);
    }
  }
  return paths.sort();
}

function getModifiedFiles(target: SkillTarget, manifest: ManagedManifest): string[] {
  const modified = new Set<string>();
  for (const [name, expectedHash] of Object.entries(manifest.files)) {
    const filePath = join(target.installPath, ...name.split("/"));
    if (!existsSync(filePath)) {
      modified.add(name);
      continue;
    }
    const stats = lstatSync(filePath);
    if (!stats.isFile() || stats.isSymbolicLink() || hashBuffer(readFileSync(filePath)) !== expectedHash) {
      modified.add(name);
    }
  }
  for (const name of listInstalledFilePaths(target.installPath)) {
    if (!(name in manifest.files)) {
      modified.add(name);
    }
  }
  return [...modified].sort();
}

function writeFileAtomically(filePath: string, contents: Buffer | string, mode: number): void {
  mkdirSync(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.boatyard-${process.pid}-${randomUUID()}.tmp`;
  writeFileSync(temporaryPath, contents, { mode });
  renameSync(temporaryPath, filePath);
  chmodSync(filePath, mode);
}

function createManifest(target: SkillTarget, snapshot: SkillSnapshot): ManagedManifest {
  return {
    files: snapshot.hashes,
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    skillId: MCP_SKILL_ID,
    sourceVersion: snapshot.digest,
    targetId: target.id
  };
}

function writeSnapshot(directory: string, target: SkillTarget, snapshot: SkillSnapshot): void {
  for (const [name, contents] of snapshot.files) {
    writeFileAtomically(join(directory, ...name.split("/")), contents, 0o644);
  }
  writeFileAtomically(
    join(directory, MANIFEST_FILE_NAME),
    `${JSON.stringify(createManifest(target, snapshot), null, 2)}\n`,
    0o600
  );
}

export class McpSkillInstaller {
  private readonly sourceDirectory: string;
  private readonly targets: SkillTarget[];

  constructor({ environment = process.env, homeDirectory, sourceDirectory }: McpSkillInstallerOptions) {
    this.sourceDirectory = sourceDirectory;
    const claudeRoot = resolveConfiguredDirectory(
      environment.CLAUDE_CONFIG_DIR,
      join(homeDirectory, ".claude")
    );
    const hermesRoot = resolveConfiguredDirectory(
      environment.HERMES_HOME,
      join(homeDirectory, ".hermes")
    );
    this.targets = [
      {
        id: "codex",
        installPath: join(homeDirectory, ".agents", "skills", MCP_SKILL_ID),
        label: "Codex"
      },
      {
        id: "claude-code",
        installPath: join(claudeRoot, "skills", MCP_SKILL_ID),
        label: "Claude Code"
      },
      {
        id: "hermes",
        installPath: join(hermesRoot, "skills", MCP_SKILL_ID),
        label: "Hermes"
      }
    ];
  }

  list(): McpSkillTargetStatus[] {
    return this.targets.map((target) => this.inspect(target).status);
  }

  install(targetId: unknown): McpSkillMutationResult {
    const target = this.getTarget(targetId);
    const inspection = this.inspect(target);
    if (!inspection.snapshot) {
      throw new Error(inspection.status.detail);
    }
    if (inspection.status.state === "conflict" || inspection.status.state === "modified") {
      throw new Error(inspection.status.detail);
    }
    if (inspection.status.state === "installed") {
      return { message: `${target.label} already has the current Boatyard MCP skill.`, target: inspection.status };
    }

    if (inspection.status.state === "notInstalled") {
      const parentDirectory = resolve(target.installPath, "..");
      mkdirSync(parentDirectory, { recursive: true, mode: 0o700 });
      mkdirSync(target.installPath, { mode: 0o700 });
      try {
        writeSnapshot(target.installPath, target, inspection.snapshot);
      } catch (error) {
        rmSync(target.installPath, { recursive: true, force: true });
        throw error;
      }
      return {
        message: `Installed the Boatyard MCP skill for ${target.label}. Restart the agent if it does not appear automatically.`,
        target: this.inspect(target).status
      };
    }

    if (!inspection.manifest) {
      throw new Error("The existing skill is not managed by Boatyard.");
    }
    const previousFiles = new Set(Object.keys(inspection.manifest.files));
    for (const [name, contents] of inspection.snapshot.files) {
      const filePath = join(target.installPath, ...name.split("/"));
      if (!previousFiles.has(name) && existsSync(filePath)) {
        throw new Error(`Cannot update ${target.label}: ${name} is not managed by Boatyard.`);
      }
      writeFileAtomically(filePath, contents, 0o644);
      previousFiles.delete(name);
    }
    for (const name of previousFiles) {
      rmSync(join(target.installPath, ...name.split("/")), { force: true });
    }
    writeFileAtomically(
      join(target.installPath, MANIFEST_FILE_NAME),
      `${JSON.stringify(createManifest(target, inspection.snapshot), null, 2)}\n`,
      0o600
    );
    return {
      message: `Updated the Boatyard MCP skill for ${target.label}.`,
      target: this.inspect(target).status
    };
  }

  uninstall(targetId: unknown, options: { force?: boolean } = {}): McpSkillMutationResult {
    const target = this.getTarget(targetId);
    const inspection = this.inspect(target);
    if (inspection.status.state === "notInstalled") {
      return { message: `The Boatyard MCP skill is not installed for ${target.label}.`, target: inspection.status };
    }
    if (!inspection.manifest || inspection.status.state === "conflict") {
      throw new Error("Boatyard will not remove a skill directory it does not own.");
    }
    if (inspection.status.state === "modified" && options.force !== true) {
      throw new Error("This skill contains local changes. Confirm their removal before uninstalling it.");
    }
    rmSync(target.installPath, { recursive: true, force: false });
    return {
      message: `Uninstalled the Boatyard MCP skill for ${target.label}.`,
      target: this.inspect(target).status
    };
  }

  private getTarget(targetId: unknown): SkillTarget {
    const target = this.targets.find((candidate) => candidate.id === targetId);
    if (!target) {
      throw new Error("Unknown MCP skill installation target.");
    }
    return target;
  }

  private inspect(target: SkillTarget): Inspection {
    let snapshot: SkillSnapshot | null = null;
    let sourceError = "";
    try {
      snapshot = createSnapshot(this.sourceDirectory);
    } catch (error) {
      sourceError = error instanceof Error ? error.message : String(error);
    }
    const base = {
      id: target.id,
      installPath: target.installPath,
      label: target.label,
      modifiedFiles: [] as string[],
      sourceVersion: snapshot?.digest.slice(0, 12) || ""
    };
    if (!snapshot) {
      return {
        manifest: null,
        snapshot,
        target,
        status: { ...base, detail: sourceError, state: "unavailable" }
      };
    }
    if (!existsSync(target.installPath)) {
      return {
        manifest: null,
        snapshot,
        target,
        status: { ...base, detail: "The skill is not installed.", state: "notInstalled" }
      };
    }
    const targetStats = lstatSync(target.installPath);
    if (!targetStats.isDirectory() || targetStats.isSymbolicLink()) {
      return {
        manifest: null,
        snapshot,
        target,
        status: {
          ...base,
          detail: "The target path already exists and is not a Boatyard-managed directory.",
          state: "conflict"
        }
      };
    }
    let manifest: ManagedManifest | null = null;
    try {
      manifest = readManifest(target);
    } catch (error) {
      return {
        manifest: null,
        snapshot,
        target,
        status: {
          ...base,
          detail: `Boatyard cannot verify ownership: ${error instanceof Error ? error.message : String(error)}`,
          state: "conflict"
        }
      };
    }
    if (!manifest) {
      return {
        manifest,
        snapshot,
        target,
        status: {
          ...base,
          detail: "A skill already exists here, but it was not installed by Boatyard.",
          state: "conflict"
        }
      };
    }
    const modifiedFiles = getModifiedFiles(target, manifest);
    if (modifiedFiles.length) {
      return {
        manifest,
        snapshot,
        target,
        status: {
          ...base,
          detail: `Local changes detected in ${modifiedFiles.length} file${modifiedFiles.length === 1 ? "" : "s"}.`,
          modifiedFiles,
          state: "modified"
        }
      };
    }
    if (manifest.sourceVersion !== snapshot.digest) {
      return {
        manifest,
        snapshot,
        target,
        status: { ...base, detail: "A newer bundled skill is available.", state: "updateAvailable" }
      };
    }
    return {
      manifest,
      snapshot,
      target,
      status: { ...base, detail: "The current Boatyard MCP skill is installed.", state: "installed" }
    };
  }
}
