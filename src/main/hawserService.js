"use strict";

const DEFAULT_HAWSER_API_URL = "http://127.0.0.1:60082";

function getHawserApiUrl(settings = {}) {
  return String(settings.hawserApiUrl || DEFAULT_HAWSER_API_URL).replace(/\/+$/, "");
}

function parseHawserProjectName(project = {}) {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  const sessionProject = sessionTarget.includes(":") ? sessionTarget.split(":")[0] : "";
  return sessionProject || project.slug || "";
}

function parseHawserSessionName(project = {}) {
  const sessionTarget = String(project.hawserMainSession || "").trim();
  return sessionTarget.includes(":") ? sessionTarget.split(":").slice(1).join(":") : "";
}

function parseEnvelope(body) {
  const trimmed = String(body || "").trim();

  if (!trimmed.startsWith("{")) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function getMessagePreview(message) {
  const envelope = parseEnvelope(message.body);
  const body = envelope?.content || message.body || "";
  return String(body).replace(/\s+/g, " ").trim();
}

function normalizeMessage(message, projectName) {
  const direction = message.to_project === projectName ? "in" : "out";
  const envelope = parseEnvelope(message.body);
  const twiccSessionId = envelope?.twicc_session_id || envelope?.codex_session_id || envelope?.runtime_session_id || "";

  return {
    id: message.id,
    direction,
    kind: message.kind || "task",
    status: message.status || "unknown",
    priority: message.priority || "normal",
    subject: message.subject || "(no subject)",
    fromProject: message.from_project || "",
    fromSession: message.from_session || "",
    toProject: message.to_project || "",
    toSession: message.to_session || "",
    createdAt: message.created_at || "",
    startedAt: message.started_at || "",
    preview: getMessagePreview(message),
    twiccSessionId,
    worktree: envelope?.worktree || null
  };
}

function summarizeMessages(messages) {
  return {
    unread: messages.filter((message) => message.direction === "in" && message.status === "unread").length,
    processing: messages.filter((message) => message.kind === "task" && message.status === "processing").length,
    activeTasks: messages.filter((message) => message.kind === "task" && ["unread", "processing"].includes(message.status)).length
  };
}

function shouldShowWidgetMessage(message) {
  return ["unread", "processing"].includes(message.status) || Boolean(message.twiccSessionId);
}

async function fetchHawserJson(pathname, settings = {}) {
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

async function getHawserWidgetDataFromHttp(projectName, project = {}, settings = {}) {
  const sessionName = parseHawserSessionName(project);
  const inboxParams = new URLSearchParams({ all: "true" });
  const sentParams = new URLSearchParams({ all: "true" });

  if (sessionName) {
    inboxParams.set("session", sessionName);
    sentParams.set("session", sessionName);
  }

  const [projectInfo, inbox, sent] = await Promise.all([
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}`, settings),
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}/inbox?${inboxParams.toString()}`, settings),
    fetchHawserJson(`/api/projects/${encodeURIComponent(projectName)}/sent?${sentParams.toString()}`, settings)
  ]);
  const messages = [...inbox, ...sent]
    .map((message) => normalizeMessage(message, projectName))
    .filter(shouldShowWidgetMessage)
    .sort((left, right) => String(right.createdAt).localeCompare(String(left.createdAt)))
    .slice(0, 40);

  return {
    project: projectName,
    source: "http",
    live: true,
    counts: {
      unread: projectInfo.pending_message_count || 0,
      processing: projectInfo.processing_message_count || 0,
      activeTasks: messages.filter((message) => message.kind === "task").length
    },
    messages
  };
}

async function getHawserWidgetData(project, settings = {}) {
  const projectName = parseHawserProjectName(project);

  if (!projectName) {
    return {
      project: "",
      source: "none",
      live: false,
      counts: {
        unread: 0,
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
        processing: 0,
        activeTasks: 0
      },
      messages: [],
      error: error.message
    };
  }
}

module.exports = {
  DEFAULT_HAWSER_API_URL,
  getHawserWidgetData,
  normalizeMessage,
  parseHawserProjectName,
  parseHawserSessionName,
  shouldShowWidgetMessage,
  summarizeMessages
};
