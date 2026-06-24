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

type UnknownRecord = Record<string, unknown>;

type TelegramCredentials = {
  apiId: number;
  apiHash: string;
};

type TelegramTarget = {
  botUsername: string;
  chatId: string;
  chatTitle: string;
  threadId: string;
  topicTitle: string;
  topicTopMessageId: string;
};

type TelegramMappedMessage = {
  hasMedia: boolean;
  id: unknown;
  outgoing: boolean;
  senderName: string;
  sentAt: string;
  text: string;
};

type TelegramLoginState = {
  isCodeViaApp?: boolean;
  state: string;
  summary: string;
};

type TelegramEventHandler = (event: { message?: unknown }) => void;

type TelegramRuntimeClient = {
  addEventHandler(handler: TelegramEventHandler, builder: unknown): void;
  checkAuthorization(): Promise<boolean>;
  connect(): Promise<unknown>;
  connected?: boolean;
  getInputEntity(peer: unknown): Promise<unknown>;
  getMe(): Promise<UnknownRecord>;
  getMessages(peer: unknown, options: UnknownRecord): Promise<UnknownRecord[]>;
  invoke(request: unknown): Promise<UnknownRecord>;
  removeEventHandler(handler: TelegramEventHandler, builder: unknown): void;
  sendMessage(peer: unknown, options: UnknownRecord): Promise<UnknownRecord>;
  session: {
    save(): string;
  };
  signInUser(
    credentials: TelegramCredentials,
    callbacks: {
      onError(error: Error): boolean;
      password(): Promise<string>;
      phoneCode(isCodeViaApp: boolean): Promise<string>;
      phoneNumber: string;
    }
  ): Promise<unknown>;
};

