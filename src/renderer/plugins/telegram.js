"use strict";

(function registerTelegramPlugin(globalScope) {
  const registry = globalScope.BoatyardPluginRegistry;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function normalizeText(value) {
    return String(value || "").trim();
  }

  function getProjectTopicTitle(project = {}, config = {}) {
    return normalizeText(config.telegramTopicTitle || project.slug || project.name);
  }

  function getTarget(project = {}, projectConfig = {}, globalConfig = {}) {
    return {
      chatId: normalizeText(projectConfig.telegramChatId || globalConfig.telegramDefaultChatId),
      threadId: normalizeText(projectConfig.telegramThreadId),
      topicTopMessageId: normalizeText(projectConfig.telegramTopicTopMessageId),
      topicTitle: getProjectTopicTitle(project, projectConfig),
      chatTitle: normalizeText(projectConfig.telegramChatTitle || globalConfig.telegramDefaultChatTitle),
      botUsername: normalizeText(projectConfig.telegramBotUsername || globalConfig.telegramBotUsername)
    };
  }

  function getTargetLabel(target = {}) {
    const topic = normalizeText(target.topicTitle);
    const chat = normalizeText(target.chatTitle || target.chatId);
    if (chat && topic) {
      return `${chat} / ${topic}`;
    }
    return topic || chat || "No Telegram topic";
  }

  function getTelegramWebLink(target = {}) {
    const chatId = normalizeText(target.chatId);
    const threadId = normalizeText(target.threadId);
    if (!chatId) {
      return "";
    }

    if (chatId.startsWith("@")) {
      return `https://t.me/${encodeURIComponent(chatId.slice(1))}${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;
    }

    const supergroupMatch = chatId.match(/^-100(\d+)$/);
    if (supergroupMatch) {
      return `https://t.me/c/${supergroupMatch[1]}${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;
    }

    return "";
  }

  function isNumericTelegramChatId(value) {
    return /^-?\d+$/.test(normalizeText(value));
  }

  function doesTelegramUpdateMatchTarget(update = {}, target = {}) {
    const updateChatId = normalizeText(update.chatId);
    const targetChatId = normalizeText(target.chatId);
    if (targetChatId && isNumericTelegramChatId(targetChatId) && updateChatId !== targetChatId) {
      return false;
    }

    const targetTopicIds = new Set([
      normalizeText(target.threadId),
      normalizeText(target.topicTopMessageId)
    ].filter(Boolean));
    if (!targetTopicIds.size) {
      return !targetChatId || !isNumericTelegramChatId(targetChatId) || updateChatId === targetChatId;
    }

    return Array.isArray(update.topicIds) && update.topicIds.some((id) => targetTopicIds.has(normalizeText(id)));
  }

  function createTelegramService() {
    return Object.freeze({
      version: "0.1.0",
      getTarget,
      getWebLink: getTelegramWebLink,
      async getStatus(options = {}) {
        if (!globalScope.boatyard?.getTelegramStatus) {
          return {
            state: "unavailable",
            summary: "Telegram IPC bridge is unavailable."
          };
        }
        return globalScope.boatyard.getTelegramStatus(options.globalPluginConfig || {});
      },
      async getMessages(project, options = {}) {
        const target = getTarget(project, options.pluginConfig, options.globalPluginConfig);
        if (!globalScope.boatyard?.getTelegramMessages) {
          return {
            status: {
              state: "unavailable",
              summary: "Telegram IPC bridge is unavailable."
            },
            target,
            messages: []
          };
        }
        return globalScope.boatyard.getTelegramMessages(target, options.globalPluginConfig || {});
      },
      async sendMessage(project, text, options = {}) {
        const target = getTarget(project, options.pluginConfig, options.globalPluginConfig);
        return globalScope.boatyard.sendTelegramMessage(target, text, options.globalPluginConfig || {});
      },
      async startLogin(globalConfig, phoneNumber) {
        return globalScope.boatyard.startTelegramLogin(globalConfig || {}, phoneNumber);
      },
      async completeLoginCode(code) {
        return globalScope.boatyard.completeTelegramLoginCode(code);
      },
      async completeLoginPassword(password) {
        return globalScope.boatyard.completeTelegramLoginPassword(password);
      },
      async logout() {
        return globalScope.boatyard.logoutTelegram();
      },
      onMessage(callback) {
        return globalScope.boatyard?.onTelegramMessage?.(callback) || (() => {});
      },
      openTelegram(target = {}) {
        const link = getTelegramWebLink(target);
        return link ? globalScope.boatyard.openExternal(link) : null;
      }
    });
  }

  function setStatusText(element, status = {}) {
    const summary = status.summary || status.state || "Telegram status unavailable.";
    element.className = `telegram-status-indicator ${status.state || "unknown"}`;
    element.title = summary;
    element.setAttribute("aria-label", summary);
  }

  function renderMessages(list, messages = []) {
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "telegram-empty";
      empty.textContent = "No synced messages yet.";
      list.append(empty);
      return;
    }

    for (const message of messages) {
      const row = document.createElement("article");
      row.className = `telegram-message ${message.outgoing ? "outgoing" : "incoming"}`;

      const meta = document.createElement("div");
      meta.className = "telegram-message-meta";
      meta.textContent = [message.senderName, message.sentAt].map(normalizeText).filter(Boolean).join(" - ");

      const body = document.createElement("p");
      body.textContent = message.text || "";
      row.append(meta, body);
      list.append(row);
    }
  }

  async function persistResolvedTarget(props = {}, target = {}) {
    const threadId = normalizeText(target.threadId);
    const topicTopMessageId = normalizeText(target.topicTopMessageId);
    const currentConfig = props.projectConfig || props.pluginConfig || {};
    const hasUnchangedResolvedTarget =
      normalizeText(currentConfig.telegramThreadId) === threadId &&
      normalizeText(currentConfig.telegramTopicTopMessageId) === topicTopMessageId;
    if (
      !props.projectId ||
      !threadId ||
      hasUnchangedResolvedTarget ||
      !globalScope.boatyard?.updateProjectPluginConfig
    ) {
      return;
    }

    const nextConfig = {
      ...currentConfig,
      telegramThreadId: threadId,
      telegramTopicTopMessageId: topicTopMessageId,
      telegramTopicTitle: target.topicTitle || currentConfig.telegramTopicTitle || ""
    };
    props.projectConfig = nextConfig;
    props.pluginConfig = nextConfig;

    await globalScope.boatyard.updateProjectPluginConfig(props.projectId, "boatyard.telegram", {
      telegramThreadId: threadId,
      telegramTopicTopMessageId: topicTopMessageId,
      telegramTopicTitle: nextConfig.telegramTopicTitle
    });
  }

  function cleanupWhenRemoved(element, cleanup) {
    if (typeof cleanup !== "function" || typeof globalScope.MutationObserver !== "function" || !document.body) {
      return;
    }

    const observer = new globalScope.MutationObserver(() => {
      if (element.isConnected) {
        return;
      }

      cleanup();
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function createTelegramConversation(container, props = {}, service, options = {}) {
    const project = props.project || {};
    const target = service.getTarget(project, props.projectConfig || props.pluginConfig, props.globalPluginConfig);
    const compact = options.compact === true;

    const shell = document.createElement("section");
    shell.className = compact ? "telegram-conversation telegram-widget-conversation" : "telegram-conversation telegram-pane";

    const header = document.createElement("header");
    header.className = compact ? "telegram-widget-header" : "telegram-pane-header";

    const titleWrap = document.createElement("div");
    if (compact) {
      titleWrap.className = "telegram-widget-title";
    }
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = "Telegram";
    const title = document.createElement("h3");
    title.textContent = getTargetLabel(target);
    titleWrap.append(kicker, title);

    const actions = document.createElement("div");
    actions.className = "telegram-pane-actions";

    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = compact ? "telegram-widget-button" : "secondary-button";
    openButton.textContent = "Open";
    openButton.disabled = !service.getWebLink(target);
    openButton.addEventListener("click", () => service.openTelegram(target));

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = compact ? "telegram-widget-button" : "secondary-button";
    refreshButton.textContent = "Refresh";
    const status = document.createElement("span");
    status.className = "telegram-status-indicator";
    status.title = "Loading Telegram status.";
    status.setAttribute("aria-label", "Loading Telegram status.");
    status.setAttribute("role", "status");
    actions.append(status, openButton, refreshButton);
    header.append(titleWrap, actions);

    const auth = document.createElement("form");
    auth.className = "telegram-auth";
    const phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.autocomplete = "tel";
    phoneInput.placeholder = "+15551234567";
    phoneInput.setAttribute("aria-label", "Telegram phone number");
    const startLoginButton = document.createElement("button");
    startLoginButton.type = "button";
    startLoginButton.textContent = "Send code";

    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.inputMode = "numeric";
    codeInput.autocomplete = "one-time-code";
    codeInput.placeholder = "Login code";
    codeInput.setAttribute("aria-label", "Telegram login code");
    const codeButton = document.createElement("button");
    codeButton.type = "button";
    codeButton.textContent = "Confirm";

    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.placeholder = "2FA password";
    passwordInput.setAttribute("aria-label", "Telegram 2FA password");
    const passwordButton = document.createElement("button");
    passwordButton.type = "button";
    passwordButton.textContent = "Unlock";

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.textContent = "Logout";

    const phoneRow = document.createElement("div");
    phoneRow.className = "telegram-auth-row";
    phoneRow.append(phoneInput, startLoginButton);
    const codeRow = document.createElement("div");
    codeRow.className = "telegram-auth-row";
    codeRow.append(codeInput, codeButton);
    const passwordRow = document.createElement("div");
    passwordRow.className = "telegram-auth-row";
    passwordRow.append(passwordInput, passwordButton);
    const logoutRow = document.createElement("div");
    logoutRow.className = "telegram-auth-row";
    logoutRow.append(logoutButton);
    auth.append(phoneRow, codeRow, passwordRow, logoutRow);

    const list = document.createElement("div");
    list.className = "telegram-message-list";

    const form = document.createElement("form");
    form.className = "telegram-composer";
    const input = document.createElement("textarea");
    input.rows = compact ? 2 : 3;
    input.placeholder = `Message ${target.botUsername ? `@${target.botUsername.replace(/^@/, "")}` : "TARS"}`;
    const sendButton = document.createElement("button");
    sendButton.type = "submit";
    sendButton.textContent = "Send";
    form.append(input, sendButton);

    function updateAuthState(state) {
      const phase = state?.state || "";
      const shouldShowAuth = ["authenticating", "notAuthenticated", "codeRequired", "passwordRequired", "ready"].includes(phase);
      auth.hidden = !shouldShowAuth;
      phoneRow.hidden = phase === "codeRequired" || phase === "passwordRequired";
      if (phase === "ready") {
        phoneRow.hidden = true;
      }
      codeRow.hidden = phase !== "codeRequired";
      passwordRow.hidden = phase !== "passwordRequired";
      logoutRow.hidden = phase !== "ready";
      form.hidden = phase !== "ready";
    }

    function isScrolledToBottom(element) {
      return element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    }

    async function load(options = {}) {
      const shouldScrollToBottom = options.scrollToBottom === true || isScrolledToBottom(list);
      const previousScrollTop = list.scrollTop;
      refreshButton.disabled = true;
      try {
        const data = await service.getMessages(project, props);
        await persistResolvedTarget(props, data.target);
        setStatusText(status, data.status);
        updateAuthState(data.status);
        renderMessages(list, data.messages);
        list.scrollTop = shouldScrollToBottom ? list.scrollHeight : previousScrollTop;
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: error.message
        });
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => load());
    startLoginButton.addEventListener("click", async () => {
      startLoginButton.disabled = true;
      try {
        const nextStatus = await service.startLogin(props.globalPluginConfig, phoneInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: error.message
        });
      } finally {
        startLoginButton.disabled = false;
      }
    });
    codeButton.addEventListener("click", async () => {
      codeButton.disabled = true;
      try {
        const nextStatus = await service.completeLoginCode(codeInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
        if (nextStatus.state === "ready") {
          await load();
        }
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: error.message
        });
      } finally {
        codeButton.disabled = false;
      }
    });
    passwordButton.addEventListener("click", async () => {
      passwordButton.disabled = true;
      try {
        const nextStatus = await service.completeLoginPassword(passwordInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
        if (nextStatus.state === "ready") {
          await load();
        }
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: error.message
        });
      } finally {
        passwordButton.disabled = false;
      }
    });
    logoutButton.addEventListener("click", async () => {
      const nextStatus = await service.logout();
      setStatusText(status, nextStatus);
      updateAuthState(nextStatus);
      renderMessages(list, []);
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
        return;
      }

      event.preventDefault();
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        sendButton.click();
      }
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const text = normalizeText(input.value);
      if (!text) {
        return;
      }

      sendButton.disabled = true;
      try {
        await service.sendMessage(project, text, props);
        input.value = "";
        await load({ scrollToBottom: true });
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: error.message
        });
      } finally {
        sendButton.disabled = false;
      }
    });

    shell.append(header, auth, list, form);
    container.append(shell);
    load();

    const unsubscribeTelegramMessage = service.onMessage((update) => {
      if (!shell.isConnected) {
        unsubscribeTelegramMessage();
        return;
      }
      if (doesTelegramUpdateMatchTarget(update, service.getTarget(project, props.projectConfig || props.pluginConfig, props.globalPluginConfig))) {
        load();
      }
    });

    return unsubscribeTelegramMessage;
  }

  function createTelegramPane(container, props = {}, service) {
    return createTelegramConversation(container, props, service);
  }

  function createTelegramWidget(project, props = {}, service) {
    const card = document.createElement("article");
    card.className = "widget-card telegram-widget";

    const content = document.createElement("div");
    content.className = "widget-content telegram-widget-content";
    card.append(content);
    cleanupWhenRemoved(card, createTelegramConversation(content, props, service, { compact: true }));
    return card;
  }

  function syncProjectTopicField(event) {
    if (!["slug", "name"].includes(event.field)) {
      return;
    }

    event.fields?.setDefaultValue("telegramTopicTitle", getProjectTopicTitle(event.coreFields));
  }

  async function refreshTelegramStatus(ctx, globalConfig = {}) {
    const service = registry.getService("boatyard.telegram");
    if (!service) {
      return;
    }

    ctx.status.set(await service.getStatus({ globalPluginConfig: globalConfig }));
  }

  registry.register(
    {
      id: "boatyard.telegram",
      name: "Telegram",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.telegram.topic"],
        panes: ["boatyard.telegram.pane"],
        globalSettings: ["boatyard.telegram.global"],
        projectSettings: ["boatyard.telegram.project"],
        services: ["boatyard.telegram"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:dom",
        "widget:provide",
        "service:provide"
      ]
    },
    {
      activate(ctx) {
        const service = createTelegramService();
        ctx.services.provide("boatyard.telegram", service);
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncProjectTopicField);
        ctx.events.on("boatyard.globalSettings.opened", (event) => {
          refreshTelegramStatus(ctx, event.globalConfig || {});
        });

        ctx.status.set({
          state: "activating",
          summary: "Checking Telegram client configuration."
        });
        refreshTelegramStatus(ctx);

        ctx.settings.registerGlobalSection({
          id: "boatyard.telegram.global",
          title: "Telegram",
          fields: [
            {
              key: "telegramApiId",
              label: "Telegram API ID",
              type: "text",
              valueType: "text",
              placeholder: "123456"
            },
            {
              key: "telegramApiHash",
              label: "Telegram API hash",
              type: "password",
              valueType: "text"
            },
            {
              key: "telegramDefaultChatId",
              label: "Default project chat ID",
              type: "text",
              valueType: "text",
              placeholder: "-1001234567890"
            },
            {
              key: "telegramDefaultChatTitle",
              label: "Default chat title",
              type: "text",
              valueType: "text",
              placeholder: "TARS projects"
            },
            {
              key: "telegramBotUsername",
              label: "TARS bot username",
              type: "text",
              valueType: "text",
              placeholder: "tars_bot"
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.telegram.project",
          title: "Telegram",
          fields: [
            {
              key: "telegramChatId",
              label: "Telegram chat ID",
              type: "text",
              valueType: "text",
              placeholder: "Use global default"
            },
            {
              key: "telegramThreadId",
              label: "Telegram topic ID",
              type: "text",
              valueType: "text",
              placeholder: "message_thread_id"
            },
            {
              key: "telegramTopicTitle",
              label: "Telegram topic title",
              type: "text",
              valueType: "text",
              defaultValue({ project }) {
                return getProjectTopicTitle(project);
              }
            },
            {
              key: "telegramChatTitle",
              label: "Telegram chat title",
              type: "text",
              valueType: "text",
              placeholder: "Use global default"
            }
          ]
        });

        ctx.panes.register({
          id: "boatyard.telegram.pane",
          webAppId: "telegram",
          key: "telegram",
          title: "Telegram",
          kind: "dom",
          scope: "project",
          render(container, props) {
            return createTelegramPane(container, props, service);
          }
        });

        ctx.widgets.register({
          id: "boatyard.telegram.topic",
          name: "Telegram",
          title: "Telegram",
          scope: "project",
          category: "Communication",
          status: "experimental",
          defaultVisible: false,
          description: "Shows the Telegram project topic connected to the TARS bot.",
          layout: {
            default: { columns: 4, rows: 4 },
            min: { columns: 3, rows: 3 }
          },
          createElement(project, props = {}) {
            return createTelegramWidget(project, props, service);
          }
        });
      }
    }
  );
})(window);
