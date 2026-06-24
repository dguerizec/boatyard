"use strict";

import type { ExecFileAsync } from "../../shared/pluginTypes";

const { execFile } = require("node:child_process");
const path = require("node:path");
const { promisify } = require("node:util");

const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082";
const DEFAULT_HAWSER_WEB_URL = "http://localhost:60082";
const DEFAULT_HAWSER_RUNTIME = "codex";
const execFileAsync = promisify(execFile);

type UnknownRecord = Record<string, unknown>;
type HawserSettings = { hawserApiUrl?: string; hawserToken?: string };
type BoatyardProject = { hawserMainSession?: string; slug?: string };
type HawserProject = { name: string; path: string; workspace: string };
type HawserProjectMatch = { matchType: "exact"; project: HawserProject };
type HawserProjectInspection = { matchType: "exact"; name: string; url: string };
type HawserCliStatus = { available: boolean; error?: string; version?: string };
type HawserStatusOptions = { execFileAsync?: ExecFileAsync; fetchImpl?: typeof fetch };
type ExternalRef = { id?: string; kind?: string };
type HawserApiMessage = {
  body?: string;
  created_at?: string;
  from_project?: string;
  from_session?: string;
  id?: string;
  kind?: string;
  priority?: string;
  started_at?: string;
  status?: string;
  subject?: string;
  to_project?: string;
  to_session?: string;
};
type HawserMessageEnvelope = {
  codex_session_id?: string;
  content?: string;
  runtime_session_id?: string;
  twicc_session_id?: string;
  worktree?: unknown;
};
type HawserSessionTarget = { project: string; session: string };
type HawserMessage = {
  createdAt: string;
  direction: "in" | "out";
  fromProject: string;
  fromSession: string;
  id?: string;
  kind: string;
  preview: string;
  priority: string;
  sessionTarget: HawserSessionTarget;
  startedAt: string;
  status: string;
  subject: string;
  toProject: string;
  toSession: string;
  twiccSessionId: string;
  worktree: unknown;
};
type HawserMessageCounts = { activeTasks: number; processing: number; queued: number; unread: number };
type HawserWidgetData = {
  counts: HawserMessageCounts;
  error?: string;
  live: boolean;
  messages: HawserMessage[];
  project: string;
  source: string;
};
type HawserCommandOptions = { execFileAsync?: ExecFileAsync };
type FetchSessionRefs = (projectName: string, sessionName: string, settings?: HawserSettings) => Promise<ExternalRef[]>;

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isExternalRef(value: unknown): value is ExternalRef {
  return isRecord(value);
}

function isHawserApiMessage(value: unknown): value is HawserApiMessage {
  return isRecord(value);
}

