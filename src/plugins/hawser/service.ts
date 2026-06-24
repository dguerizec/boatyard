"use strict";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

/**
 * @typedef {import("../pluginTypes").ExecFileAsync} ExecFileAsync
 * @typedef {{ hawserApiUrl?: string, hawserToken?: string }} HawserSettings
 * @typedef {{ hawserMainSession?: string, slug?: string }} BoatyardProject
 * @typedef {{ name: string, workspace: string, path: string }} HawserProject
 * @typedef {{ project: HawserProject, matchType: "exact" }} HawserProjectMatch
 * @typedef {{ name: string, matchType: "exact", url: string }} HawserProjectInspection
 * @typedef {{ available: boolean, version?: string, error?: string }} HawserCliStatus
 * @typedef {{ fetchImpl?: typeof fetch, execFileAsync?: ExecFileAsync }} HawserStatusOptions
 * @typedef {{ kind?: string, id?: string }} ExternalRef
 * @typedef {{ external_refs?: ExternalRef[], externalRefs?: ExternalRef[] }} ExternalRefContainer
 * @typedef {{
 *   id?: string,
 *   kind?: string,
 *   status?: string,
 *   priority?: string,
 *   subject?: string,
 *   body?: string,
 *   from_project?: string,
 *   from_session?: string,
 *   to_project?: string,
 *   to_session?: string,
 *   created_at?: string,
 *   started_at?: string
 * }} HawserApiMessage
 * @typedef {{ content?: string, twicc_session_id?: string, codex_session_id?: string, runtime_session_id?: string, worktree?: unknown }} HawserMessageEnvelope
 * @typedef {{ project: string, session: string }} HawserSessionTarget
 * @typedef {{
 *   id?: string,
 *   direction: "in" | "out",
 *   kind: string,
 *   status: string,
 *   priority: string,
 *   subject: string,
 *   fromProject: string,
 *   fromSession: string,
 *   toProject: string,
 *   toSession: string,
 *   createdAt: string,
 *   startedAt: string,
 *   preview: string,
 *   twiccSessionId: string,
 *   sessionTarget: HawserSessionTarget,
 *   worktree: unknown
 * }} HawserMessage
 * @typedef {{ unread: number, queued: number, processing: number, activeTasks: number }} HawserMessageCounts
 * @typedef {{ project: string, source: string, live: boolean, counts: HawserMessageCounts, messages: HawserMessage[], error?: string }} HawserWidgetData
 * @typedef {{ execFileAsync?: ExecFileAsync }} HawserCommandOptions
 * @typedef {(projectName: string, sessionName: string, settings?: HawserSettings) => Promise<ExternalRef[]>} FetchSessionRefs
 */

const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082";
const DEFAULT_HAWSER_WEB_URL = "http://localhost:60082";
const DEFAULT_HAWSER_RUNTIME = "codex";
const execFileAsync = promisify(execFile);

/**
 * @param {HawserSettings} settings
 * @returns {string}
 */
