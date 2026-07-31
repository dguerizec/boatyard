import type { BrowserWindow } from "electron";

const fs = require("node:fs");
const path = require("node:path");

type CaptureAction = {
  flags?: unknown;
  key?: unknown;
  lock?: unknown;
  ms?: unknown;
  pattern?: unknown;
  patterns?: unknown;
  replacement?: unknown;
  selector?: unknown;
  source?: unknown;
  timeoutMs?: unknown;
  type?: unknown;
};

type CaptureCrop = {
  padding?: unknown;
  selector?: unknown;
  timeoutMs?: unknown;
};

type CaptureRequest = {
  actions?: CaptureAction[];
  beforeCaptureActions?: CaptureAction[];
  captureSurface?: unknown;
  crop?: CaptureCrop;
  debug?: boolean;
  output?: string;
  scenario?: unknown;
  settleMs?: unknown;
};

type CaptureRunnerOptions = {
  captureScreen?: () => Promise<{ toPNG: () => Buffer }>;
  getMainWindow: () => BrowserWindow | null;
  quitApp: () => void;
  requestEnvName?: string;
};

const DEFAULT_CAPTURE_REQUEST_ENV = "BOATYARD_CAPTURE_REQUEST";

function wait(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function createCaptureRunner({
  captureScreen,
  getMainWindow,
  quitApp,
  requestEnvName = DEFAULT_CAPTURE_REQUEST_ENV
}: CaptureRunnerOptions) {
  function getWindow() {
    const mainWindow = getMainWindow();
    if (!mainWindow) {
      throw new Error("Capture requires an active main window.");
    }
    return mainWindow;
  }

  function isCaptureMode() {
    return Boolean(process.env[requestEnvName]);
  }

  function readCaptureRequest(): CaptureRequest | null {
    const requestPath = process.env[requestEnvName];
    if (!requestPath) {
      return null;
    }

    return JSON.parse(fs.readFileSync(requestPath, "utf8"));
  }

  async function waitForCapturePredicate(source: string, timeoutMs = 8000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
      const matched = await getWindow().webContents.executeJavaScript(source, true);
      if (matched) {
        return true;
      }
      await wait(100);
    }

    throw new Error(`Timed out waiting for capture predicate: ${source}`);
  }

  async function waitForOnboardingStep(stepNumber: number) {
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

  async function waitForCaptureSelector(selector: unknown, timeoutMs = 8000) {
    const quotedSelector = JSON.stringify(String(selector || ""));
    await waitForCapturePredicate(`Boolean(document.querySelector(${quotedSelector}))`, timeoutMs);
  }

  async function runCaptureAction(action: CaptureAction) {
    if (!action || typeof action !== "object") {
      return;
    }

    const mainWindow = getWindow();
    const type = String(action.type || "").trim();
    const timeoutMs = Number.isFinite(action.timeoutMs) ? Number(action.timeoutMs) : 8000;
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

    if (type === "replaceValue") {
      const selector = JSON.stringify(String(action.selector || ""));
      const pattern = JSON.stringify(String(action.pattern || ""));
      const flags = JSON.stringify(String(action.flags || ""));
      const replacement = JSON.stringify(String(action.replacement || ""));
      const lock = action.lock === true;
      await mainWindow.webContents.executeJavaScript(`(() => {
        const pattern = new RegExp(${pattern}, ${flags});
        const replacement = ${replacement};
        const lock = ${JSON.stringify(lock)};
        let replacementCount = 0;
        for (const element of document.querySelectorAll(${selector})) {
          if (!("value" in element)) {
            continue;
          }
          const currentValue = String(element.value || "");
          pattern.lastIndex = 0;
          const nextValue = currentValue.replace(pattern, replacement);
          if (nextValue !== currentValue) {
            element.value = nextValue;
            if (lock) {
              element.removeAttribute("data-webapp-key");
              Object.defineProperty(element, "value", {
                configurable: true,
                get: () => nextValue,
                set: () => undefined
              });
            }
            replacementCount += 1;
          }
        }
        return replacementCount;
      })()`, true);
      return;
    }

    if (type === "assertNoValueMatch") {
      const selector = JSON.stringify(String(action.selector || ""));
      const patterns = JSON.stringify(
        (Array.isArray(action.patterns) ? action.patterns : []).map((pattern) => String(pattern))
      );
      const flags = JSON.stringify(String(action.flags || ""));
      const violations = await mainWindow.webContents.executeJavaScript(`(() => {
        const patterns = ${patterns}.map((pattern) => new RegExp(pattern, ${flags}));
        const violations = [];
        [...document.querySelectorAll(${selector})].forEach((element, elementIndex) => {
          if (!("value" in element)) {
            return;
          }
          const value = String(element.value || "");
          patterns.forEach((pattern, patternIndex) => {
            pattern.lastIndex = 0;
            if (pattern.test(value)) {
              violations.push({ elementIndex, patternIndex });
            }
          });
        });
        return violations;
      })()`, true);
      if (Array.isArray(violations) && violations.length > 0) {
        const patternIndexes = [
          ...new Set(
            violations
              .map((violation) => Number(violation?.patternIndex))
              .filter((patternIndex) => Number.isInteger(patternIndex) && patternIndex >= 0)
          )
        ];
        throw new Error(
          `Capture guard rejected ${violations.length} visible value match(es) for selector ${String(action.selector || "")}` +
          `${patternIndexes.length > 0 ? ` (pattern indexes: ${patternIndexes.join(", ")})` : ""}.`
        );
      }
      return;
    }

    throw new Error(`Unknown capture action type: ${type}`);
  }

  function getOnboardingStepNumber(scenario: unknown) {
    const match = String(scenario || "").match(/^onboarding-step:(\d+)$/);
    return match ? Number.parseInt(match[1], 10) : null;
  }

  async function applyCaptureScenario(scenario: unknown) {
    const onboardingStep = getOnboardingStepNumber(scenario);
    if (onboardingStep) {
      await waitForCapturePredicate("Boolean(document.querySelector('#manual-tour'))");
      await getWindow().webContents.executeJavaScript("document.querySelector('#manual-tour').click()", true);
      await waitForOnboardingStep(1);

      for (let step = 2; step <= onboardingStep; step += 1) {
        await getWindow().webContents.executeJavaScript("document.querySelector('.onboarding-dialog .primary-button').click()", true);
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

  async function applyCaptureActions(actions: unknown = []) {
    for (const action of Array.isArray(actions) ? actions : []) {
      await runCaptureAction(action);
    }
  }

  async function waitForCapturePaint() {
    await getWindow().webContents.executeJavaScript(`new Promise((resolve) => {
      requestAnimationFrame(() => requestAnimationFrame(resolve));
    })`, true);
  }

  async function getCaptureBounds(crop: CaptureCrop | undefined) {
    if (!crop?.selector) {
      return null;
    }

    const quotedSelector = JSON.stringify(String(crop.selector));
    await waitForCaptureSelector(crop.selector, Number.isFinite(crop.timeoutMs) ? Number(crop.timeoutMs) : 8000);
    return getWindow().webContents.executeJavaScript(`(() => {
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
    const mainWindow = getWindow();
    const request = readCaptureRequest();
    if (!request?.output) {
      throw new Error("Capture request must include an output path.");
    }

    const scenario = request.scenario || "global";
    await applyCaptureScenario(scenario);
    await applyCaptureActions(request.actions);
    await wait(Number.isFinite(request.settleMs) ? Number(request.settleMs) : 250);
    await applyCaptureActions(request.beforeCaptureActions);
    await waitForCapturePaint();
    if (request.debug) {
      const state = await mainWindow.webContents.executeJavaScript(`(() => {
        const dialog = document.querySelector(".onboarding-dialog");
        const counter = dialog?.querySelector(".onboarding-header span")?.textContent.trim() || "";
        return {
          dialogOpen: dialog?.open || false,
          dialogVisibility: dialog ? getComputedStyle(dialog).visibility : "",
          counter,
          menuItems: [...document.querySelectorAll(".webapp-tab-menu-item")].map((item) => item.textContent.trim()),
          targetExists: Boolean(document.querySelector(".webapp-tab-menu-item[data-web-app-id='manual']")),
          urlFields: [...document.querySelectorAll(".webapp-url")].map((input) => {
            const pane = input.closest(".webapp-pane");
            const value = String(input.value || "");
            const rect = input.getBoundingClientRect();
            return {
              paneId: pane?.dataset.paneId || "",
              webAppId: pane?.dataset.webAppId || "",
              valueState: value === "http://localhost:3500/project/example"
                ? "neutral"
                : /(?:\\/home\\/|-home-)/i.test(value)
                  ? "personal"
                  : "other",
              visible: rect.width > 0 && rect.height > 0
            };
          })
        };
      })()`, true);
      console.log(JSON.stringify(state, null, 2));
    }

    const captureSurface = String(request.captureSurface || "window").trim();
    if (captureSurface !== "window" && captureSurface !== "screen") {
      throw new Error(`Unknown capture surface: ${captureSurface}`);
    }
    if (captureSurface === "screen" && request.crop?.selector) {
      throw new Error("Screen captures do not support renderer crop selectors.");
    }

    const bounds = await getCaptureBounds(request.crop);
    const image = captureSurface === "screen"
      ? await (captureScreen || (() => {
        throw new Error("Screen capture is unavailable.");
      }))()
      : await mainWindow.capturePage(bounds || undefined);
    fs.mkdirSync(path.dirname(request.output), { recursive: true });
    fs.writeFileSync(request.output, image.toPNG());
    quitApp();
  }

  return Object.freeze({
    isCaptureMode,
    runCaptureRequest
  });
}
