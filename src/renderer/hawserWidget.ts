import type {
  HawserWidgetData,
  HawserWidgetMessage,
  HawserWidgetOptions,
  RendererProject
} from "./rendererTypes.js";

function formatHawserEndpoint(message: HawserWidgetMessage) {
  if (message.direction === "in") {
    return `from ${message.fromProject || "?"}${message.fromSession ? `:${message.fromSession}` : ""}`;
  }

  return `to ${message.toProject || "?"}${message.toSession ? `:${message.toSession}` : ""}`;
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error || "Unknown error");
}

export function createHawserWidget(project: RendererProject, options: HawserWidgetOptions = {}) {
  const loadData = options.loadData;
  const card = document.createElement("article");
  card.className = "widget-card hawser-widget";

  const header = document.createElement("header");
  header.className = "hawser-widget-header";

  const title = document.createElement("div");
  title.className = "hawser-widget-title";

  const titleText = document.createElement("h3");
  titleText.textContent = options.title || "Hawser";

  const subtitle = document.createElement("small");
  subtitle.textContent = options.subtitle || `${project.slug}:main`;

  title.append(titleText, subtitle);

  const status = document.createElement("span");
  status.className = "hawser-widget-status";
  status.textContent = "Loading";

  header.append(title, status);

  const metrics = document.createElement("div");
  metrics.className = "hawser-widget-metrics";

  const metricEntries = [
    ["unread", "Unread"],
    ["queued", "Queued"],
    ["processing", "Running"]
  ];
  const metricValues = new Map<string, HTMLElement>();

  for (const [key, label] of metricEntries) {
    const metric = document.createElement("div");
    metric.className = "hawser-widget-metric";

    const value = document.createElement("strong");
    value.textContent = "0";
    metricValues.set(key, value);

    const labelElement = document.createElement("span");
    labelElement.textContent = label;

    metric.append(value, labelElement);
    metrics.append(metric);
  }

  const list = document.createElement("div");
  list.className = "hawser-message-list";

  const footer = document.createElement("p");
  footer.className = "hawser-widget-footer";
  footer.hidden = true;

  card.append(header, metrics, list, footer);

  function isActiveHawserMessage(message: HawserWidgetMessage) {
    return ["unread", "processing"].includes(message.status || "");
  }

  function isPendingHawserSession(message: HawserWidgetMessage) {
    return message.kind === "task" && isActiveHawserMessage(message) && !message.twiccSessionUrl;
  }

  function createHawserMessageRow(message: HawserWidgetMessage) {
    const row = document.createElement("div");
    row.className = `hawser-message-row ${message.status}`;

    const subject = document.createElement("strong");
    subject.textContent = message.subject || "";

    const meta = document.createElement("span");
    meta.textContent = `${message.kind} / ${message.status} / ${formatHawserEndpoint(message)}`;

    const preview = document.createElement("small");
    preview.textContent = message.worktree?.state
      ? `${message.worktree.kind || "worktree"} / ${message.worktree.state}`
      : message.preview || "No preview.";

    row.append(subject, meta, preview);

    if (message.twiccSessionUrl && typeof options.onOpenMessage === "function") {
      const twiccButton = document.createElement("button");
      twiccButton.className = "hawser-message-link";
      twiccButton.type = "button";
      twiccButton.textContent = "Open Twicc session";
      twiccButton.addEventListener("click", () => options.onOpenMessage?.(message));
      row.append(twiccButton);
    } else if (isPendingHawserSession(message)) {
      const pending = document.createElement("span");
      pending.className = "hawser-message-pending";
      pending.textContent = "Session pending";
      row.append(pending);
    }

    return row;
  }

  function appendMessageSection(title: string, messages: HawserWidgetMessage[]) {
    if (!messages.length) {
      return;
    }

    const section = document.createElement("section");
    section.className = "hawser-message-section";

    const heading = document.createElement("h4");
    heading.textContent = title;
    section.append(heading, ...messages.map(createHawserMessageRow));
    list.append(section);
  }

  function renderMessages(data: HawserWidgetData) {
    list.innerHTML = "";

    if (!data.messages.length) {
      const empty = document.createElement("p");
      empty.className = "hawser-message-empty";
      empty.textContent = "No active inbox or linked sessions.";
      list.append(empty);
      return;
    }

    const activeMessages = data.messages.filter(isActiveHawserMessage);
    const historyMessages = data.messages.filter((message) => !isActiveHawserMessage(message));
    appendMessageSection("Active", activeMessages);
    appendMessageSection("History", historyMessages);
  }

  async function refresh() {
    if (!document.body.contains(card)) {
      clearInterval(intervalId);
      return;
    }

    try {
      const data = await loadData(project);
      status.textContent = data.live ? "Live" : "Offline";
      status.classList.toggle("offline", !data.live);
      for (const [key, value] of metricValues) {
        value.textContent = String(data.counts?.[key] || 0);
      }
      renderMessages(data);
      footer.hidden = !data.error;
      footer.textContent = data.error || "";
    } catch (error) {
      status.textContent = "Error";
      status.classList.add("offline");
      footer.hidden = false;
      footer.textContent = getErrorMessage(error);
    }
  }

  const intervalId = setInterval(refresh, 5000);
  queueMicrotask(refresh);
  return card;
}
