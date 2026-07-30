import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

const DEFAULT_OUTPUT = "docs/screenshots/boatyard-global.png";
const DEFAULT_SCENARIO = "global";
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 820;

type JsonRecord = Record<string, unknown>;
type CaptureConfig = JsonRecord & {
  actions?: unknown[];
  crop?: JsonRecord & {
    padding?: unknown;
    selector?: unknown;
  };
  debug?: boolean;
  height?: unknown;
  output?: unknown;
  scenario?: unknown;
  settleMs?: unknown;
  state?: unknown;
  statePath?: unknown;
  width?: unknown;
};

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readOption(name: string, fallback = "") {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) {
    return String(fallback);
  }

  return process.argv[index + 1] || String(fallback);
}

function hasFlag(name: string) {
  return process.argv.includes(`--${name}`);
}

function printHelp() {
  console.log(`Usage: npm run capture:doc -- [options]

Options:
  --config <path>     JSON capture config with state, actions, crop, and output
  --state <path>      State JSON to load instead of the generated fixture
  --scenario <name>   Scenario to capture: global, onboarding-step:N
  --output <path>     PNG output path
  --crop <selector>   Capture only the matching element
  --padding <px>      Padding around the cropped selector
  --width <px>        Window width
  --height <px>       Window height
  --user-data-path <path>
                      Reuse a dedicated Chromium profile across launches
  --terminal-session-prefix <prefix>
                      Isolate tmux sessions from another Boatyard instance
  --interactive       Open the fixture without capturing so external webapps
                      can be authenticated in the dedicated Chromium profile
  --debug             Print renderer state before capture
  --keep-temp         Keep the generated temporary state directory

Examples:
  npm run capture:doc -- --scenario global --output docs/screenshots/global.png
  npm run capture:doc -- --scenario onboarding-step:5 --output docs/screenshots/manual-dropdown.png
  npm run capture:doc -- --config docs/captures/sidebar.json
  npm run capture:doc -- --config docs/captures/workbench.json --user-data-path /tmp/boatyard-doc-profile --terminal-session-prefix boatyard-doc-capture --interactive
  npm run capture:doc -- --config docs/captures/workbench.json --user-data-path /tmp/boatyard-doc-profile --terminal-session-prefix boatyard-doc-capture
`);
}

function parsePositiveInteger(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createCaptureState({ width, height }: { height: number; width: number }): JsonRecord {
  return {
    settings: {
      projectsBasePath: "/workspace/example",
      blurWebAppOverlays: true,
      passwordManagerEnabled: false,
      passwordManagerDisclaimerAccepted: false,
      widgetRailWidth: 340,
      terminalEnv: "",
      webAppOpenRules: [] as unknown[]
    },
    projects: [] as unknown[],
    window: {
      bounds: {
        x: 80,
        y: 60,
        width,
        height
      },
      isMaximized: false
    },
    navigation: {
      view: "global",
      projectId: null as string | null
    },
    webApps: {},
    passwordVault: {},
    plugins: {
      enabled: {}
    },
    pluginConfig: {
      global: {},
      projects: {}
    },
    globalUrls: [] as unknown[],
    paneLayouts: {},
    widgetLayouts: {},
    terminalSelections: {},
    terminalTabOrders: {},
    onboarding: {
      completedVersion: 999,
      completedAt: "2026-01-01T00:00:00.000Z"
    }
  };
}

function readJsonFile(filePath: string): CaptureConfig {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function resolveFrom(baseDir: string, value: unknown) {
  if (!value) {
    return "";
  }

  const pathValue = String(value);
  return isAbsolute(pathValue) ? pathValue : resolve(baseDir, pathValue);
}

if (hasFlag("help") || hasFlag("h")) {
  printHelp();
  process.exit(0);
}

const configPath = readOption("config");
const config: CaptureConfig = configPath ? readJsonFile(resolve(configPath)) : {};
const configDir = configPath ? dirname(resolve(configPath)) : process.cwd();
const scenario = readOption("scenario", asString(config.scenario, DEFAULT_SCENARIO));
const output = resolveFrom(configDir, readOption("output", asString(config.output, DEFAULT_OUTPUT)));
const width = parsePositiveInteger(readOption("width", asString(config.width)), asNumber(config.width, DEFAULT_WIDTH));
const height = parsePositiveInteger(readOption("height", asString(config.height)), asNumber(config.height, DEFAULT_HEIGHT));
const repoRoot = process.cwd();
const configuredUserDataPath = readOption("user-data-path");
const terminalSessionPrefix = readOption("terminal-session-prefix");
const interactive = hasFlag("interactive");
if (interactive && (!configuredUserDataPath || !terminalSessionPrefix)) {
  throw new Error("--interactive requires --user-data-path and --terminal-session-prefix to isolate authenticated webapp and terminal state.");
}
const tempDir = mkdtempSync(join(tmpdir(), "boatyard-capture-"));
const userDataPath = configuredUserDataPath ? resolve(configuredUserDataPath) : join(tempDir, "user-data");
const statePath = join(tempDir, "state.json");
const configurationPath = join(tempDir, ".boatyard");
const requestPath = join(tempDir, "capture.json");
const configuredStatePath = readOption("state", asString(config.statePath));
const state = config.state ||
  (configuredStatePath ? readJsonFile(resolveFrom(configDir, configuredStatePath)) : createCaptureState({ width, height }));
const cropSelector = readOption("crop", asString(config.crop?.selector));
const crop = cropSelector
  ? {
      ...(config.crop || {}),
      selector: cropSelector,
      padding: parsePositiveInteger(readOption("padding", asString(config.crop?.padding)), asNumber(config.crop?.padding, 0))
    }
  : config.crop;

mkdirSync(dirname(output), { recursive: true });
mkdirSync(userDataPath, { recursive: true });
writeFileSync(statePath, JSON.stringify(state, null, 2));
if (!interactive) {
  writeFileSync(requestPath, JSON.stringify({
    scenario,
    output,
    actions: config.actions || [],
    crop,
    settleMs: Number.isFinite(config.settleMs) ? config.settleMs : 350,
    debug: hasFlag("debug") || config.debug === true
  }, null, 2));
}

const childEnv: NodeJS.ProcessEnv = {
  ...process.env,
  BOATYARD_CONFIG_ROOT: configurationPath,
  BOATYARD_STATE_PATH: statePath,
  BOATYARD_USER_DATA_PATH: userDataPath
};
if (terminalSessionPrefix) {
  childEnv.BOATYARD_TERMINAL_SESSION_PREFIX = terminalSessionPrefix;
}
if (interactive) {
  delete childEnv.BOATYARD_CAPTURE_REQUEST;
} else {
  childEnv.BOATYARD_CAPTURE_REQUEST = requestPath;
}

const result = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["electron", ".", "--no-sandbox", "--profile", "capture"],
  {
    cwd: repoRoot,
    env: childEnv,
    stdio: "inherit"
  }
);

if (!hasFlag("keep-temp")) {
  rmSync(tempDir, { recursive: true, force: true });
} else {
  console.log(`Kept temporary capture files in ${tempDir}`);
}

if (result.status !== 0) {
  process.exit(result.status || 1);
}

if (interactive) {
  console.log(`Closed interactive capture profile at ${userDataPath}`);
} else {
  console.log(`Captured ${scenario} to ${output}`);
}
