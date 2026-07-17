const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { safeStorage } = require("electron");
const { Api, TelegramClient, utils } = require("telegram");
const { CustomFile } = require("telegram/client/uploads");
const { NewMessage } = require("telegram/events");
const { StringSession } = require("telegram/sessions");

const CLIENT_OPTIONS = {
  connectionRetries: 3
};
const LOGIN_WAIT_TIMEOUT_MS = 30000;
const MESSAGE_LIMIT = 50;
const TOPIC_HISTORY_SCAN_LIMIT = 500;
const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;
const MESSAGE_IMAGE_PREVIEW_CONCURRENCY = 4;
const MESSAGE_IMAGE_PREVIEW_THUMB_INDICES = [2, 1, 0];

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
  imagePreviewDataUrl?: string;
  isImage: boolean;
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
  downloadMedia(message: unknown, options?: UnknownRecord): Promise<Buffer | string | undefined>;
  invoke(request: unknown): Promise<UnknownRecord>;
  removeEventHandler(handler: TelegramEventHandler, builder: unknown): void;
  sendMessage(peer: unknown, options: UnknownRecord): Promise<UnknownRecord>;
  sendFile(peer: unknown, options: UnknownRecord): Promise<UnknownRecord>;
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

type TelegramImageUpload = {
  buffer: Buffer;
  name: string;
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

function getErrorCode(error: unknown): string {
  return isRecord(error) ? String(error.code || "") : "";
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function getImageExtension(mimeType: string): string {
  return {
    "image/gif": "gif",
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp"
  }[mimeType] || "png";
}

function normalizeImageName(value: unknown, mimeType: string): string {
  const name = normalizeText(value)
    .replace(/[\\/:*?"<>|\x00-\x1f]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 120);
  const extension = getImageExtension(mimeType);
  return name && new RegExp(`\\.${extension}$`, "i").test(name) ? name : `pasted-image.${extension}`;
}

function parsePastedImage(value: unknown): TelegramImageUpload | null {
  if (!isRecord(value)) {
    return null;
  }

  const dataUrl = normalizeText(value.dataUrl);
  const match = /^data:(image\/(?:gif|jpeg|png|webp));base64,([a-z0-9+/]+={0,2})$/i.exec(dataUrl);
  if (!match) {
    throw new Error("The pasted image format is not supported.");
  }

  const mimeType = match[1].toLowerCase();
  const buffer = Buffer.from(match[2], "base64");
  if (!buffer.length) {
    throw new Error("The pasted image is empty.");
  }
  if (buffer.length > MAX_PASTED_IMAGE_BYTES) {
    throw new Error("The pasted image exceeds the 20 MB limit.");
  }

  return {
    buffer,
    name: normalizeImageName(value.name, mimeType)
  };
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

function getTelegramImageMimeType(message: unknown = {}): string {
  const media = getRecord(getRecord(message).media);
  if (media.photo) {
    return "image/jpeg";
  }

  const mimeType = normalizeText(getRecord(media.document).mimeType).toLowerCase();
  return /^image\/(gif|jpeg|png|webp)$/.test(mimeType) ? mimeType : "";
}

function getImageDataUrl(value: unknown, mimeType: string, maxBytes: number): string {
  if (!Buffer.isBuffer(value) || !value.length || value.length > maxBytes) {
    return "";
  }

  return `data:${mimeType};base64,${value.toString("base64")}`;
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
  const isImage = Boolean(getTelegramImageMimeType(source));
  return {
    id: source.id,
    text: normalizeText(source.message),
    outgoing: source.out === true,
    senderName: getSenderName(source),
    sentAt: formatMessageDate(source.date),
    hasMedia: Boolean(source.media),
    isImage
  };
}

async function mapMessageWithImagePreview(client: TelegramRuntimeClient, message: unknown = {}): Promise<TelegramMappedMessage> {
  const mapped = mapMessage(message);
  const mimeType = getTelegramImageMimeType(message);
  if (!mimeType) {
    return mapped;
  }

  for (const thumb of MESSAGE_IMAGE_PREVIEW_THUMB_INDICES) {
    try {
      const preview = await client.downloadMedia(message, { thumb });
      const imagePreviewDataUrl = getImageDataUrl(preview, "image/jpeg", MAX_MESSAGE_IMAGE_PREVIEW_BYTES);
      if (imagePreviewDataUrl) {
        return { ...mapped, imagePreviewDataUrl };
      }
    } catch {
      continue;
    }
  }

  return mapped;
}

async function mapMessagesWithImagePreviews(client: TelegramRuntimeClient, messages: unknown[]): Promise<TelegramMappedMessage[]> {
  const mapped = new Array<TelegramMappedMessage>(messages.length);
  let nextIndex = 0;
  const worker = async () => {
    while (nextIndex < messages.length) {
      const index = nextIndex;
      nextIndex += 1;
      mapped[index] = await mapMessageWithImagePreview(client, messages[index]);
    }
  };

  await Promise.all(Array.from({ length: Math.min(MESSAGE_IMAGE_PREVIEW_CONCURRENCY, messages.length) }, worker));
  return mapped;
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
      if (getErrorCode(error) === "ENOENT") {
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
      if (getErrorCode(error) !== "ENOENT") {
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
        messages: await mapMessagesWithImagePreviews(client, [...messages].reverse())
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

  async sendMessage(target: unknown = {}, text: unknown = "", globalConfig: unknown = {}, image: unknown = null) {
    const message = normalizeText(text);
    const pastedImage = parsePastedImage(image);
    if (!message && !pastedImage) {
      throw new Error("Message or image is required.");
    }

    const normalizedTarget = normalizeTarget(target);
    const client = await this.getAuthorizedClient(globalConfig);
    const resolvedTarget = await this.resolveProjectTopic(client, normalizedTarget);
    const messageWithMetadata = message ? addTopicMetadataPrefix(message, resolvedTarget) : "";
    const sentMessage = pastedImage
      ? await client.sendFile(this.getPeerValue(resolvedTarget), {
        file: new CustomFile(pastedImage.name, pastedImage.buffer.length, "", pastedImage.buffer),
        caption: messageWithMetadata,
        ...this.getMessageOptions(resolvedTarget)
      })
      : await client.sendMessage(this.getPeerValue(resolvedTarget), {
        message: messageWithMetadata,
        ...this.getMessageOptions(resolvedTarget)
      });

    return {
      sent: true,
      message: mapMessage(sentMessage),
      target: resolvedTarget
    };
  }

  async getMessageImage(target: unknown = {}, messageId: unknown, globalConfig: unknown = {}) {
    const id = Number(normalizeText(messageId));
    if (!Number.isInteger(id) || id <= 0) {
      throw new Error("Telegram message id is invalid.");
    }

    const normalizedTarget = normalizeTarget(target);
    const client = await this.getAuthorizedClient(globalConfig);
    const resolvedTarget = await this.resolveProjectTopic(client, normalizedTarget);
    const [message] = await client.getMessages(this.getPeerValue(resolvedTarget), { ids: id });
    if (!message || !getTelegramImageMimeType(message)) {
      throw new Error("Telegram message does not contain a supported image.");
    }

    const topicIds = new Set([
      normalizeThreadId(resolvedTarget.threadId),
      normalizeThreadId(resolvedTarget.topicTopMessageId)
    ].filter((value): value is number => value !== null));
    if (topicIds.size && !getMessageTopicIds(message).some((topicId) => topicIds.has(topicId))) {
      throw new Error("Telegram image does not belong to this project topic.");
    }

    const image = await client.downloadMedia(message);
    const dataUrl = getImageDataUrl(image, getTelegramImageMimeType(message), MAX_MESSAGE_IMAGE_BYTES);
    if (!dataUrl) {
      throw new Error("Telegram image is unavailable or exceeds the 20 MB limit.");
    }

    return { dataUrl };
  }
}

export {
  TelegramService,
  addTopicMetadataPrefix,
  getTopicMetadataPrefix,
  getTelegramImageMimeType,
  normalizeTarget,
  parsePastedImage
};