function getHawserApiUrl(settings: { hawserApiUrl?: string } = {}) {
  return String(settings.hawserApiUrl || DEFAULT_HAWSER_API_URL).replace(/\/+$/, "");
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizePathForMatch(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : "";
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function normalizeHawserRuntime(value) {
  const runtime = String(value || DEFAULT_HAWSER_RUNTIME).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(runtime)) {
    throw new Error("Hawser runtime must contain only letters, numbers, dots, underscores, or dashes.");
  }

  return runtime;
}

/**
 * @param {unknown} projectName
 * @param {string} baseUrl
 * @returns {string}
 */
function buildHawserProjectUrl(projectName, baseUrl = DEFAULT_HAWSER_WEB_URL) {
  const name = String(projectName || "").trim();
  if (!name) {
    return "";
  }

  try {
    const parsed = new URL(baseUrl || DEFAULT_HAWSER_WEB_URL);
    parsed.hash = `#/projects/${encodeURIComponent(name)}`;
    parsed.search = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

/**
 * @param {unknown} stdout
 * @returns {HawserProject[]}
 */
function parseHawserProjectList(stdout) {
  return String(stdout || "")
    .split(/\r?\n/)
    .map((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) {
        return null;
      }

      return {
        name: parts[0],
        workspace: parts[1] === "-" ? "" : parts[1],
        path: parts.slice(2).join(" ")
      };
    })
    .filter((project) => Boolean(project));
}

/**
 * @param {unknown} projects
 * @param {unknown} sourcePath
 * @returns {HawserProjectMatch | null}
 */
function findHawserProjectMatchForPath(projects, sourcePath) {
  if (!Array.isArray(projects)) {
    return null;
  }

  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const projectList = /** @type {HawserProject[]} */ (projects);
  const exactMatch = projectList.find((project) => normalizePathForMatch(project.path) === normalizedSourcePath);
  return exactMatch
    ? {
        project: exactMatch,
        matchType: /** @type {"exact"} */ ("exact")
      }
    : null;
}

/**
 * @param {HawserCommandOptions} options
 * @returns {Promise<HawserProject[]>}
 */
async function loadHawserProjects({ execFileAsync: runCommand = execFileAsync } = {}) {
  try {
    const { stdout } = await runCommand("hawser", ["list"], {
      timeout: 5000,
      windowsHide: true
    });
    return parseHawserProjectList(stdout);
  } catch {
    return [];
  }
}

/**
 * @param {unknown} sourcePath
 * @param {HawserCommandOptions} options
 * @returns {Promise<HawserProjectInspection | null>}
 */
async function inspectHawserProject(sourcePath, options = {}) {
  const projects = await loadHawserProjects(options);
  const match = findHawserProjectMatchForPath(projects, sourcePath);
  return match?.project?.name
    ? {
        name: match.project.name,
        matchType: match.matchType,
        url: buildHawserProjectUrl(match.project.name)
      }
    : null;
}

/**
 * @param {unknown} sourcePath
 * @param {unknown} runtime
 * @param {HawserCommandOptions} options
 * @returns {Promise<HawserProjectInspection | null>}
 */
async function createHawserProject(sourcePath, runtime = DEFAULT_HAWSER_RUNTIME, { execFileAsync: runCommand = execFileAsync } = {}) {
  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    throw new Error("Source path is required to create a Hawser project.");
  }

  await runCommand("hawser", ["init", "--here", "--runtime", normalizeHawserRuntime(runtime)], {
    cwd: normalizedSourcePath,
    timeout: 30000,
    windowsHide: true
  });

  return inspectHawserProject(normalizedSourcePath, { execFileAsync: runCommand });
}

/**
 * @param {ExecFileAsync} runCommand
 * @returns {Promise<HawserCliStatus>}
 */
async function getHawserCliStatus(runCommand = execFileAsync) {
  try {
    const { stdout } = await runCommand("hawser", ["--version"], {
      timeout: 2000,
      windowsHide: true
    });
    return {
      available: true,
      version: String(stdout || "").trim()
    };
  } catch (error) {
    const cliError = /** @type {NodeJS.ErrnoException} */ (error);
    return {
      available: false,
      error: cliError.code === "ENOENT" ? "Hawser CLI was not found in PATH." : cliError.message
    };
  }
}

/**
 * @param {HawserSettings} settings
 * @param {HawserStatusOptions} options
 */
async function getHawserStatus(
  settings: { hawserApiUrl?: string; hawserToken?: string } = {},
  options: { execFileAsync?: import("../pluginTypes").ExecFileAsync; fetchImpl?: typeof fetch } = {}
) {
  const apiUrl = getHawserApiUrl(settings);
  const token = String(settings.hawserToken || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  const cli = await getHawserCliStatus(options.execFileAsync);
  const headers = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : {};

  try {
    const response = await fetchImpl(`${apiUrl}/api/health`, {
      headers,
      signal: AbortSignal.timeout(2000)
    });

    if (response.ok) {
      const details = await response.json().catch(() => ({}));
      return {
        state: cli.available ? "ready" : "degraded",
        summary: cli.available
          ? "Hawser service is available."
          : "Hawser service is available, but the Hawser CLI is not in PATH.",
        details: {
          apiUrl,
          cliAvailable: cli.available,
          cliVersion: cli.version || "",
          cliError: cli.error || "",
          ...details
        }
      };
    }

    if (response.status === 401 || response.status === 403) {
      return {
        state: "notConfigured",
        summary: token
          ? "Hawser rejected the configured API token."
          : "Hawser service is running. Configure the API token.",
        details: {
          apiUrl,
          cliAvailable: cli.available,
          cliVersion: cli.version || "",
          cliError: cli.error || "",
          status: response.status
        }
      };
    }

    return {
      state: "degraded",
      summary: `Hawser health check returned ${response.status}.`,
      details: {
        apiUrl,
        cliAvailable: cli.available,
        cliVersion: cli.version || "",
        cliError: cli.error || "",
        status: response.status
      }
    };
  } catch (error) {
    const summary = cli.available
      ? "Hawser service is not available."
      : "Hawser CLI was not found in PATH.";
    return {
      state: "unavailable",
      summary,
      details: {
        apiUrl,
        cliAvailable: cli.available,
        cliVersion: cli.version || "",
        cliError: cli.error || "",
        error: error instanceof Error ? error.message : String(error)
      }
    };
  }
}

/**
 * @param {BoatyardProject} project
 * @returns {string}
 */
function parseHawserProjectName(project: { hawserMainSession?: string; slug?: string } = {}) {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  const sessionProject = sessionTarget.includes(":") ? sessionTarget.split(":")[0] : "";
  return sessionProject || project.slug || "";
}

/**
 * @param {BoatyardProject} project
 * @returns {string}
 */
function parseHawserSessionName(project: { hawserMainSession?: string } = {}) {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  return sessionTarget.includes(":") ? sessionTarget.split(":").slice(1).join(":") : "";
}

/**
 * @param {unknown} body
 * @returns {HawserMessageEnvelope | null}
 */
function parseEnvelope(body) {
  const trimmed = String(body || "").trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? /** @type {HawserMessageEnvelope} */ (parsed) : null;
  } catch {
    return null;
  }
}

/**
 * @param {HawserApiMessage} message
 * @returns {string}
 */
function getMessagePreview(message) {
  const envelope = parseEnvelope(message.body);
  const body = envelope?.content || message.body || "";
  return String(body).replace(/\s+/g, " ").trim();
}

/**
 * @param {HawserApiMessage} message
 * @param {string} projectName
 * @returns {HawserMessage}
 */
function normalizeMessage(message, projectName) {
  const direction = message.to_project === projectName ? "in" : "out";
  const envelope = parseEnvelope(message.body);
  const twiccSessionId = envelope?.twicc_session_id || envelope?.codex_session_id || envelope?.runtime_session_id || "";
  const fromProject = message.from_project || "";
  const fromSession = message.from_session || "";
  const toProject = message.to_project || "";
  const toSession = message.to_session || "";

  return {
    id: message.id,
    direction,
    kind: message.kind || "task",
    status: message.status || "unknown",
    priority: message.priority || "normal",
    subject: message.subject || "(no subject)",
    fromProject,
    fromSession,
    toProject,
    toSession,
    createdAt: message.created_at || "",
    startedAt: message.started_at || "",
    preview: getMessagePreview(message),
    twiccSessionId,
    sessionTarget: getMessageSessionTarget({ direction, fromProject, fromSession, toProject, toSession }),
    worktree: envelope?.worktree || null
  };
}

/**
 * @param {Partial<HawserMessage>} message
 * @returns {HawserSessionTarget}
 */
function getMessageSessionTarget(message: Partial<{
  direction: "in" | "out";
  fromProject: string;
  fromSession: string;
  toProject: string;
  toSession: string;
}> = {}) {
  const useOutboundTarget = message.direction === "out";
  return {
    project: useOutboundTarget ? message.toProject || "" : message.fromProject || "",
    session: useOutboundTarget ? message.toSession || "" : message.fromSession || ""
  };
}

/**
 * @param {HawserMessage[]} messages
 * @returns {HawserMessageCounts}
 */
function summarizeMessages(messages) {
  return {
    unread: messages.filter((message) => message.direction === "in" && message.status === "unread").length,
    queued: messages.filter(isQueuedRemoteMessage).length,
    processing: messages.filter(isRunningTask).length,
    activeTasks: messages.filter(isActiveTask).length
  };
}

/**
 * @param {Pick<HawserMessage, "direction" | "status">} message
 * @returns {boolean}
 */
function isQueuedRemoteMessage(message) {
  return message.direction === "out" && message.status === "unread";
}

/**
 * @param {Pick<HawserMessage, "kind" | "status">} message
 * @returns {boolean}
 */
function isRunningTask(message) {
  return message.kind === "task" && message.status === "processing";
}

/**
 * @param {Pick<HawserMessage, "kind" | "status">} message
 * @returns {boolean}
 */
function isActiveTask(message) {
  return message.kind === "task" && (message.status === "unread" || isRunningTask(message));
}

/**
 * @param {Pick<HawserMessage, "status" | "twiccSessionId">} message
 * @returns {boolean}
 */
function shouldShowWidgetMessage(message) {
  return ["unread", "processing"].includes(message.status) || Boolean(message.twiccSessionId);
}

/**
 * @param {string} pathname
 * @param {HawserSettings} settings
 * @returns {Promise<unknown>}
 */
async function fetchHawserJson(pathname, settings: { hawserApiUrl?: string; hawserToken?: string } = {}) {
  const token = String(settings.hawserToken || "").trim();

  if (!token) {
    throw new Error("Hawser token is not configured.");
  }

  const response = await fetch(`${getHawserApiUrl(settings)}${pathname}`, {
    headers: {
      Authorization: `Bearer ${token}`
    }
  });

  if (!response.ok) {
    throw new Error(`Hawser API ${response.status}: ${response.statusText}`);
  }

  return response.json();
}

/**
 * @param {string} pathname
 * @param {HawserSettings} settings
 * @returns {Promise<unknown>}
 */
async function fetchOptionalHawserJson(pathname, settings = {}) {
  try {
    return await fetchHawserJson(pathname, settings);
  } catch {
    return null;
  }
}

/**
 * @param {unknown} value
 * @returns {ExternalRef[]}
 */
function normalizeExternalRefs(value) {
  if (Array.isArray(value)) {
    return /** @type {ExternalRef[]} */ (value);
  }

  const container = /** @type {ExternalRefContainer | null | undefined} */ (value);
  if (Array.isArray(container?.external_refs)) {
    return container.external_refs;
  }

  if (Array.isArray(container?.externalRefs)) {
    return container.externalRefs;
  }

  return [];
}

/**
 * @param {unknown} refs
 * @returns {string}
 */
function getTwiccSessionIdFromRefs(refs = []) {
  const ref = normalizeExternalRefs(refs).find((candidate) => (
    candidate?.kind === "twicc-session" && String(candidate.id || "").trim()
  ));
  return ref ? String(ref.id).trim() : "";
}

/**
 * @param {unknown} sessions
 * @param {string} sessionName
 * @returns {ExternalRef[]}
 */
function getSessionRefsFromSessionList(sessions, sessionName) {
  if (!Array.isArray(sessions)) {
    return [];
  }

  const session = sessions.find((candidate) => (
    /** @type {{ name?: string, session?: string }} */ (candidate)?.name === sessionName
      || /** @type {{ name?: string, session?: string }} */ (candidate)?.session === sessionName
  ));
  return normalizeExternalRefs(session);
}

/**
 * @param {string} projectName
 * @param {string} sessionName
 * @param {HawserSettings} settings
 * @returns {Promise<ExternalRef[]>}
 */
async function fetchHawserSessionRefs(projectName, sessionName, settings = {}) {
  const encodedProject = encodeURIComponent(projectName);
  const encodedSession = encodeURIComponent(sessionName);
  const refs = await fetchOptionalHawserJson(
    `/api/projects/${encodedProject}/sessions/${encodedSession}/refs`,
    settings
  );

  if (refs) {
    return normalizeExternalRefs(refs);
  }

  const sessions = await fetchOptionalHawserJson(`/api/projects/${encodedProject}/sessions`, settings);
  return getSessionRefsFromSessionList(sessions, sessionName);
}

/**
 * @param {HawserMessage[]} messages
 * @param {HawserSettings} settings
 * @param {FetchSessionRefs} fetchSessionRefs
 * @returns {Promise<HawserMessage[]>}
 */
async function addSessionRefsToMessages(messages, settings = {}, fetchSessionRefs = fetchHawserSessionRefs) {
  /** @type {Map<string, HawserSessionTarget>} */
  const targetKeys = new Map();

  for (const message of messages) {
    const target = message.sessionTarget || getMessageSessionTarget(message);
    if (!target.project || !target.session) {
      continue;
    }

    targetKeys.set(`${target.project}\u0000${target.session}`, target);
  }

  const refsByTarget = new Map();
  await Promise.all([...targetKeys].map(async ([key, target]) => {
    const refs = await fetchSessionRefs(target.project, target.session, settings);
    refsByTarget.set(key, refs);
  }));

  return messages.map((message) => {
    const target = message.sessionTarget || getMessageSessionTarget(message);
    const refs = refsByTarget.get(`${target.project}\u0000${target.session}`) || [];
    const twiccSessionId = getTwiccSessionIdFromRefs(refs) || message.twiccSessionId;
    return {
      ...message,
      twiccSessionId
    };
  });
}

/**
 * @param {string} projectName
 * @param {BoatyardProject} project
 * @param {HawserSettings} settings
 * @returns {Promise<HawserWidgetData>}
 */
async function getHawserWidgetDataFromHttp(projectName, project = {}, settings = {}) {
  const sessionName = parseHawserSessionName(project);
  const inboxParams = new URLSearchParams({ all: "true" });
  const sentParams = new URLSearchParams({ all: "true" });

  if (sessionName) {
    inboxParams.set("session", sessionName);
    sentParams.set("session", sessionName);
  }

  const [, inbox, sent] = await Promise.all([
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}`, settings),
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}/inbox?${inboxParams.toString()}`, settings),
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}/sent?${sentParams.toString()}`, settings)
  ]);
  const normalizedMessages = [
    .../** @type {HawserApiMessage[]} */ (inbox),
    .../** @type {HawserApiMessage[]} */ (sent)
  ]
    .map((message) => normalizeMessage(message, projectName))
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 80);
  const messages = (await addSessionRefsToMessages(normalizedMessages, settings))
    .filter(shouldShowWidgetMessage)
    .slice(0, 40);

  return {
    project: projectName,
    source: "http",
    live: true,
    counts: {
      unread: normalizedMessages.filter((message) => message.direction === "in" && message.status === "unread").length,
      queued: normalizedMessages.filter(isQueuedRemoteMessage).length,
      processing: normalizedMessages.filter(isRunningTask).length,
      activeTasks: normalizedMessages.filter(isActiveTask).length
    },
    messages
  };
}

/**
 * @param {BoatyardProject} project
 * @param {HawserSettings} settings
 * @returns {Promise<HawserWidgetData>}
 */
async function getHawserWidgetData(project, settings = {}) {
  const projectName = parseHawserProjectName(project);

  if (!projectName) {
    return {
      project: "",
      source: "none",
      live: false,
      counts: {
        unread: 0,
        queued: 0,
        processing: 0,
        activeTasks: 0
      },
      messages: [],
      error: "Hawser project is not configured."
    };
  }

  try {
    return await getHawserWidgetDataFromHttp(projectName, project, settings);
  } catch (error) {
    return {
      project: projectName,
      source: "http",
      live: false,
      counts: {
        unread: 0,
        queued: 0,
        processing: 0,
        activeTasks: 0
      },
      messages: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export {
  DEFAULT_HAWSER_API_URL,
  DEFAULT_HAWSER_RUNTIME,
  buildHawserProjectUrl,
  addSessionRefsToMessages,
  createHawserProject,
  findHawserProjectMatchForPath,
  getHawserCliStatus,
  getHawserWidgetData,
  getHawserStatus,
  getMessageSessionTarget,
  getTwiccSessionIdFromRefs,
  inspectHawserProject,
  isActiveTask,
  isQueuedRemoteMessage,
  isRunningTask,
  loadHawserProjects,
  normalizeMessage,
  parseHawserProjectList,
  parseHawserProjectName,
  parseHawserSessionName,
  shouldShowWidgetMessage,
  summarizeMessages
};
