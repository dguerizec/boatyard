const { execFile, spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { promisify } = require("node:util");
const { app, BrowserWindow, WebContentsView, Menu, clipboard, dialog, ipcMain, shell } = require("electron");
const { PasswordManager } = require("./passwordManager");
const { PluginHost } = require("./pluginHost");
const { ProjectStore, deriveRepoUrl } = require("./store");
const { TerminalService } = require("./terminalService");

const execFileAsync = promisify(execFile);
const WEBAPP_SESSION_PARTITION = "persist:boatyard-webapps";
const WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS = 350;
const CAPTURE_REQUEST_ENV = "BOATYARD_CAPTURE_REQUEST";
const UPDATE_REPOSITORY = {
  owner: "dguerizec",
  name: "boatyard"
};
type UnknownRecord = Record<string, any>;

const APPIMAGE_NAME_PATTERN = /^Boatyard-(\d+\.\d+\.\d+(?:[-+][A-Za-z0-9.-]+)?)\.AppImage$/;
const CHANGELOG_JSON_PATH = path.join(__dirname, "..", "shared", "changelog.json");

if (process.env.BOATYARD_USER_DATA_PATH) {
  app.setPath("userData", process.env.BOATYARD_USER_DATA_PATH);
}

let mainWindow = null;
let store = null;
let terminalService = null;
let passwordManager = null;
let pluginHost = null;
let saveWindowStateTimer = null;
let updatePreparationPromise = null;
const webAppViews = new Map();
let activeWebAppKey = null;
let visibleWebAppKeys = new Set();
let allWebAppsFrozen = false;
let frozenWebAppKeys = new Set();

function getStorePath() {
  if (process.env.BOATYARD_STATE_PATH) {
    return process.env.BOATYARD_STATE_PATH;
  }

  return path.join(app.getPath("userData"), "boatyard-state.json");
}

function normalizeVersionTag(version) {
  return String(version || "").trim().replace(/^v/i, "");
}

function parseVersion(version) {
  const normalized = normalizeVersionTag(version);
  const match = normalized.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);

  if (!match) {
    return null;
  }

  return match.slice(1).map((part) => Number.parseInt(part, 10));
}

