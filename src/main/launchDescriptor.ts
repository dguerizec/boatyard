import type { UnknownRecord } from "./mainTypes.js";

const fs = require("node:fs");
const path = require("node:path");

export const LAUNCH_DESCRIPTOR_VERSION = 1;
export const DEFAULT_PROFILE_NAME = "default";
export const PROFILES_DIRECTORY_NAME = "profiles";

export type LaunchDescriptor = {
  configDirectory: string;
  configurationRoot: string;
  openingTarget: null;
  profile: string;
  version: typeof LAUNCH_DESCRIPTOR_VERSION;
};

type ResolveProfileOptions = {
  argv: string[];
  configurationRoot: string;
};

type ResolveDefaultConfigurationRootOptions = {
  cwd: string;
  home: string;
  isPackaged: boolean;
};

export function resolveDefaultConfigurationRoot({
  cwd,
  home,
  isPackaged
}: ResolveDefaultConfigurationRootOptions): string {
  return isPackaged
    ? path.join(home, ".boatyard")
    : path.resolve(cwd, ".boatyard");
}

export function canonicalizeDirectory(value: string): string {
  const resolvedDirectory = path.resolve(value);
  try {
    if (!fs.statSync(resolvedDirectory).isDirectory()) {
      throw new Error(`Boatyard configuration path is not a directory: ${resolvedDirectory}`);
    }
    return fs.realpathSync.native(resolvedDirectory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const missingSegments: string[] = [];
  let existingDirectory = resolvedDirectory;
  while (!fs.existsSync(existingDirectory)) {
    const parentDirectory = path.dirname(existingDirectory);
    if (parentDirectory === existingDirectory) {
      throw new Error(`Could not resolve Boatyard configuration directory: ${resolvedDirectory}`);
    }
    missingSegments.unshift(path.basename(existingDirectory));
    existingDirectory = parentDirectory;
  }
  if (!fs.statSync(existingDirectory).isDirectory()) {
    throw new Error(`Boatyard configuration path is not a directory: ${existingDirectory}`);
  }
  return path.join(fs.realpathSync.native(existingDirectory), ...missingSegments);
}

export function normalizeProfileName(value: unknown): string {
  const profile = String(value || "").trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(profile)) {
    throw new Error("Boatyard profile names may contain only letters, numbers, underscores, and hyphens.");
  }
  return profile;
}

function getProfileArgument(argv: string[]): string {
  for (let index = argv.length - 1; index >= 0; index -= 1) {
    const argument = argv[index];
    if (argument === "--profile") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new Error("--profile requires a profile name.");
      }
      return normalizeProfileName(value);
    }
    if (argument.startsWith("--profile=")) {
      return normalizeProfileName(argument.slice("--profile=".length));
    }
  }
  return DEFAULT_PROFILE_NAME;
}

export function resolveProfileLaunch({ argv, configurationRoot }: ResolveProfileOptions): LaunchDescriptor {
  const profile = getProfileArgument(argv);
  const root = canonicalizeDirectory(configurationRoot);
  return {
    version: LAUNCH_DESCRIPTOR_VERSION,
    profile,
    configurationRoot: root,
    configDirectory: path.join(root, PROFILES_DIRECTORY_NAME, profile),
    openingTarget: null
  };
}

export function parseLaunchDescriptor(value: unknown): LaunchDescriptor | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const source = value as UnknownRecord;
  if (source.version !== LAUNCH_DESCRIPTOR_VERSION || source.openingTarget !== null) {
    return null;
  }
  try {
    const profile = normalizeProfileName(source.profile);
    const configurationRoot = canonicalizeDirectory(String(source.configurationRoot || ""));
    const configDirectory = canonicalizeDirectory(String(source.configDirectory || ""));
    if (configDirectory !== path.join(configurationRoot, PROFILES_DIRECTORY_NAME, profile)) {
      return null;
    }
    return { version: LAUNCH_DESCRIPTOR_VERSION, profile, configurationRoot, configDirectory, openingTarget: null };
  } catch {
    return null;
  }
}

function isProfileStateDirectory(directory: string): boolean {
  return ["settings.json", "projects.json", "workspace-session.json"].some((fileName) => (
    fs.existsSync(path.join(directory, fileName))
  ));
}

export function migrateConfigurationRootToProfiles(configurationRoot: string): void {
  const root = canonicalizeDirectory(configurationRoot);
  const profilesDirectory = path.join(root, PROFILES_DIRECTORY_NAME);
  fs.mkdirSync(profilesDirectory, { recursive: true, mode: 0o700 });

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name === PROFILES_DIRECTORY_NAME) {
      continue;
    }

    try {
      normalizeProfileName(entry.name);
    } catch {
      continue;
    }

    const sourceDirectory = path.join(root, entry.name);
    const targetDirectory = path.join(profilesDirectory, entry.name);
    if (!isProfileStateDirectory(sourceDirectory) || fs.existsSync(targetDirectory)) {
      continue;
    }
    fs.renameSync(sourceDirectory, targetDirectory);
  }

  const legacyFiles = ["settings.json", "projects.json", "workspace-session.json"];
  const existingLegacyFiles = legacyFiles.filter((fileName) => fs.existsSync(path.join(root, fileName)));
  const defaultDirectory = path.join(profilesDirectory, DEFAULT_PROFILE_NAME);
  if (!existingLegacyFiles.length || fs.existsSync(defaultDirectory)) {
    return;
  }

  fs.mkdirSync(defaultDirectory, { recursive: true, mode: 0o700 });
  for (const fileName of existingLegacyFiles) {
    fs.renameSync(path.join(root, fileName), path.join(defaultDirectory, fileName));
  }
}

export function routeLaunchDescriptor(descriptor: LaunchDescriptor, hostedConfigDirectories: Iterable<string>): "create" | "focus" {
  for (const configDirectory of hostedConfigDirectories) {
    if (configDirectory === descriptor.configDirectory) {
      return "focus";
    }
  }
  return "create";
}
