const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { app } = require("electron");

type AppChangelogState = {
  dismissedChangelogVersion?: string;
  pendingChangelogFromVersion?: string;
};

type UpdateCandidate = {
  assetName: string;
  canInstall: boolean;
  downloadUrl: string;
  latestVersion: string;
  prepared?: boolean;
  releaseUrl: string;
  source: string;
  tagName: string;
  updateAvailable: boolean;
};

type PreparedUpdate = {
  assetName?: string;
  canInstall?: boolean;
  latestVersion?: string;
  prepared?: boolean;
  updateAvailable?: boolean;
};

type UpdateManagerOptions = {
  getAppState: () => AppChangelogState;
};

type UnknownRecord = Record<string, unknown>;
type ChangelogFeature = {
  body: string;
  category?: string;
  description?: string;
  title: string;
};
type ChangelogRelease = {
  date?: string;
  features?: ChangelogFeature[];
  version?: string;
};
type NormalizedChangelogRelease = {
  date: string;
  features: ChangelogFeature[];
  version: string;
};
type AppImageCandidate = {
  filePath: string;
  name: string;
  version: string;
};

const UPDATE_REPOSITORY = {
  owner: "dguerizec",
  name: "boatyard"
};

const APPIMAGE_NAME_PATTERN = /^Boatyard-(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\.AppImage$/;
const CHANGELOG_JSON_PATH = path.join(__dirname, "..", "shared", "changelog.json");

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function isAppImageCandidate(value: AppImageCandidate | null): value is AppImageCandidate {
  return value !== null;
}

function normalizeVersionTag(version: unknown) {
  return String(version || "").trim().replace(/^v/i, "");
}

function parseVersion(version: unknown) {
  const normalized = normalizeVersionTag(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left: unknown, right: unknown) {
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

function readChangelogEntries(fromVersion: unknown, toVersion: unknown) {
  const from = normalizeVersionTag(fromVersion);
  const to = normalizeVersionTag(toVersion);

  if (!parseVersion(from) || !parseVersion(to) || compareVersions(to, from) <= 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, "utf8"));
    const releases: ChangelogRelease[] = Array.isArray(parsed.releases) ? parsed.releases : [];

    return releases
      .map((release: ChangelogRelease) => ({
        version: normalizeVersionTag(release?.version),
        features: Array.isArray(release?.features) ? release.features : []
      }))
      .filter((release: Pick<NormalizedChangelogRelease, "features" | "version">) => compareVersions(release.version, from) > 0 && compareVersions(release.version, to) <= 0)
      .sort((left: Pick<NormalizedChangelogRelease, "version">, right: Pick<NormalizedChangelogRelease, "version">) => compareVersions(left.version, right.version))
      .flatMap((release: Pick<NormalizedChangelogRelease, "features" | "version">) => release.features
        .map((feature: ChangelogFeature) => ({
          version: release.version,
          title: String(feature?.title || "").trim(),
          body: String(feature?.body || feature?.description || "").trim()
        }))
        .filter((feature: ChangelogFeature & { version: string }) => feature.title && feature.body));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      console.warn(`Could not read changelog data: ${nodeError.message}`);
    }
    return [];
  }
}

function readChangelogReleases() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, "utf8"));
    const releases: ChangelogRelease[] = Array.isArray(parsed.releases) ? parsed.releases : [];

    return releases
      .map((release: ChangelogRelease) => ({
        version: normalizeVersionTag(release?.version),
        date: String(release?.date || "").trim(),
        features: Array.isArray(release?.features)
          ? release.features
            .map((feature: ChangelogFeature) => ({
              category: String(feature?.category || "").trim(),
              title: String(feature?.title || "").trim(),
              body: String(feature?.body || feature?.description || "").trim()
            }))
            .filter((feature: ChangelogFeature) => feature.title && feature.body)
          : []
      }))
      .filter((release: NormalizedChangelogRelease) => parseVersion(release.version) && release.features.length)
      .sort((left: NormalizedChangelogRelease, right: NormalizedChangelogRelease) => compareVersions(right.version, left.version));
  } catch (error) {
    const nodeError = error as NodeJS.ErrnoException;
    if (nodeError.code !== "ENOENT") {
      console.warn(`Could not read changelog data: ${nodeError.message}`);
    }
    return [];
  }
}

