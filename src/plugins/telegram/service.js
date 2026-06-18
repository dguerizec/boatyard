"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { safeStorage } = require("electron");
const { Api, TelegramClient, utils } = require("telegram");
const { NewMessage } = require("telegram/events");
const { StringSession } = require("telegram/sessions");

const CLIENT_OPTIONS = {
  connectionRetries: 3
};
const LOGIN_WAIT_TIMEOUT_MS = 30000;
const MESSAGE_LIMIT = 50;
const TOPIC_HISTORY_SCAN_LIMIT = 500;

function normalizeText(value) {
  return String(value || "").trim();
}

function normalizeTarget(target = {}) {
  const source = target && typeof target === "object" ? target : {};
  return {
    chatId: normalizeText(source.chatId || source.telegramChatId),
    threadId: normalizeText(source.threadId || source.telegramThreadId),
    topicTopMessageId: normalizeText(source.topicTopMessageId || source.telegramTopicTopMessageId),
    topicTitle: normalizeText(source.topicTitle || source.telegramTopicTitle),
    chatTitle: normalizeText(source.chatTitle || source.telegramChatTitle),
    botUsername: normalizeText(source.botUsername || source.telegramBotUsername)
  };
}

function normalizeApiCredentials(globalConfig = {}) {
  const apiId = Number(normalizeText(globalConfig.telegramApiId));
  const apiHash = normalizeText(globalConfig.telegramApiHash);

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    return null;
  }

  return { apiId, apiHash };
}

function normalizeThreadId(value) {
  const threadId = Number(normalizeText(value));
  return Number.isInteger(threadId) && threadId > 0 ? threadId : null;
}