type TelegramPendingLogin = {
  authPromise: Promise<unknown> | null;
  codeResolve: ((code: string) => void) | null;
  error: Error | null;
  isCodeViaApp: boolean;
  passwordResolve: ((password: string) => void) | null;
  phase: string;
  summary: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function getRecord(value: unknown): UnknownRecord {
  return isRecord(value) ? value : {};
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeTarget(target: unknown = {}): TelegramTarget {
  const source = getRecord(target);
  return {
    chatId: normalizeText(source.chatId || source.telegramChatId),
    threadId: normalizeText(source.threadId || source.telegramThreadId),
    topicTopMessageId: normalizeText(source.topicTopMessageId || source.telegramTopicTopMessageId),
    topicTitle: normalizeText(source.topicTitle || source.telegramTopicTitle),
    chatTitle: normalizeText(source.chatTitle || source.telegramChatTitle),
    botUsername: normalizeText(source.botUsername || source.telegramBotUsername)
  };
}

function normalizeApiCredentials(globalConfig: unknown = {}): TelegramCredentials | null {
  const source = getRecord(globalConfig);
  const apiId = Number(normalizeText(source.telegramApiId));
  const apiHash = normalizeText(source.telegramApiHash);

  if (!Number.isInteger(apiId) || apiId <= 0 || !apiHash) {
    return null;
  }

  return { apiId, apiHash };
}

function normalizeThreadId(value: unknown): number | null {
  const threadId = Number(normalizeText(value));
  return Number.isInteger(threadId) && threadId > 0 ? threadId : null;
}

function getMessageTopicIds(message: unknown = {}): number[] {
  const source = getRecord(message);
  const replyTo = getRecord(source.replyTo);
  return [
    source.id,
    replyTo.replyToTopId,
    replyTo.replyToMsgId
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getMessageChatId(message: unknown = {}): string {
  const source = getRecord(message);
  return source.peerId ? utils.getPeerId(source.peerId) : "";
}

function normalizeTopicTitle(value: unknown): string {
  return normalizeText(value).toLowerCase();
}

function escapeTopicMetadataAttribute(value: unknown): string {
  return normalizeText(value)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function getTopicMetadataPrefix(target: unknown = {}): string {
  const normalizedTarget = normalizeTarget(target);
  const topicId = normalizeText(normalizedTarget.threadId || normalizedTarget.topicTopMessageId);
  const topicName = normalizeText(normalizedTarget.topicTitle);
  const attributes = [
    topicId ? `id="${escapeTopicMetadataAttribute(topicId)}"` : "",
    topicName ? `name="${escapeTopicMetadataAttribute(topicName)}"` : ""
  ].filter(Boolean);

  return attributes.length ? `<boatyard-topic ${attributes.join(" ")} />` : "";
}

function addTopicMetadataPrefix(text: unknown, target: unknown = {}): string {
  const message = normalizeText(text);
  const prefix = getTopicMetadataPrefix(target);
  return prefix ? `${prefix}\n${message}` : message;
}

function serializeError(error: unknown): string {
  const source = getRecord(error);
  return normalizeText(source.errorMessage || source.message) || "Telegram request failed.";
}

function formatMessageDate(value: unknown): string {
  const date = Number(value);
  if (!Number.isFinite(date)) {
    return "";
  }

  return new Date(date * 1000).toISOString();
}

function getSenderName(message: unknown = {}): string {
  const source = getRecord(message);
  const sender = getRecord(source.sender);
  return normalizeText(
    sender.username ||
    [sender.firstName, sender.lastName].map(normalizeText).filter(Boolean).join(" ") ||
    source.senderId?.toString()
  );
}

function mapMessage(message: unknown = {}): TelegramMappedMessage {
  const source = getRecord(message);
  return {
    id: source.id,
    text: normalizeText(source.message),
    outgoing: source.out === true,
    senderName: getSenderName(source),
    sentAt: formatMessageDate(source.date),
    hasMedia: Boolean(source.media)
  };
}

class TelegramService extends EventEmitter {
  client: TelegramRuntimeClient | null;
  clientKey: string;
  messageEventBuilder: unknown | null;
  messageEventClient: TelegramRuntimeClient | null;
  messageEventHandler: TelegramEventHandler | null;
  pendingLogin: TelegramPendingLogin | null;
  sessionFilePath: string;

  constructor({ sessionFilePath }: { sessionFilePath: string }) {
    super();
    this.sessionFilePath = sessionFilePath;
    this.client = null;
    this.clientKey = "";
    this.pendingLogin = null;
    this.messageEventClient = null;
    this.messageEventBuilder = null;
    this.messageEventHandler = null;
  }

  getStoredSession(): string {
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
    } catch (error: unknown) {
      const readError = error as NodeJS.ErrnoException;
      if (readError.code === "ENOENT") {
        return "";
      }
      throw error;
    }
  }

  saveSession(sessionString: string): void {
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

  clearSession(): void {
    try {
      fs.unlinkSync(this.sessionFilePath);
    } catch (error: unknown) {
      const unlinkError = error as NodeJS.ErrnoException;
      if (unlinkError.code !== "ENOENT") {
        throw error;
      }
    }
    this.detachMessageEventHandler();
    this.client = null;
    this.clientKey = "";
    this.pendingLogin = null;
  }

  detachMessageEventHandler(): void {
    if (!this.messageEventClient || !this.messageEventHandler) {
      return;
    }

    this.messageEventClient.removeEventHandler(this.messageEventHandler, this.messageEventBuilder);
    this.messageEventClient = null;
    this.messageEventBuilder = null;
    this.messageEventHandler = null;
  }

  attachMessageEventHandler(client: TelegramRuntimeClient): void {
    if (this.messageEventClient === client) {
      return;
    }

    this.detachMessageEventHandler();
    const builder = new NewMessage({});
    const handler: TelegramEventHandler = (event) => {
      const message = event?.message;
      if (!isRecord(message)) {
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

  getClientKey(credentials: TelegramCredentials): string {
    return `${credentials.apiId}:${credentials.apiHash}`;
  }

  async getClient(credentials: TelegramCredentials): Promise<TelegramRuntimeClient> {
    const key = this.getClientKey(credentials);
    if (this.client && this.clientKey === key) {
      if (!this.client.connected) {
        await this.client.connect();
      }
      return this.client;
    }

    const session = new StringSession(this.getStoredSession());
    const client = new TelegramClient(session, credentials.apiId, credentials.apiHash, CLIENT_OPTIONS) as TelegramRuntimeClient;
    await client.connect();
    this.client = client;
    this.clientKey = key;
    this.attachMessageEventHandler(client);
    return client;
  }

  async getAuthorizedClient(globalConfig: unknown = {}): Promise<TelegramRuntimeClient> {
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

  async getStatus(globalConfig: unknown = {}): Promise<TelegramLoginState> {
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

  async waitForLoginPhase(login: TelegramPendingLogin, acceptedPhases: string[]): Promise<TelegramLoginState> {
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

  getLoginState(login: TelegramPendingLogin | null = this.pendingLogin): TelegramLoginState {
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

  async startLogin(globalConfig: unknown = {}, phoneNumber: unknown = ""): Promise<TelegramLoginState> {
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

    const login: TelegramPendingLogin = {
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
      phoneCode: async (isCodeViaApp: boolean) => {
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
      onError: (error: Error) => {
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

  async completeLoginCode(code: unknown = ""): Promise<TelegramLoginState> {
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

  async completeLoginPassword(password: unknown = ""): Promise<TelegramLoginState> {
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

  async waitForLoginCompletion(login: TelegramPendingLogin): Promise<TelegramLoginState> {
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

  getPeerValue(target: unknown = {}): string | bigint {
    const source = getRecord(target);
    const chatId = normalizeText(source.chatId);
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

  async getInputChannel(client: TelegramRuntimeClient, target: unknown = {}): Promise<unknown> {
    return utils.getInputChannel(await client.getInputEntity(this.getPeerValue(target)));
  }

  getTopicThreadId(topic: unknown = {}): number | null {
    const source = getRecord(topic);
    const id = Number(source.id);
    if (Number.isInteger(id) && id > 0) {
      return id;
    }

    const topMessage = Number(source.topMessage);
    return Number.isInteger(topMessage) && topMessage > 0 ? topMessage : null;
  }

  getTopicTopMessageId(topic: unknown = {}): number | null {
    const source = getRecord(topic);
    const topMessage = Number(source.topMessage);
    if (Number.isInteger(topMessage) && topMessage > 0) {
      return topMessage;
    }

    return this.getTopicThreadId(topic);
  }

  async listForumTopics(client: TelegramRuntimeClient, target: unknown = {}, query: unknown = ""): Promise<UnknownRecord[]> {
    const channel = await this.getInputChannel(client, target);
    const response = await client.invoke(new Api.channels.GetForumTopics({
      channel,
      q: normalizeText(query) || undefined,
      offsetDate: 0,
      offsetId: 0,
      offsetTopic: 0,
      limit: 100
    }));

    return Array.isArray(response.topics) ? response.topics.filter(isRecord) : [];
  }

  async findForumTopic(client: TelegramRuntimeClient, target: unknown = {}): Promise<UnknownRecord | null> {
    const normalizedTarget = normalizeTarget(target);
    const title = normalizeTopicTitle(normalizedTarget.topicTitle);
    if (!title) {
      return null;
    }

    const topics = await this.listForumTopics(client, normalizedTarget, normalizedTarget.topicTitle);
    return topics.find((topic) => normalizeTopicTitle(topic.title) === title) || null;
  }

  async resolveProjectTopic(client: TelegramRuntimeClient, target: unknown = {}): Promise<TelegramTarget> {
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
        topicTitle: normalizeText(existing.title) || normalizedTarget.topicTitle
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
      topicTitle: normalizeText(getRecord(created).title) || normalizedTarget.topicTitle
    };
  }

  async resolveProjectTopicWithoutStoredThread(client: TelegramRuntimeClient, target: unknown = {}): Promise<TelegramTarget> {
    return this.resolveProjectTopic(client, {
      ...normalizeTarget(target),
      threadId: ""
    });
  }

  getMessageOptions(target: unknown = {}): { replyTo?: number; topMsgId?: number } {
    const threadId = normalizeThreadId(getRecord(target).threadId);
    return threadId ? { replyTo: threadId, topMsgId: threadId } : {};
  }

  async getTopicMessages(client: TelegramRuntimeClient, target: unknown = {}, threadId: number): Promise<UnknownRecord[]> {
    const normalizedTarget = normalizeTarget(target);
    const topicIds = new Set([
      threadId,
      normalizeThreadId(normalizedTarget.topicTopMessageId)
    ].filter(Boolean));
    const messages = await client.getMessages(this.getPeerValue(normalizedTarget), {
      limit: TOPIC_HISTORY_SCAN_LIMIT
    });

    return messages
      .filter((message) => getMessageTopicIds(message).some((id) => topicIds.has(id)))
      .slice(0, MESSAGE_LIMIT);
  }

  async listMessages(target: unknown = {}, globalConfig: unknown = {}) {
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
      const params: UnknownRecord = { limit: MESSAGE_LIMIT };
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

  async sendMessage(target: unknown = {}, text: unknown = "", globalConfig: unknown = {}) {
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

export {
  TelegramService,
  addTopicMetadataPrefix,
  getTopicMetadataPrefix,
  normalizeTarget
};