async function fetchGitHubJson(pathname: string) {
  const url = `https://api.github.com/repos/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}${pathname}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": `Boatyard/${app.getVersion()}`
    }
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`GitHub returned ${response.status} while checking for updates.`);
  }

  return response.json();
}

function getPreferredReleaseAsset(release: unknown) {
  const releaseRecord = toRecord(release);
  const assets = Array.isArray(releaseRecord.assets) ? releaseRecord.assets : [];
  const platformMatchers = process.platform === "darwin"
    ? [/\.dmg$/i, /mac.*\.zip$/i, /darwin.*\.zip$/i]
    : [/\.AppImage$/i];

  for (const matcher of platformMatchers) {
    const asset = assets.find((candidate) => matcher.test(String(candidate?.name || "")));
    if (asset?.browser_download_url) {
      return asset;
    }
  }

  return assets.find((asset) => asset?.browser_download_url) || null;
}

function normalizeUpdateCandidate(candidate: unknown): UpdateCandidate | null {
  const candidateRecord = toRecord(candidate);
  const tagName = String(candidateRecord.tag_name || candidateRecord.name || "");
  const version = normalizeVersionTag(tagName);

  if (!parseVersion(version)) {
    return null;
  }

  const asset = getPreferredReleaseAsset(candidate);
  const htmlUrl = String(candidateRecord.html_url || `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/tree/${encodeURIComponent(tagName || `v${version}`)}`);

  return {
    latestVersion: version,
    tagName: tagName || `v${version}`,
    releaseUrl: htmlUrl,
    downloadUrl: asset?.browser_download_url || "",
    assetName: asset?.name || "",
    source: candidateRecord.assets ? "release" : "tag",
    updateAvailable: false,
    canInstall: false
  };
}

function getUpdateInstallPaths() {
  const homePath = app.getPath("home");
  const localBinDir = path.join(homePath, ".local", "bin");

  return {
    binDir: path.join(homePath, ".boatyard", "bin"),
    stagingDir: path.join(homePath, ".boatyard", "staging"),
    symlinkDir: localBinDir,
    symlinkPath: path.join(localBinDir, "boatyard")
  };
}

function getCurrentAppImagePath() {
  const appImagePath = process.env.APPIMAGE || "";

  if (appImagePath && path.basename(appImagePath).endsWith(".AppImage")) {
    return appImagePath;
  }

  if (process.execPath && path.basename(process.execPath).endsWith(".AppImage")) {
    return process.execPath;
  }

  return "";
}

function getManagedAppImagePath(version: unknown) {
  const { binDir } = getUpdateInstallPaths();
  return path.join(binDir, `Boatyard-${normalizeVersionTag(version)}.AppImage`);
}

function getStagedAppImagePath(version: unknown) {
  const { stagingDir } = getUpdateInstallPaths();
  return path.join(stagingDir, `Boatyard-${normalizeVersionTag(version)}.AppImage`);
}

function isPathInDirectory(filePath: string, directoryPath: string) {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relativePath === "" || Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function pathExists(filePath: string) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function updateBoatyardSymlink(targetPath: string) {
  const { symlinkDir, symlinkPath } = getUpdateInstallPaths();
  const temporarySymlinkPath = `${symlinkPath}.tmp-${process.pid}`;

  await fs.promises.mkdir(symlinkDir, { recursive: true });

  try {
    await fs.promises.unlink(temporarySymlinkPath);
  } catch {}

  await fs.promises.symlink(targetPath, temporarySymlinkPath);
  await fs.promises.rename(temporarySymlinkPath, symlinkPath);

  return symlinkPath;
}

function isSymlinkDirInPath() {
  const { symlinkDir } = getUpdateInstallPaths();
  const pathEntries = String(process.env.PATH || "")
    .split(path.delimiter)
    .filter(Boolean)
    .map((entry) => path.resolve(entry));

  return pathEntries.includes(path.resolve(symlinkDir));
}

function parseHttpUrl(url: unknown) {
  try {
    const parsed = new URL(String(url || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed : null;
  } catch {
    return null;
  }
}

function createUpdateManager({ getAppState }: UpdateManagerOptions) {
  let updatePreparationPromise: Promise<PreparedUpdate | UpdateCandidate> | null = null;

  function getPendingChangelog() {
    const appState = getAppState();
    const currentVersion = normalizeVersionTag(app.getVersion());
    const fromVersion = normalizeVersionTag(appState.pendingChangelogFromVersion);

    if (!fromVersion || appState.dismissedChangelogVersion === currentVersion) {
      return null;
    }

    const features = readChangelogEntries(fromVersion, currentVersion);

    if (!features.length) {
      return null;
    }

    return {
      fromVersion,
      toVersion: currentVersion,
      features
    };
  }

  async function checkForUpdates() {
    const currentVersion = normalizeVersionTag(app.getVersion());
    const candidates = [];
    const latestRelease = normalizeUpdateCandidate(await fetchGitHubJson("/releases/latest"));

    if (latestRelease) {
      candidates.push(latestRelease);
    }

    const tags = await fetchGitHubJson("/tags?per_page=30");
    candidates.push(
      ...(Array.isArray(tags) ? tags : [])
        .map(normalizeUpdateCandidate)
        .filter(Boolean)
    );

    candidates.sort((left, right) => compareVersions(right!.latestVersion, left!.latestVersion));
    const candidate = candidates[0] || null;

    if (!candidate) {
      throw new Error("No public release information is available.");
    }

    const updateAvailable = compareVersions(candidate.latestVersion, currentVersion) > 0;

    return {
      ...candidate,
      currentVersion,
      latestVersion: candidate?.latestVersion || currentVersion,
      updateAvailable,
      releaseUrl: candidate?.releaseUrl || `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/releases`,
      downloadUrl: updateAvailable ? candidate?.downloadUrl || "" : "",
      assetName: updateAvailable ? candidate?.assetName || "" : "",
      source: candidate?.source || "",
      canInstall: updateAvailable && process.platform === "linux" && Boolean(candidate?.downloadUrl)
    };
  }

  async function ensureCurrentAppImageInstalled() {
    if (process.platform !== "linux") {
      return { supported: false };
    }

    const currentAppImagePath = getCurrentAppImagePath();
    const currentVersion = normalizeVersionTag(app.getVersion());
    const { binDir, symlinkPath } = getUpdateInstallPaths();
    const managedAppImagePath = getManagedAppImagePath(currentVersion);

    if (!currentAppImagePath) {
      return {
        supported: false,
        managed: false,
        binDir,
        symlinkPath,
        pathConfigured: isSymlinkDirInPath()
      };
    }

    await fs.promises.mkdir(binDir, { recursive: true });

    if (
      path.resolve(currentAppImagePath) !== path.resolve(managedAppImagePath) &&
      !(await pathExists(managedAppImagePath))
    ) {
      await fs.promises.copyFile(currentAppImagePath, managedAppImagePath);
      await fs.promises.chmod(managedAppImagePath, 0o755);
    }

    await updateBoatyardSymlink(managedAppImagePath);

    return {
      supported: true,
      managed: isPathInDirectory(currentAppImagePath, binDir),
      installedPath: managedAppImagePath,
      symlinkPath,
      pathConfigured: isSymlinkDirInPath()
    };
  }

  async function cleanupOldAppImages(currentVersion = app.getVersion()) {
    if (process.platform !== "linux") {
      return [];
    }

    const { binDir } = getUpdateInstallPaths();

    if (!(await pathExists(binDir))) {
      return [];
    }

    const entries = await fs.promises.readdir(binDir);
    const appImages = entries
      .map((name: string) => {
        const match = name.match(APPIMAGE_NAME_PATTERN);
        return match ? { name, version: match[1], filePath: path.join(binDir, name) } : null;
      })
      .filter(isAppImageCandidate)
      .sort((left: AppImageCandidate, right: AppImageCandidate) => compareVersions(right.version, left.version));

    const current = normalizeVersionTag(currentVersion);
    const kept = new Set([current]);

    for (const appImage of appImages) {
      if (appImage.version !== current) {
        kept.add(appImage.version);
        break;
      }
    }

    const deleted = [];

    for (const appImage of appImages) {
      if (kept.has(appImage.version)) {
        continue;
      }

      try {
        await fs.promises.unlink(appImage.filePath);
        deleted.push(appImage.filePath);
      } catch (error) {
        console.warn(`Could not delete old AppImage ${appImage.filePath}: ${(error as Error).message}`);
      }
    }

    return deleted;
  }

  async function getPreparedUpdate() {
    if (process.platform !== "linux") {
      return null;
    }

    const { stagingDir } = getUpdateInstallPaths();

    if (!(await pathExists(stagingDir))) {
      return null;
    }

    const currentVersion = normalizeVersionTag(app.getVersion());
    const entries = await fs.promises.readdir(stagingDir);
    const prepared = entries
      .map((name: string) => {
        const match = name.match(APPIMAGE_NAME_PATTERN);
        return match ? { name, version: match[1], filePath: path.join(stagingDir, name) } : null;
      })
      .filter(isAppImageCandidate)
      .filter((candidate: AppImageCandidate) => compareVersions(candidate.version, currentVersion) > 0)
      .sort((left: AppImageCandidate, right: AppImageCandidate) => compareVersions(right.version, left.version))[0];

    if (!prepared) {
      return null;
    }

    return {
      latestVersion: prepared.version,
      assetName: prepared.name,
      updateAvailable: true,
      canInstall: true,
      prepared: true
    };
  }

  async function getUpdateInfo() {
    const install = await ensureCurrentAppImageInstalled();
    const preparedUpdate = await getPreparedUpdate();

    return {
      currentVersion: normalizeVersionTag(app.getVersion()),
      releasesUrl: `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/releases`,
      install,
      preparedUpdate
    };
  }

  async function downloadFile(url: unknown, destinationPath: string) {
    const parsedUrl = parseHttpUrl(url);

    if (!parsedUrl) {
      throw new Error("The update download URL is invalid.");
    }

    const response = await fetch(parsedUrl.toString(), {
      headers: {
        Accept: "application/octet-stream",
        "User-Agent": `Boatyard/${app.getVersion()}`
      }
    });

    if (!response.ok || !response.body) {
      throw new Error(`Download failed with HTTP ${response.status}.`);
    }

    await pipeline(Readable.fromWeb(response.body), fs.createWriteStream(destinationPath, { mode: 0o755 }));
  }

  async function prepareUpdate() {
    if (updatePreparationPromise) {
      return updatePreparationPromise;
    }

    updatePreparationPromise = (async () => {
      const update = await checkForUpdates();

      if (!update.updateAvailable || !update.canInstall) {
        return {
          ...update,
          prepared: false
        };
      }

      const { stagingDir } = getUpdateInstallPaths();
      const stagedPath = getStagedAppImagePath(update.latestVersion);
      const temporaryPath = `${stagedPath}.tmp-${process.pid}`;

      await fs.promises.mkdir(stagingDir, { recursive: true });

      if (!(await pathExists(stagedPath))) {
        try {
          await fs.promises.unlink(temporaryPath);
        } catch {}

        try {
          await downloadFile(update.downloadUrl, temporaryPath);
          await fs.promises.chmod(temporaryPath, 0o755);
          await fs.promises.rename(temporaryPath, stagedPath);
        } catch (error) {
          try {
            await fs.promises.unlink(temporaryPath);
          } catch {}
          throw error;
        }
      }

      return {
        ...update,
        prepared: true
      };
    })();

    try {
      return await updatePreparationPromise;
    } finally {
      updatePreparationPromise = null;
    }
  }

  async function restartToUpdate(update: PreparedUpdate | null) {
    if (process.platform !== "linux") {
      throw new Error("Automatic AppImage updates are only available on Linux.");
    }

    const updateData = update && typeof update === "object"
      ? update
      : await getPreparedUpdate();

    if (!updateData) {
      throw new Error("No prepared update is available.");
    }

    const nextVersion = normalizeVersionTag(updateData.latestVersion);
    const stagedPath = getStagedAppImagePath(nextVersion);

    if (!updateData.updateAvailable || !nextVersion || !(await pathExists(stagedPath))) {
      throw new Error("No prepared update is available.");
    }

    const { binDir, symlinkPath } = getUpdateInstallPaths();
    const destinationPath = getManagedAppImagePath(nextVersion);

    await fs.promises.mkdir(binDir, { recursive: true });
    await fs.promises.rename(stagedPath, destinationPath);
    await fs.promises.chmod(destinationPath, 0o755);
    await updateBoatyardSymlink(destinationPath);

    const child = spawn(destinationPath, [], {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        BOATYARD_UPDATED_FROM: getCurrentAppImagePath()
      }
    });
    child.unref();

    setTimeout(() => app.quit(), 250);

    return {
      installedPath: destinationPath,
      symlinkPath,
      pathConfigured: isSymlinkDirInPath()
    };
  }

  return Object.freeze({
    checkForUpdates,
    cleanupOldAppImages,
    ensureCurrentAppImageInstalled,
    getPendingChangelog,
    getUpdateInfo,
    prepareUpdate,
    readChangelogReleases,
    restartToUpdate
  });
}

export {
  compareVersions,
  createUpdateManager,
  normalizeVersionTag,
  readChangelogReleases
};