function getErrorCode(error: unknown): string {
  return isRecord(error) ? String(error.code || "") : "";
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function getHawserApiUrl(settings: HawserSettings = {}): string {
  return String(settings.hawserApiUrl || DEFAULT_HAWSER_API_URL).replace(/\/+$/, "");
}

function normalizePathForMatch(value: unknown): string {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed ? path.resolve(trimmed) : "";
}

function normalizeHawserRuntime(value: unknown): string {
  const runtime = String(value || DEFAULT_HAWSER_RUNTIME).trim();
  if (!/^[A-Za-z0-9_.-]+$/.test(runtime)) {
    throw new Error("Hawser runtime must contain only letters, numbers, dots, underscores, or dashes.");
  }

  return runtime;
}

function buildHawserProjectUrl(projectName: unknown, baseUrl = DEFAULT_HAWSER_WEB_URL): string {
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

function parseHawserProjectList(stdout: unknown): HawserProject[] {
  const projects: HawserProject[] = [];
  String(stdout || "")
    .split(/\r?\n/)
    .forEach((line) => {
      const parts = line.trim().split(/\s+/);
      if (parts.length < 3) {
        return;
      }

      projects.push({
        name: parts[0],
        workspace: parts[1] === "-" ? "" : parts[1],
        path: parts.slice(2).join(" ")
      });
    });
  return projects;
}

function findHawserProjectMatchForPath(projects: unknown, sourcePath: unknown): HawserProjectMatch | null {
  if (!Array.isArray(projects)) {
    return null;
  }

  const normalizedSourcePath = normalizePathForMatch(sourcePath);
  if (!normalizedSourcePath) {
    return null;
  }

  const projectList = projects.filter((project): project is HawserProject => isRecord(project));
  const exactMatch = projectList.find((project) => normalizePathForMatch(project.path) === normalizedSourcePath);
  return exactMatch
    ? {
        project: exactMatch,
        matchType: "exact"
      }
    : null;
}

async function loadHawserProjects({ execFileAsync: runCommand = execFileAsync }: HawserCommandOptions = {}): Promise<HawserProject[]> {
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

async function inspectHawserProject(sourcePath: unknown, options: HawserCommandOptions = {}): Promise<HawserProjectInspection | null> {
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

async function createHawserProject(
  sourcePath: unknown,
  runtime = DEFAULT_HAWSER_RUNTIME,
  { execFileAsync: runCommand = execFileAsync }: HawserCommandOptions = {}
): Promise<HawserProjectInspection | null> {
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

async function getHawserCliStatus(runCommand: ExecFileAsync = execFileAsync): Promise<HawserCliStatus> {
  try {
    const { stdout } = await runCommand("hawser", ["--version"], {
      timeout: 2000,
      windowsHide: true
    });
    return {
      available: true,
      version: String(stdout || "").trim()
    };
  } catch (error: unknown) {
    return {
      available: false,
      error: getErrorCode(error) === "ENOENT" ? "Hawser CLI was not found in PATH." : getErrorMessage(error)
    };
  }
}

async function getHawserStatus(
  settings: HawserSettings = {},
  options: HawserStatusOptions = {}
) {
  const apiUrl = getHawserApiUrl(settings);
  const token = String(settings.hawserToken || "").trim();
  const fetchImpl = options.fetchImpl || fetch;
  const cli = await getHawserCliStatus(options.execFileAsync);
  const headers: HeadersInit | undefined = token
    ? {
        Authorization: `Bearer ${token}`
      }
    : undefined;

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

function parseHawserProjectName(project: BoatyardProject = {}): string {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  const sessionProject = sessionTarget.includes(":") ? sessionTarget.split(":")[0] : "";
  return sessionProject || project.slug || "";
}

function parseHawserSessionName(project: BoatyardProject = {}): string {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  return sessionTarget.includes(":") ? sessionTarget.split(":").slice(1).join(":") : "";
}

function parseEnvelope(body: unknown): HawserMessageEnvelope | null {
  const trimmed = String(body || "").trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function getMessagePreview(message: HawserApiMessage): string {
  const envelope = parseEnvelope(message.body);
  const body = envelope?.content || message.body || "";
  return String(body).replace(/\s+/g, " ").trim();
}

function normalizeMessage(message: HawserApiMessage, projectName: string): HawserMessage {
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

function getMessageSessionTarget(message: Partial<{
  direction: "in" | "out";
  fromProject: string;
  fromSession: string;
  toProject: string;
  toSession: string;
}> = {}): HawserSessionTarget {
  const useOutboundTarget = message.direction === "out";
  return {
    project: useOutboundTarget ? message.toProject || "" : message.fromProject || "",
    session: useOutboundTarget ? message.toSession || "" : message.fromSession || ""
  };
}

function summarizeMessages(messages: HawserMessage[]): HawserMessageCounts {
  return {
    unread: messages.filter((message) => message.direction === "in" && message.status === "unread").length,
    queued: messages.filter(isQueuedRemoteMessage).length,
    processing: messages.filter(isRunningTask).length,
    activeTasks: messages.filter(isActiveTask).length
  };
}

function isQueuedRemoteMessage(message: Pick<HawserMessage, "direction" | "status">): boolean {
  return message.direction === "out" && message.status === "unread";
}

function isRunningTask(message: Pick<HawserMessage, "kind" | "status">): boolean {
  return message.kind === "task" && message.status === "processing";
}

function isActiveTask(message: Pick<HawserMessage, "kind" | "status">): boolean {
  return message.kind === "task" && (message.status === "unread" || isRunningTask(message));
}

function shouldShowWidgetMessage(message: Pick<HawserMessage, "status" | "twiccSessionId">): boolean {
  return ["unread", "processing"].includes(message.status) || Boolean(message.twiccSessionId);
}

async function fetchHawserJson(pathname: string, settings: HawserSettings = {}): Promise<unknown> {
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

async function fetchOptionalHawserJson(pathname: string, settings: HawserSettings = {}): Promise<unknown> {
  try {
    return await fetchHawserJson(pathname, settings);
  } catch {
    return null;
  }
}

function normalizeExternalRefs(value: unknown): ExternalRef[] {
  if (Array.isArray(value)) {
    return value.filter(isExternalRef);
  }

  const container = isRecord(value) ? value : null;
  if (Array.isArray(container?.external_refs)) {
    return container.external_refs.filter(isExternalRef);
  }

  if (Array.isArray(container?.externalRefs)) {
    return container.externalRefs.filter(isExternalRef);
  }

  return [];
}

function getTwiccSessionIdFromRefs(refs: unknown = []): string {
  const ref = normalizeExternalRefs(refs).find((candidate) => (
    candidate?.kind === "twicc-session" && String(candidate.id || "").trim()
  ));
  return ref ? String(ref.id).trim() : "";
}

function getSessionRefsFromSessionList(sessions: unknown, sessionName: string): ExternalRef[] {
  if (!Array.isArray(sessions)) {
    return [];
  }

  const session = sessions.find((candidate) => (
    (isRecord(candidate) && candidate.name === sessionName)
      || (isRecord(candidate) && candidate.session === sessionName)
  ));
  return normalizeExternalRefs(session);
}

async function fetchHawserSessionRefs(projectName: string, sessionName: string, settings: HawserSettings = {}): Promise<ExternalRef[]> {
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

async function addSessionRefsToMessages(
  messages: HawserMessage[],
  settings: HawserSettings = {},
  fetchSessionRefs: FetchSessionRefs = fetchHawserSessionRefs
): Promise<HawserMessage[]> {
  const targetKeys = new Map<string, HawserSessionTarget>();

  for (const message of messages) {
    const target = message.sessionTarget || getMessageSessionTarget(message);
    if (!target.project || !target.session) {
      continue;
    }

    targetKeys.set(`${target.project}\u0000${target.session}`, target);
  }

  const refsByTarget = new Map<string, ExternalRef[]>();
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

async function getHawserWidgetDataFromHttp(
  projectName: string,
  project: BoatyardProject = {},
  settings: HawserSettings = {}
): Promise<HawserWidgetData> {
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
    ...(Array.isArray(inbox) ? inbox.filter(isHawserApiMessage) : []),
    ...(Array.isArray(sent) ? sent.filter(isHawserApiMessage) : [])
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

async function getHawserWidgetData(project: BoatyardProject, settings: HawserSettings = {}): Promise<HawserWidgetData> {
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