function compareVersions(left, right) {
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

function readChangelogEntries(fromVersion, toVersion) {
  const from = normalizeVersionTag(fromVersion);
  const to = normalizeVersionTag(toVersion);

  if (!parseVersion(from) || !parseVersion(to) || compareVersions(to, from) <= 0) {
    return [];
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, "utf8"));
    const releases = Array.isArray(parsed.releases) ? parsed.releases : [];

    return releases
      .map((release) => ({
        version: normalizeVersionTag(release?.version),
        features: Array.isArray(release?.features) ? release.features : []
      }))
      .filter((release) => compareVersions(release.version, from) > 0 && compareVersions(release.version, to) <= 0)
      .sort((left, right) => compareVersions(left.version, right.version))
      .flatMap((release) => release.features
        .map((feature) => ({
          version: release.version,
          title: String(feature?.title || "").trim(),
          body: String(feature?.body || feature?.description || "").trim()
        }))
        .filter((feature) => feature.title && feature.body));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read changelog data: ${error.message}`);
    }
    return [];
  }
}

function readChangelogReleases() {
  try {
    const parsed = JSON.parse(fs.readFileSync(CHANGELOG_JSON_PATH, "utf8"));
    const releases = Array.isArray(parsed.releases) ? parsed.releases : [];

    return releases
      .map((release) => ({
        version: normalizeVersionTag(release?.version),
        date: String(release?.date || "").trim(),
        features: Array.isArray(release?.features)
          ? release.features
            .map((feature) => ({
              category: String(feature?.category || "").trim(),
              title: String(feature?.title || "").trim(),
              body: String(feature?.body || feature?.description || "").trim()
            }))
            .filter((feature) => feature.title && feature.body)
          : []
      }))
      .filter((release) => parseVersion(release.version) && release.features.length)
      .sort((left, right) => compareVersions(right.version, left.version));
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.warn(`Could not read changelog data: ${error.message}`);
    }
    return [];
  }
}

function getPendingChangelog() {
  const appState = store.getAppState();
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

async function fetchGitHubJson(pathname) {
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

function getPreferredReleaseAsset(release) {
  const assets = Array.isArray(release?.assets) ? release.assets : [];
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

function normalizeUpdateCandidate(candidate) {
  const tagName = candidate?.tag_name || candidate?.name || "";
  const version = normalizeVersionTag(tagName);

  if (!parseVersion(version)) {
    return null;
  }

  const asset = getPreferredReleaseAsset(candidate);
  const htmlUrl = candidate?.html_url || `https://github.com/${UPDATE_REPOSITORY.owner}/${UPDATE_REPOSITORY.name}/tree/${encodeURIComponent(tagName || `v${version}`)}`;

  return {
    latestVersion: version,
    tagName: tagName || `v${version}`,
    releaseUrl: htmlUrl,
    downloadUrl: asset?.browser_download_url || "",
    assetName: asset?.name || "",
    source: candidate?.assets ? "release" : "tag"
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

  candidates.sort((left, right) => compareVersions(right.latestVersion, left.latestVersion));
  const candidate = candidates[0] || null;

  if (!candidate) {
    throw new Error("No public release information is available.");
  }

  const updateAvailable = compareVersions(candidate.latestVersion, currentVersion) > 0;

  return {
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

function getManagedAppImagePath(version) {
  const { binDir } = getUpdateInstallPaths();
  return path.join(binDir, `Boatyard-${normalizeVersionTag(version)}.AppImage`);
}

function getStagedAppImagePath(version) {
  const { stagingDir } = getUpdateInstallPaths();
  return path.join(stagingDir, `Boatyard-${normalizeVersionTag(version)}.AppImage`);
}

function isPathInDirectory(filePath, directoryPath) {
  const relativePath = path.relative(path.resolve(directoryPath), path.resolve(filePath));
  return relativePath === "" || Boolean(relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

async function pathExists(filePath) {
  try {
    await fs.promises.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function updateBoatyardSymlink(targetPath) {
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
    .map((name) => {
      const match = name.match(APPIMAGE_NAME_PATTERN);
      return match ? { name, version: match[1], filePath: path.join(binDir, name) } : null;
    })
    .filter(Boolean)
    .sort((left, right) => compareVersions(right.version, left.version));

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
      console.warn(`Could not delete old AppImage ${appImage.filePath}: ${error.message}`);
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
    .map((name) => {
      const match = name.match(APPIMAGE_NAME_PATTERN);
      return match ? { name, version: match[1], filePath: path.join(stagingDir, name) } : null;
    })
    .filter(Boolean)
    .filter((candidate) => compareVersions(candidate.version, currentVersion) > 0)
    .sort((left, right) => compareVersions(right.version, left.version))[0];

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

async function downloadFile(url, destinationPath) {
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

async function restartToUpdate(update) {
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

function createMainWindow() {
  const windowState = store.getWindowState();

  mainWindow = new BrowserWindow({
    ...windowState.bounds,
    minWidth: 920,
    minHeight: 620,
    title: "Boatyard",
    icon: path.join(__dirname, "../renderer/assets/boatyard-icon.png"),
    backgroundColor: "#101418",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }

  mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  if (isCaptureMode()) {
    mainWindow.webContents.on("console-message", (event) => {
      const details = event;
      console.log(`[capture renderer:${details.level}] ${details.message} (${details.sourceId}:${details.lineNumber})`);
    });
    mainWindow.webContents.on("render-process-gone", (_event, details) => {
      console.error(`[capture renderer gone] ${details.reason}`);
    });
  }
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();

    if (isCaptureMode()) {
      runCaptureRequest().catch((error) => {
        console.error(`Capture failed: ${error.stack || error.message}`);
        app.exit(1);
      });
      return;
    }

    if (process.argv.includes("--smoke")) {
      setTimeout(() => app.quit(), 500);
    }
  });
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  mainWindow.on("move", scheduleWindowStateSave);
  mainWindow.on("resize", scheduleWindowStateSave);
  mainWindow.on("maximize", saveWindowState);
  mainWindow.on("unmaximize", saveWindowState);
  mainWindow.on("close", () => {
    saveWindowState();
    terminalService?.detachAll();
    destroyWebAppViews();
  });
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isMinimized()) {
    return;
  }

  store.updateWindowState({
    bounds: mainWindow.getNormalBounds(),
    isMaximized: mainWindow.isMaximized()
  });
}

function scheduleWindowStateSave() {
  clearTimeout(saveWindowStateTimer);
  saveWindowStateTimer = setTimeout(saveWindowState, 250);
}

function isCaptureMode() {
  return Boolean(process.env[CAPTURE_REQUEST_ENV]);
}

function readCaptureRequest() {
  const requestPath = process.env[CAPTURE_REQUEST_ENV];
  if (!requestPath) {
    return null;
  }

  return JSON.parse(fs.readFileSync(requestPath, "utf8"));
}

function wait(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitForCapturePredicate(source, timeoutMs = 8000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const matched = await mainWindow.webContents.executeJavaScript(source, true);
    if (matched) {
      return true;
    }
    await wait(100);
  }

  throw new Error(`Timed out waiting for capture predicate: ${source}`);
}

async function waitForOnboardingStep(stepNumber) {
  await waitForCapturePredicate(`(() => {
    const dialog = document.querySelector(".onboarding-dialog");
    const counter = dialog?.querySelector(".onboarding-header span");
    return Boolean(
      dialog &&
      getComputedStyle(dialog).visibility !== "hidden" &&
      counter?.textContent.trim().startsWith("${stepNumber} /")
    );
  })()`, 12000);
}

async function waitForCaptureSelector(selector, timeoutMs = 8000) {
  const quotedSelector = JSON.stringify(String(selector || ""));
  await waitForCapturePredicate(`Boolean(document.querySelector(${quotedSelector}))`, timeoutMs);
}

async function runCaptureAction(action) {
  if (!action || typeof action !== "object") {
    return;
  }

  const type = String(action.type || "").trim();
  const timeoutMs = Number.isFinite(action.timeoutMs) ? action.timeoutMs : 8000;
  if (type === "wait") {
    await wait(Math.max(0, Math.round(Number(action.ms) || 0)));
    return;
  }

  if (type === "waitFor") {
    await waitForCaptureSelector(action.selector, timeoutMs);
    return;
  }

  if (type === "click") {
    await waitForCaptureSelector(action.selector, timeoutMs);
    const quotedSelector = JSON.stringify(String(action.selector || ""));
    await mainWindow.webContents.executeJavaScript(`document.querySelector(${quotedSelector}).click()`, true);
    return;
  }

  if (type === "key") {
    mainWindow.webContents.sendInputEvent({
      type: "keyDown",
      keyCode: String(action.key || "")
    });
    mainWindow.webContents.sendInputEvent({
      type: "keyUp",
      keyCode: String(action.key || "")
    });
    return;
  }

  if (type === "eval") {
    await mainWindow.webContents.executeJavaScript(String(action.source || ""), true);
    return;
  }

  throw new Error(`Unknown capture action type: ${type}`);
}

function getOnboardingStepNumber(scenario) {
  const match = String(scenario || "").match(/^onboarding-step:(\d+)$/);
  return match ? Number.parseInt(match[1], 10) : null;
}

async function applyCaptureScenario(scenario) {
  const onboardingStep = getOnboardingStepNumber(scenario);
  if (onboardingStep) {
    await waitForCapturePredicate("Boolean(document.querySelector('#manual-tour'))");
    await mainWindow.webContents.executeJavaScript("document.querySelector('#manual-tour').click()", true);
    await waitForOnboardingStep(1);

    for (let step = 2; step <= onboardingStep; step += 1) {
      await mainWindow.webContents.executeJavaScript("document.querySelector('.onboarding-dialog .primary-button').click()", true);
      await waitForOnboardingStep(step);
    }
    return;
  }

  if (!scenario || scenario === "global") {
    await waitForCapturePredicate("Boolean(document.querySelector('#dashboard-grid'))");
    return;
  }

  throw new Error(`Unknown capture scenario: ${scenario}`);
}

async function applyCaptureActions(actions = []) {
  for (const action of Array.isArray(actions) ? actions : []) {
    await runCaptureAction(action);
  }
}

async function getCaptureBounds(crop) {
  if (!crop?.selector) {
    return null;
  }

  const quotedSelector = JSON.stringify(String(crop.selector));
  await waitForCaptureSelector(crop.selector, Number.isFinite(crop.timeoutMs) ? crop.timeoutMs : 8000);
  return mainWindow.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${quotedSelector});
    if (!element) {
      return null;
    }

    const rect = element.getBoundingClientRect();
    const padding = Math.max(0, Number(${JSON.stringify(crop.padding || 0)}) || 0);
    return {
      x: Math.max(0, Math.floor(rect.left - padding)),
      y: Math.max(0, Math.floor(rect.top - padding)),
      width: Math.ceil(rect.width + padding * 2),
      height: Math.ceil(rect.height + padding * 2)
    };
  })()`, true);
}

async function runCaptureRequest() {
  const request = readCaptureRequest();
  if (!request?.output) {
    throw new Error("Capture request must include an output path.");
  }

  const scenario = request.scenario || "global";
  await applyCaptureScenario(scenario);
  await applyCaptureActions(request.actions);
  await wait(Number.isFinite(request.settleMs) ? request.settleMs : 250);
  if (request.debug) {
    const state = await mainWindow.webContents.executeJavaScript(`(() => {
      const dialog = document.querySelector(".onboarding-dialog");
      const counter = dialog?.querySelector(".onboarding-header span")?.textContent.trim() || "";
      return {
        dialogOpen: dialog?.open || false,
        dialogVisibility: dialog ? getComputedStyle(dialog).visibility : "",
        counter,
        menuItems: [...document.querySelectorAll(".webapp-tab-menu-item")].map((item) => item.textContent.trim()),
        targetExists: Boolean(document.querySelector(".webapp-tab-menu-item[data-web-app-id='manual']"))
      };
    })()`, true);
    console.log(JSON.stringify(state, null, 2));
  }

  const bounds = await getCaptureBounds(request.crop);
  const image = await mainWindow.capturePage(bounds || undefined);
  fs.mkdirSync(path.dirname(request.output), { recursive: true });
  fs.writeFileSync(request.output, image.toPNG());
  app.quit();
}

function normalizeWebAppBounds(bounds) {
  const source = bounds && typeof bounds === "object" ? bounds : {};
  return {
    x: Math.max(0, Math.round(Number.isFinite(source.x) ? source.x : 0)),
    y: Math.max(0, Math.round(Number.isFinite(source.y) ? source.y : 0)),
    width: Math.max(1, Math.round(Number.isFinite(source.width) ? source.width : 1)),
    height: Math.max(1, Math.round(Number.isFinite(source.height) ? source.height : 1))
  };
}

async function readGitValue(sourcePath, args) {
  const trimmedPath = typeof sourcePath === "string" ? sourcePath.trim() : "";

  if (!trimmedPath) {
    return "";
  }

  try {
    const { stdout } = await execFileAsync("git", ["-C", trimmedPath, ...args], {
      timeout: 3000,
      windowsHide: true
    });
    return stdout.trim();
  } catch {
    return "";
  }
}

async function inspectSourcePath(sourcePath) {
  const gitUrl = await readGitValue(sourcePath, ["config", "--get", "remote.origin.url"]);
  const plugins = await pluginHost.inspectSourcePath({
    sourcePath,
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl)
  });

  return {
    gitUrl,
    repoUrl: deriveRepoUrl(gitUrl),
    plugins
  };
}

function createWebAppContextMenu(webContents, params) {
  const template = [];

  if (params.isEditable) {
    template.push(
      { role: "undo", enabled: params.editFlags?.canUndo },
      { role: "redo", enabled: params.editFlags?.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags?.canCut },
      { role: "copy", enabled: params.editFlags?.canCopy },
      { role: "paste", enabled: params.editFlags?.canPaste },
      { role: "delete", enabled: params.editFlags?.canDelete },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags?.canSelectAll }
    );
  } else if (params.selectionText) {
    template.push({ role: "copy" });
  }

  if (params.linkURL) {
    if (template.length) {
      template.push({ type: "separator" });
    }
    template.push(
      {
        label: "Open with...",
        click: () => {
          const webApp = getWebAppForWebContents(webContents);
          if (!sendWebAppOpenUrlRequest(webApp?.key || "", params.linkURL, "context-menu")) {
            openExternalUrl(params.linkURL);
          }
        }
      },
      {
        label: "Open link in browser",
        click: () => openExternalUrl(params.linkURL)
      },
      {
        label: "Copy link address",
        click: () => clipboard.writeText(params.linkURL)
      }
    );
  }

  if (template.length) {
    template.push({ type: "separator" });
  }

  template.push(
    {
      label: "Back",
      enabled: webContents.canGoBack(),
      click: () => webContents.goBack()
    },
    {
      label: "Forward",
      enabled: webContents.canGoForward(),
      click: () => webContents.goForward()
    },
    {
      label: "Reload",
      click: () => webContents.reload()
    }
  );

  if (!app.isPackaged) {
    template.push(
      { type: "separator" },
      {
        label: "Inspect element",
        click: () => webContents.inspectElement(params.x, params.y)
      }
    );
  }

  return Menu.buildFromTemplate(template);
}

function parseHttpUrl(url) {
  try {
    const parsedUrl = new URL(url);
    return ["http:", "https:"].includes(parsedUrl.protocol) ? parsedUrl : null;
  } catch {
    return null;
  }
}

function openExternalUrl(url) {
  return shell.openExternal(String(url || ""));
}

function sendWebAppOpenUrlRequest(sourceWebAppKey, url, source = "window-open", options: UnknownRecord = {}) {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return false;
  }

  mainWindow.webContents.send("webapp:open-url-requested", {
    sourceWebAppKey: String(sourceWebAppKey || ""),
    url: String(url || ""),
    source,
    target: String(options.target || ""),
    sourceUrl: String(options.sourceUrl || ""),
    sourceBounds: options.sourceBounds || null
  });
  return true;
}

function getWebAppOpenRule(url) {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl) {
    return null;
  }

  const rules = store?.getState()?.settings?.webAppOpenRules || [];
  return rules.find((rule) => {
    if (rule.scope === "host") {
      return parsedUrl.host === rule.pattern || parsedUrl.hostname === rule.pattern;
    }

    if (rule.scope === "path-prefix") {
      return parsedUrl.toString().startsWith(rule.pattern);
    }

    return parsedUrl.toString() === rule.pattern;
  }) || null;
}

function applyWebAppOpenRule(webApp, rule, url, sourceWebAppKey = "") {
  if (!rule) {
    return false;
  }

  if (rule.target === "external") {
    openExternalUrl(url);
    return true;
  }

  if (rule.target === "same-pane") {
    return loadWebAppUrl(webApp, url);
  }

  if (rule.target === "split-pane") {
    return sendWebAppOpenUrlRequest(sourceWebAppKey, url, "saved-rule", {
      target: "split-pane",
      sourceUrl: webApp?.url || "",
      sourceBounds: webApp?.bounds || null
    });
  }

  return false;
}

function loadWebAppUrl(webApp, url) {
  const parsedUrl = parseHttpUrl(url);
  if (!parsedUrl || !webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  webApp.url = parsedUrl.toString();
  webApp.view.webContents.loadURL(webApp.url).catch((error) => {
    console.warn(`Could not load webapp ${webApp.url}: ${error.message}`);
  });
  return true;
}

function sendWebAppLoaded(key, url, status = "loaded") {
  if (!mainWindow || mainWindow.webContents.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("webapp:loaded", {
    key: String(key),
    url,
    status
  });
}

function handleWebAppWindowOpen(key, details) {
  const url = details?.url || "";
  const webApp = webAppViews.get(key);

  if (details?.disposition === "background-tab") {
    openExternalUrl(url);
    return { action: "deny" };
  }

  const rule = getWebAppOpenRule(url);
  if (rule) {
    applyWebAppOpenRule(webApp, rule, url, key);
  } else if (!sendWebAppOpenUrlRequest(key, url, "window-open", {
    sourceBounds: webApp?.bounds || null
  })) {
    openExternalUrl(url);
  }
  return { action: "deny" };
}

function ensureWebAppView(key) {
  const existing = webAppViews.get(key);
  if (existing) {
    return existing;
  }

  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      partition: WEBAPP_SESSION_PARTITION,
      preload: path.join(__dirname, "webappPreload.js"),
      sandbox: true
    }
  });
  view.setBackgroundColor("#0b0f14");
  view.webContents.setWindowOpenHandler((details) => handleWebAppWindowOpen(key, details));
  view.webContents.on("context-menu", (_event, params) => {
    createWebAppContextMenu(view.webContents, params).popup({
      window: mainWindow || undefined
    });
  });
  view.webContents.on("did-navigate", (_event, url) => {
    persistWebAppUrl(key, url);
  });
  view.webContents.on("did-navigate-in-page", (_event, url, isMainFrame) => {
    if (isMainFrame) {
      persistWebAppUrl(key, url);
    }
  });
  view.webContents.on("did-finish-load", () => {
    sendWebAppLoaded(key, view.webContents.getURL());
  });
  view.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedUrl, isMainFrame) => {
    if (isMainFrame) {
      sendWebAppLoaded(key, validatedUrl || view.webContents.getURL(), `failed:${errorCode}:${errorDescription}`);
    }
  });
  view.webContents.on("dom-ready", () => {
    const item = webAppViews.get(key);
    view.webContents.send("webapp:autofill-enabled", item?.autofillEnabled === true);
  });

  mainWindow.contentView.addChildView(view);
  webAppViews.set(key, {
    view,
    url: null,
    bounds: null,
    autofillEnabled: false
  });
  return webAppViews.get(key);
}

function getWebAppForWebContents(webContents) {
  for (const [key, item] of webAppViews) {
    if (item.view.webContents.id === webContents.id) {
      return { key, item };
    }
  }

  return null;
}

function persistWebAppUrl(key, url) {
  try {
    store.updateWebAppState(key, { url });
    if (mainWindow && !mainWindow.webContents.isDestroyed()) {
      mainWindow.webContents.send("webapp:url-changed", {
        key: String(key),
        url
      });
    }
  } catch (error) {
    console.warn(`Could not persist webapp ${key}: ${error.message}`);
  }
}

function showWebApp({ key, url, bounds, autofillEnabled, restoreUrl = true }) {
  if (!key) {
    throw new Error("Webapp key is required.");
  }

  const restoredUrl = store.getWebAppUrl(String(key));
  const parsedUrl = new URL(restoreUrl === false ? url : (restoredUrl || url));

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new Error("Only http and https webapps are supported.");
  }

  const webApp = ensureWebAppView(String(key));
  if (typeof autofillEnabled === "boolean") {
    webApp.autofillEnabled = autofillEnabled;
  }
  webApp.bounds = normalizeWebAppBounds(bounds);
  webApp.view.setBounds(webApp.bounds);
  webApp.view.setVisible(
    visibleWebAppKeys.has(String(key)) &&
    !allWebAppsFrozen &&
    !frozenWebAppKeys.has(String(key))
  );
  activeWebAppKey = String(key);

  if (webApp.url !== parsedUrl.toString()) {
    loadWebAppUrl(webApp, parsedUrl.toString());
  } else if (!webApp.view.webContents.isLoadingMainFrame()) {
    sendWebAppLoaded(key, webApp.view.webContents.getURL());
  }
}

function setWebAppBounds(bounds) {
  if (!activeWebAppKey) {
    return;
  }

  const webApp = webAppViews.get(activeWebAppKey);
  webApp?.view.setBounds(normalizeWebAppBounds(bounds));
}

async function navigateWebApp(key, action, url) {
  const webApp = webAppViews.get(String(key || ""));

  if (!webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  if (action === "open" || action === "home") {
    let parsedUrl;

    try {
      parsedUrl = new URL(url);
    } catch {
      return false;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      return false;
    }

    return loadWebAppUrl(webApp, parsedUrl.toString());
  }

  if (action === "back") {
    if (webApp.view.webContents.canGoBack()) {
      webApp.view.webContents.goBack();
      return true;
    }
    return false;
  }

  if (action === "forward") {
    if (webApp.view.webContents.canGoForward()) {
      webApp.view.webContents.goForward();
      return true;
    }
    return false;
  }

  if (action === "refresh") {
    webApp.view.webContents.reload();
    return true;
  }

  if (action === "hard-refresh") {
    await webApp.view.webContents.session.clearCache();
    webApp.view.webContents.reloadIgnoringCache();
    return true;
  }

  return false;
}

function updateWebAppAutofill(key, enabled) {
  const webApp = webAppViews.get(String(key || ""));
  if (!webApp || webApp.view.webContents.isDestroyed()) {
    return false;
  }

  webApp.autofillEnabled = enabled === true;
  webApp.view.webContents.send("webapp:autofill-enabled", webApp.autofillEnabled);
  if (mainWindow && !mainWindow.webContents.isDestroyed()) {
    mainWindow.webContents.send("webapp:autofill-changed", {
      key: String(key),
      enabled: webApp.autofillEnabled
    });
  }
  return webApp.autofillEnabled;
}

function setVisibleWebApps(keys) {
  visibleWebAppKeys = new Set(Array.isArray(keys) ? keys.map(String) : []);

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key) && !allWebAppsFrozen && !frozenWebAppKeys.has(key));
  }

  activeWebAppKey = visibleWebAppKeys.size > 0 ? [...visibleWebAppKeys].at(-1) : null;
}

function hideWebApp() {
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();

  for (const item of webAppViews.values()) {
    item.view.setVisible(false);
  }
}

function withTimeout(promise, timeoutMs, errorMessage) {
  let timeout = null;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error(errorMessage)), timeoutMs);
    })
  ]).finally(() => {
    clearTimeout(timeout);
  });
}

async function captureWebAppForFreeze(key) {
  const item = webAppViews.get(key);
  if (!item || item.view.webContents.isDestroyed()) {
    return null;
  }

  try {
    const image = await withTimeout(
      item.view.webContents.capturePage(),
      WEBAPP_FREEZE_CAPTURE_TIMEOUT_MS,
      "capture timed out"
    );

    if (image.isEmpty()) {
      return null;
    }

    return {
      key,
      bounds: item.view.getBounds(),
      dataUrl: image.toDataURL()
    };
  } catch (error) {
    console.warn(`Could not capture webapp ${key}: ${error.message}`);
    return null;
  }
}

function getWebAppFreezeKeys(options: UnknownRecord = {}) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const requestedKeys = Array.isArray(options?.keys)
    ? options.keys.map(String).filter(Boolean)
    : [];

  if (!hasKeyFilter) {
    return [...visibleWebAppKeys];
  }

  return requestedKeys.filter((key) => visibleWebAppKeys.has(key));
}

async function freezeWebApps(options = {}) {
  const hasKeyFilter = Object.prototype.hasOwnProperty.call(options || {}, "keys");
  const freezeKeys = getWebAppFreezeKeys(options);
  allWebAppsFrozen = !hasKeyFilter;
  frozenWebAppKeys = new Set([...frozenWebAppKeys, ...freezeKeys]);
  const captures = (await Promise.all(freezeKeys.map(captureWebAppForFreeze))).filter(Boolean);

  for (const key of freezeKeys) {
    webAppViews.get(key)?.view.setVisible(false);
  }

  return captures;
}

function restoreWebApps() {
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();

  for (const [key, item] of webAppViews) {
    item.view.setVisible(visibleWebAppKeys.has(key));
  }
}

function destroyWebAppViews() {
  for (const item of webAppViews.values()) {
    try {
      mainWindow?.contentView.removeChildView(item.view);
    } catch (error) {
      console.warn(`Could not detach webapp view: ${error.message}`);
    }

    if (!item.view.webContents.isDestroyed()) {
      item.view.webContents.close();
    }
  }
  webAppViews.clear();
  activeWebAppKey = null;
  visibleWebAppKeys = new Set();
  allWebAppsFrozen = false;
  frozenWebAppKeys = new Set();
}

function registerIpcHandlers() {
  ipcMain.handle("state:get", () => store.getState());

  ipcMain.handle("settings:update", (_event, patch) => {
    if (
      patch?.passwordManagerEnabled === true &&
      patch?.passwordManagerDisclaimerAccepted === true &&
      !passwordManager.getStatus().encryptionAvailable
    ) {
      throw new Error(
        "Electron safeStorage is unavailable. On Linux, safeStorage depends on a secret storage backend available in the desktop session, typically gnome-libsecret or kwallet/kwallet5/kwallet6. Try launching Boatyard from your desktop session instead of a detached terminal, tmux, or headless environment."
      );
    }

    return store.updateSettings(patch);
  });

  ipcMain.handle("navigation:update", (_event, navigation) => {
    return store.updateNavigation(navigation);
  });

  ipcMain.handle("onboarding:update", (_event, onboarding) => {
    return store.updateOnboarding(onboarding);
  });

  ipcMain.handle("settings:select-projects-base-path", async (_event, currentPath) => {
    const dialogOptions: UnknownRecord = {
      title: "Select projects base path",
      properties: ["openDirectory", "createDirectory"]
    };

    if (typeof currentPath === "string" && currentPath.trim()) {
      dialogOptions.defaultPath = currentPath.trim();
    }

    const result = await dialog.showOpenDialog(mainWindow, dialogOptions);
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle("updates:info", () => {
    return getUpdateInfo();
  });

  ipcMain.handle("updates:check", () => {
    return checkForUpdates();
  });

  ipcMain.handle("updates:prepare", () => {
    return prepareUpdate();
  });

  ipcMain.handle("updates:restart", (_event, update) => {
    return restartToUpdate(update);
  });

  ipcMain.handle("changelog:pending", () => {
    return getPendingChangelog();
  });

  ipcMain.handle("changelog:history", () => {
    return {
      currentVersion: normalizeVersionTag(app.getVersion()),
      releases: readChangelogReleases()
    };
  });

  ipcMain.handle("changelog:dismiss", () => {
    return store.dismissChangelog(app.getVersion());
  });

  ipcMain.handle("projects:inspect-source-path", (_event, sourcePath) => {
    return inspectSourcePath(sourcePath);
  });

  ipcMain.handle("plugins:list", () => {
    return pluginHost.listRendererPlugins();
  });

  ipcMain.handle("plugins:invoke", (_event, pluginId, actionName, payload) => {
    return pluginHost.invoke(pluginId, actionName, payload);
  });

  ipcMain.handle("projects:add", (_event, projectConfig) => {
    return store.addProject(projectConfig);
  });

  ipcMain.handle("projects:update", (_event, id, patch) => {
    return store.updateProject(id, patch);
  });

  ipcMain.handle("global-urls:update", (_event, urls) => {
    return store.updateGlobalUrls(urls);
  });

  ipcMain.handle("webapp-home-tab:update", (_event, projectId, tab) => {
    return store.updateWebAppHomeTab(projectId, tab);
  });

  ipcMain.handle("webapp-home-tabs:update", (_event, projectId, tabs) => {
    return store.updateWebAppHomeTabs(projectId, tabs);
  });

  ipcMain.handle("projects:reorder", (_event, projectIds) => {
    return store.reorderProjects(projectIds);
  });

  ipcMain.handle("projects:remove", (_event, id) => {
    return store.removeProject(id);
  });

  ipcMain.handle("plugins:enabled:update", (_event, pluginId, enabled) => {
    return store.updatePluginEnabled(pluginId, enabled);
  });

  ipcMain.handle("global-plugin-config:update", (_event, pluginId, patch) => {
    return store.updateGlobalPluginConfig(pluginId, patch);
  });

  ipcMain.handle("project-plugin-config:update", (_event, projectId, pluginId, patch) => {
    return store.updateProjectPluginConfig(projectId, pluginId, patch);
  });

  ipcMain.handle("pane-layout:update", (_event, projectId, layout) => {
    return store.updatePaneLayout(projectId, layout);
  });

  ipcMain.handle("widget-layout:update", (_event, projectId, layout) => {
    return store.updateWidgetLayout(projectId, layout);
  });

  ipcMain.handle("terminal:tabs", (_event, projectId) => {
    return terminalService.listTabs(projectId);
  });

  ipcMain.handle("terminal:create-tab", (_event, projectId, name) => {
    return terminalService.createTab(projectId, name);
  });

  ipcMain.handle("terminal:rename-tab", (_event, projectId, windowId, name) => {
    return terminalService.renameTab(projectId, windowId, name);
  });

  ipcMain.handle("terminal:close-tab", (_event, projectId, windowId) => {
    return terminalService.closeTab(projectId, windowId);
  });

  ipcMain.handle("terminal:attach", (_event, projectId, windowId, size) => {
    return terminalService.attach(projectId, windowId, size);
  });

  ipcMain.handle("terminal:selection:update", (_event, projectId, surfaceKey, windowId) => {
    return store.updateTerminalSelection(projectId, surfaceKey, windowId);
  });

  ipcMain.handle("terminal:tab-order:update", (_event, projectId, windowIds) => {
    return store.updateTerminalTabOrder(projectId, windowIds);
  });

  ipcMain.handle("terminal:write", (_event, terminalId, data) => {
    terminalService.write(terminalId, data);
  });

  ipcMain.handle("terminal:resize", (_event, terminalId, size) => {
    terminalService.resize(terminalId, size);
  });

  ipcMain.handle("terminal:detach", (_event, terminalId) => {
    terminalService.detach(terminalId);
  });

  ipcMain.handle("terminal:write-selection", (_event, text) => {
    clipboard.writeText(String(text || ""), "selection");
  });

  ipcMain.handle("terminal:read-selection", () => {
    return clipboard.readText("selection");
  });

  ipcMain.handle("password-manager:status", () => {
    return passwordManager.getStatus();
  });

  ipcMain.handle("password-manager:get-credential", (event, url) => {
    const webApp = getWebAppForWebContents(event.sender);
    if (webApp?.item.autofillEnabled === false) {
      return null;
    }

    return passwordManager.getCredential(url);
  });

  ipcMain.handle("password-manager:save-credential", (_event, credential) => {
    return passwordManager.saveCredential(credential);
  });

  ipcMain.handle("webapp:show", (_event, webApp) => {
    showWebApp(webApp);
  });

  ipcMain.handle("webapp:set-bounds", (_event, bounds) => {
    setWebAppBounds(bounds);
  });

  ipcMain.handle("webapp:navigate", (_event, key, action, url) => {
    return navigateWebApp(key, action, url);
  });

  ipcMain.handle("webapp:autofill:update", (_event, key, enabled) => {
    return updateWebAppAutofill(key, enabled);
  });

  ipcMain.handle("webapp:autofill-consumed", (event) => {
    const webApp = getWebAppForWebContents(event.sender);
    return webApp ? updateWebAppAutofill(webApp.key, false) : false;
  });

  ipcMain.handle("webapp:set-visible", (_event, keys) => {
    setVisibleWebApps(keys);
  });

  ipcMain.handle("webapp:hide", () => {
    hideWebApp();
  });

  ipcMain.handle("webapp:freeze", (_event, options) => {
    return freezeWebApps(options);
  });

  ipcMain.handle("webapp:restore", () => {
    restoreWebApps();
  });

  ipcMain.handle("clipboard:write-text", (_event, text) => {
    clipboard.writeText(String(text || ""));
  });

  ipcMain.handle("shell:open-external", (_event, url) => {
    return openExternalUrl(url);
  });
}

app.whenReady().then(async () => {
  store = new ProjectStore(getStorePath());
  store.load();
  store.reconcileAppVersion(app.getVersion());
  try {
    await ensureCurrentAppImageInstalled();
    await cleanupOldAppImages();
  } catch (error) {
    console.warn(`Could not prepare AppImage updates: ${error.message}`);
  }

  pluginHost = new PluginHost({
    store,
    execFileAsync,
    userDataPath: app.getPath("userData"),
    sendToRenderer: (channel, payload) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    }
  });
  pluginHost.discover();
  await pluginHost.applyStateMigrations();
  passwordManager = new PasswordManager({
    store,
    confirmSave: async ({ origin, username, isUpdate }) => {
      const result = await dialog.showMessageBox(mainWindow, {
        type: "question",
        buttons: [isUpdate ? "Update password" : "Save password", "Cancel"],
        defaultId: 0,
        cancelId: 1,
        title: "Boatyard password manager",
        message: `${isUpdate ? "Update" : "Save"} password for ${origin}?`,
        detail: `Username: ${username}\n\nBoatyard stores this password encrypted for the current OS user. This is a minimal local password manager, not a hardened replacement for a dedicated password manager.`
      });
      return result.response === 0;
    }
  });
  terminalService = new TerminalService({
    getProject: (projectId) => {
      if (projectId === "__global__") {
        const settings = store.getState().settings || {};
        return {
          id: "__global__",
          name: "Global",
          slug: "global",
          sourcePath: settings.projectsBasePath || process.cwd(),
          terminalEnv: ""
        };
      }

      return store.getState().projects.find((project) => project.id === projectId);
    },
    getSettings: () => store.getState().settings,
    sendToRenderer: (channel, payload) => {
      if (mainWindow && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send(channel, payload);
      }
    },
    suppressResizeWarnings: isCaptureMode()
  });
  registerIpcHandlers();
  createMainWindow();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createMainWindow();
  }
});

export {};