function getMessageTopicIds(message = {}) {
  const replyTo = message.replyTo || {};
  return [
    message.id,
    replyTo.replyToTopId,
    replyTo.replyToMsgId
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getMessageChatId(message = {}) {
  return message.peerId ? utils.getPeerId(message.peerId) : "";
}

function normalizeTopicTitle(value) {
  return normalizeText(value).toLowerCase();
}

function escapeTopicMetadataAttribute(value) {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTopicMetadataPrefix(target = {}) {
  const normalizedTarget = normalizeTarget(target);
  const topicId = normalizeText(normalizedTarget.threadId || normalizedTarget.topicTopMessageId);
  const topicName = normalizeText(normalizedTarget.topicTitle);
  const attributes = [
    topicId ? `id="${escapeTopicMetadataAttribute(topicId)}"` : "",
    topicName ? `name="${escapeTopicMetadataAttribute(topicName)}"` : ""
  ].filter(Boolean);

  return attributes.length ? `<boatyard-topic ${attributes.join(" ")} />` : "";
}

function addTopicMetadataPrefix(text, target = {}) {
  const message = normalizeText(text);
  const prefix = getTopicMetadataPrefix(target);
  return prefix ? `${prefix}\n${message}` : message;
}

function serializeError(error) {
  return normalizeText(error?.errorMessage || error?.message) || "Telegram request failed.";
}

function formatMessageDate(value) {
  const date = Number(value);
  if (!Number.isFinite(date)) {
    return "";
  }

  return new Date(date * 1000).toISOString();
}

function getSenderName(message = {}) {
  const sender = message.sender || {};
  return normalizeText(
    sender.username ||
    [sender.firstName, sender.lastName].map(normalizeText).filter(Boolean).join(" ") ||
    message.senderId?.toString()
  );
}

function mapMessage(message = {}) {
  return {
    id: message.id,
    text: normalizeText(message.message),
    outgoing: message.out === true,
    senderName: getSenderName(message),
    sentAt: formatMessageDate(message.date),
    hasMedia: Boolean(message.media)
  };
}

class TelegramService extends EventEmitter {
  constructor({ sessionFilePath }) {
    super();
    this.sessionFilePath = sessionFilePath;
    this.client = null;
    this.clientKey = "";
    this.pendingLogin = null;
    this.messageEventClient = null;
    this.messageEventBuilder = null;
    this.messageEventHandler = null;
  }

  getStoredSession() {
    try {
      const raw = fs.readFileSync(this.sessionFilePath, "utf8");
      const data = JSON.parse(raw);
      const encryptedSession = normalizeText(data.encryptedSession);
      if (!encryptedSession) {
        return "";
      }

      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error("Electron safeStorage is unavailable.");
      }

      return safeStorage.decryptString(Buffer.from(encryptedSession, "base64"));
    } catch (error) {
      if (error.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  saveSession(sessionString) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error("Electron safeStorage is unavailable; Telegram session cannot be saved securely.");
    }

    fs.mkdirSync(path.dirname(this.sessionFilePath), { recursive: true });
    fs.writeFileSync(
      this.sessionFilePath,
      `${JSON.stringify({
        encryptedSession: safeStorage.encryptString(sessionString).toString("base64"),
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`,
      { mode: 0o600 }
    );
  }

  clearSession() {
    try {
      fs.unlinkSync(this.sessionFilePath);
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
    this.detachMessageEventHandler();
    this.client = null;
    this.clientKey = "";
    this.pendingLogin = null;
  }

  detachMessageEventHandler() {
    if (!this.messageEventClient || !this.messageEventHandler) {
      return;
    }

    this.messageEventClient.removeEventHandler(this.messageEventHandler, this.messageEventBuilder);
    this.messageEventClient = null;
    this.messageEventBuilder = null;
    this.messageEventHandler = null;
  }

  attachMessageEventHandler(client) {
    if (this.messageEventClient === client) {
      return;
    }

    this.detachMessageEventHandler();
    const builder = new NewMessage({});
    const handler = (event) => {
      const message = event?.message;
      if (!message) {
        return;
      }

      this.emit("message", {
        chatId: getMessageChatId(message),
        topicIds: getMessageTopicIds(message).map(String),
        message: mapMessage(message)
      });
    };

    client.addEventHandler(handler, builder);
    this.messageEventClient = client;
    this.messageEventBuilder = builder;
    this.messageEventHandler = handler;
  }

  getClientKey(credentials) {
    return `${credentials.apiId}:${credentials.apiHash}`;
  }

  async getClient(credentials) {
    const key = this.getClientKey(credentials);
    if (this.client && this.clientKey === key) {
      if (!this.client.connected) {
        await this.client.connect();
      }
      return this.client;
    }

    const session = new StringSession(this.getStoredSession());
    const client = new TelegramClient(session, credentials.apiId, credentials.apiHash, CLIENT_OPTIONS);
    await client.connect();
    this.client = client;
    this.clientKey = key;
    this.attachMessageEventHandler(client);
    return client;
  }

  async getAuthorizedClient(globalConfig = {}) {
    const credentials = normalizeApiCredentials(globalConfig);
    if (!credentials) {
      throw new Error("Telegram API credentials are not configured.");
    }

    const client = await this.getClient(credentials);
    const authorized = await client.checkAuthorization();
    if (!authorized) {
      throw new Error("Telegram user is not authenticated.");
    }
    return client;
  }

  async getStatus(globalConfig = {}) {
    const credentials = normalizeApiCredentials(globalConfig);
    if (!credentials) {
      return {
        state: "notConfigured",
        summary: "Telegram API credentials are not configured."
      };
    }

    if (this.pendingLogin) {
      return {
        state: this.pendingLogin.phase || "authenticating",
        summary: this.pendingLogin.summary || "Telegram login is in progress."
      };
    }

    try {
      const client = await this.getClient(credentials);
      const authorized = await client.checkAuthorization();
      if (!authorized) {
        return {
          state: "notAuthenticated",
          summary: "Telegram user is not authenticated."
        };
      }

      const me = await client.getMe();
      return {
        state: "ready",
        summary: `Connected as ${me.username ? `@${me.username}` : [me.firstName, me.lastName].map(normalizeText).filter(Boolean).join(" ") || "Telegram user"}.`
      };
    } catch (error) {
      return {
        state: "unavailable",
        summary: serializeError(error)
      };
    }
  }

  async waitForLoginPhase(login, acceptedPhases) {
    const startedAt = Date.now();
    while (this.pendingLogin === login) {
      if (acceptedPhases.includes(login.phase)) {
        return this.getLoginState(login);
      }
      if (login.error) {
        throw login.error;
      }
      if (Date.now() - startedAt > LOGIN_WAIT_TIMEOUT_MS) {
        throw new Error("Timed out waiting for Telegram login.");
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    return {
      state: "ready",
      summary: "Telegram user is authenticated."
    };
  }

  getLoginState(login = this.pendingLogin) {
    if (!login) {
      return {
        state: "ready",
        summary: "Telegram user is authenticated."
      };
    }

    return {
      state: login.phase || "authenticating",
      summary: login.summary || "Telegram login is in progress.",
      isCodeViaApp: login.isCodeViaApp === true
    };
  }

  async startLogin(globalConfig = {}, phoneNumber = "") {
    const credentials = normalizeApiCredentials(globalConfig);
    const normalizedPhoneNumber = normalizeText(phoneNumber);

    if (!credentials) {
      throw new Error("Telegram API credentials are required before login.");
    }
    if (!normalizedPhoneNumber) {
      throw new Error("Phone number is required.");
    }

    if (this.pendingLogin) {
      return this.getLoginState();
    }

    const client = await this.getClient(credentials);
    if (await client.checkAuthorization()) {
      return {
        state: "ready",
        summary: "Telegram user is already authenticated."
      };
    }

    const login = {
      phase: "authenticating",
      summary: "Sending Telegram login code.",
      isCodeViaApp: false,
      codeResolve: null,
      passwordResolve: null,
      error: null,
      authPromise: null
    };
    this.pendingLogin = login;

    login.authPromise = client.signInUser(credentials, {
      phoneNumber: normalizedPhoneNumber,
      phoneCode: async (isCodeViaApp) => {
        login.phase = "codeRequired";
        login.isCodeViaApp = isCodeViaApp === true;
        login.summary = isCodeViaApp ? "Enter the code sent in Telegram." : "Enter the Telegram login code.";
        return new Promise((resolve) => {
          login.codeResolve = resolve;
        });
      },
      password: async () => {
        login.phase = "passwordRequired";
        login.summary = "Enter the Telegram 2FA password.";
        return new Promise((resolve) => {
          login.passwordResolve = resolve;
        });
      },
      onError: (error) => {
        login.error = error;
        return true;
      }
    }).then((user) => {
      this.saveSession(client.session.save());
      if (this.pendingLogin === login) {
        this.pendingLogin = null;
      }
      return user;
    }).catch((error) => {
      if (this.pendingLogin === login) {
        this.pendingLogin = null;
      }
      throw error;
    });

    return this.waitForLoginPhase(login, ["codeRequired", "passwordRequired"]);
  }

  async completeLoginCode(code = "") {
    const login = this.pendingLogin;
    const normalizedCode = normalizeText(code);
    if (!login?.codeResolve) {
      throw new Error("Telegram login is not waiting for a code.");
    }
    if (!normalizedCode) {
      throw new Error("Telegram login code is required.");
    }

    login.codeResolve(normalizedCode);
    login.codeResolve = null;
    return this.waitForLoginCompletion(login);
  }

  async completeLoginPassword(password = "") {
    const login = this.pendingLogin;
    const normalizedPassword = String(password || "");
    if (!login?.passwordResolve) {
      throw new Error("Telegram login is not waiting for a password.");
    }
    if (!normalizedPassword) {
      throw new Error("Telegram 2FA password is required.");
    }

    login.passwordResolve(normalizedPassword);
    login.passwordResolve = null;
    return this.waitForLoginCompletion(login);
  }

  async waitForLoginCompletion(login) {
    const startedAt = Date.now();
    while (this.pendingLogin === login) {
      if (login.phase === "passwordRequired" && login.passwordResolve) {
        return this.getLoginState(login);
      }
      if (login.error) {
        throw login.error;
      }
      if (Date.now() - startedAt > LOGIN_WAIT_TIMEOUT_MS) {
        return this.getLoginState(login);
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    await login.authPromise;
    return {
      state: "ready",
      summary: "Telegram user is authenticated."
    };
  }

  getPeerValue(target = {}) {
    const chatId = normalizeText(target.chatId);
    if (!chatId) {
      throw new Error("Project Telegram chat is not configured.");
    }

    if (chatId.startsWith("@")) {
      return chatId.slice(1);
    }

    if (/^-?\d+$/.test(chatId)) {
      return BigInt(chatId);
    }

    return chatId;
  }

  async getInputChannel(client, target = {}) {
    return utils.getInputChannel(await client.getInputEntity(this.getPeerValue(target)));
  }

  getTopicThreadId(topic = {}) {
    const id = Number(topic.id);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }

    const topMessage = Number(topic.topMessage);
    return Number.isInteger(topMessage) && topMessage > 0 ? topMessage : null;
  }

  getTopicTopMessageId(topic = {}) {
    const topMessage = Number(topic.topMessage);
    if (Number.isInteger(topMessage) && topMessage > 0) {
      return topMessage;
    }

    return this.getTopicThreadId(topic);
  }

  async listForumTopics(client, target = {}, query = "") {
    const channel = await this.getInputChannel(client, target);
    const response = await client.invoke(new Api.channels.GetForumTopics({
      channel,
      q: normalizeText(query) || undefined,
      offsetDate: 0,
      offsetId: 0,
      offsetTopic: 0,
      limit: 100
    }));

    return Array.isArray(response.topics) ? response.topics : [];
  }

  async findForumTopic(client, target = {}) {
    const title = normalizeTopicTitle(target.topicTitle);
    if (!title) {
      return null;
    }

    const topics = await this.listForumTopics(client, target, target.topicTitle);
    return topics.find((topic) => normalizeTopicTitle(topic.title) === title) || null;
  }

  async resolveProjectTopic(client, target = {}) {
    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget.topicTitle) {
      return normalizedTarget;
    }

    const existing = await this.findForumTopic(client, normalizedTarget);
    if (existing) {
      return {
        ...normalizedTarget,
        threadId: String(this.getTopicThreadId(existing) || ""),
        topicTopMessageId: String(this.getTopicTopMessageId(existing) || ""),
        topicTitle: existing.title || normalizedTarget.topicTitle
      };
    }

    const channel = await this.getInputChannel(client, normalizedTarget);
    await client.invoke(new Api.channels.CreateForumTopic({
      channel,
      title: normalizedTarget.topicTitle
    }));

    const created = await this.findForumTopic(client, normalizedTarget);
    const threadId = this.getTopicThreadId(created);
    if (!threadId) {
      throw new Error(`Telegram topic was created but its thread id could not be resolved: ${normalizedTarget.topicTitle}`);
    }

    return {
      ...normalizedTarget,
      threadId: String(threadId),
      topicTopMessageId: String(this.getTopicTopMessageId(created) || threadId),
      topicTitle: created.title || normalizedTarget.topicTitle
    };
  }

  async resolveProjectTopicWithoutStoredThread(client, target = {}) {
    return this.resolveProjectTopic(client, {
      ...normalizeTarget(target),
      threadId: ""
    });
  }

  getMessageOptions(target = {}) {
    const threadId = normalizeThreadId(target.threadId);
    return threadId ? { replyTo: threadId, topMsgId: threadId } : {};
  }

  async getTopicMessages(client, target = {}, threadId) {
    const topicIds = new Set([
      threadId,
      normalizeThreadId(target.topicTopMessageId)
    ].filter(Boolean));
    const messages = await client.getMessages(this.getPeerValue(target), {
      limit: TOPIC_HISTORY_SCAN_LIMIT
    });

    return messages
      .filter((message) => getMessageTopicIds(message).some((id) => topicIds.has(id)))
      .slice(0, MESSAGE_LIMIT);
  }

  async listMessages(target = {}, globalConfig = {}) {
    const normalizedTarget = normalizeTarget(target);
    if (!normalizedTarget.chatId) {
      return {
        status: {
          state: "notConfigured",
          summary: "Project Telegram chat is not configured."
        },
        target: normalizedTarget,
        messages: []
      };
    }

    try {
      const client = await this.getAuthorizedClient(globalConfig);
      let resolvedTarget = await this.resolveProjectTopic(client, normalizedTarget);
      const params = { limit: MESSAGE_LIMIT };
      const threadId = normalizeThreadId(resolvedTarget.threadId);
      if (threadId) {
        params.replyTo = threadId;
      }

      let messages;
      try {
        messages = threadId
          ? await this.getTopicMessages(client, resolvedTarget, threadId)
          : await client.getMessages(this.getPeerValue(resolvedTarget), params);
      } catch (error) {
        if (serializeError(error) !== "TOPIC_ID_INVALID" || !normalizeThreadId(normalizedTarget.threadId)) {
          throw error;
        }

        resolvedTarget = await this.resolveProjectTopicWithoutStoredThread(client, normalizedTarget);
        const retryThreadId = normalizeThreadId(resolvedTarget.threadId);
        messages = retryThreadId
          ? await this.getTopicMessages(client, resolvedTarget, retryThreadId)
          : await client.getMessages(this.getPeerValue(resolvedTarget), { limit: MESSAGE_LIMIT });
      }
      return {
        status: {
          state: "ready",
          summary: "Telegram messages synced."
        },
        target: resolvedTarget,
        messages: [...messages].reverse().map(mapMessage)
      };
    } catch (error) {
      return {
        status: {
          state: "unavailable",
          summary: serializeError(error)
        },
        target: normalizedTarget,
        messages: []
      };
    }
  }

  async sendMessage(target = {}, text = "", globalConfig = {}) {
    const message = normalizeText(text);
    if (!message) {
      throw new Error("Message is required.");
    }

    const normalizedTarget = normalizeTarget(target);
    const client = await this.getAuthorizedClient(globalConfig);
    const resolvedTarget = await this.resolveProjectTopic(client, normalizedTarget);
    const messageWithMetadata = addTopicMetadataPrefix(message, resolvedTarget);
    const sentMessage = await client.sendMessage(this.getPeerValue(resolvedTarget), {
      message: messageWithMetadata,
      ...this.getMessageOptions(resolvedTarget)
    });

    return {
      sent: true,
      message: mapMessage(sentMessage),
      target: resolvedTarget
    };
  }
}

module.exports = {
  TelegramService,
  addTopicMetadataPrefix,
  getTopicMetadataPrefix,
  normalizeTarget
};
