const fs = require("node:fs");
const path = require("node:path");
const { EventEmitter } = require("node:events");
const { safeStorage } = require("electron");

const LOGIN_WAIT_TIMEOUT_MS = 30000;
const MESSAGE_LIMIT = 50;
const TOPIC_HISTORY_SCAN_LIMIT = 500;
const MAX_PASTED_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_MESSAGE_IMAGE_PREVIEW_BYTES = 2 * 1024 * 1024;
const MESSAGE_IMAGE_PREVIEW_CONCURRENCY = 4;
const GRAMJS_SESSION_VERSION = "1";

type UnknownRecord = Record<string, unknown>;
type MtcuteModule = typeof import("@mtcute/node");

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

type TelegramEventHandler = (message: unknown) => void;

type TelegramRuntimeClient = {
  connect(): Promise<void>;
  createForumTopic(params: UnknownRecord): Promise<UnknownRecord>;
  destroy(): Promise<void>;
  downloadAsBuffer(location: unknown, options?: UnknownRecord): Promise<Uint8Array>;
  exportSession(): Promise<string>;
  getForumTopics(peer: unknown, options: UnknownRecord): Promise<UnknownRecord[]>;
  getForumTopicsById(peer: unknown, ids: number[]): Promise<(UnknownRecord | null)[]>;
  getHistory(peer: unknown, options: UnknownRecord): Promise<UnknownRecord[]>;
  getMe(): Promise<UnknownRecord>;
  getMessages(peer: unknown, ids: number[]): Promise<(UnknownRecord | null)[]>;
  importSession(session: string | MtcuteSessionData, force?: boolean): Promise<void>;
  isConnected: boolean;
  notifyLoggedIn(user: unknown): Promise<unknown>;
  onNewMessage: {
    add(handler: TelegramEventHandler): void;
    remove(handler: TelegramEventHandler): void;
  };
  prepare(): Promise<void>;
  sendMedia(peer: unknown, media: UnknownRecord, options: UnknownRecord): Promise<UnknownRecord>;
  sendText(peer: unknown, text: string, options: UnknownRecord): Promise<UnknownRecord>;
  start(options: {
    code(): Promise<string>;
    codeSentCallback(code: UnknownRecord): void;
    invalidCodeCallback(type: "code" | "password"): void;
    password(): Promise<string>;
    phone: string;
  }): Promise<UnknownRecord>;
};

type TelegramImageUpload = {
  buffer: Buffer;
  mimeType: string;
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

type MtcuteDc = {
  id: number;
  ipAddress: string;
  port: number;
};

type MtcuteSessionData = {
  authKey: Uint8Array;
  primaryDcs: {
    main: MtcuteDc;
    media: MtcuteDc;
  };
};

let mtcuteModulePromise: Promise<MtcuteModule> | null = null;

function loadMtcute(): Promise<MtcuteModule> {
  mtcuteModulePromise ||= import("@mtcute/node");
  return mtcuteModulePromise;
}

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
    mimeType,
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
  const replyTo = getRecord(source.replyToMessage);
  return [
    source.id,
    replyTo.threadId,
    replyTo.id
  ]
    .map((value) => Number(value))
    .filter((value) => Number.isInteger(value) && value > 0);
}

function getMessageChatId(message: unknown = {}): string {
  const chat = getRecord(getRecord(message).chat);
  return normalizeText(chat.id);
}

function getTelegramImageMimeType(message: unknown = {}): string {
  const media = getRecord(getRecord(message).media);
  if (media.type === "photo") {
    return "image/jpeg";
  }

  const mimeType = normalizeText(media.mimeType).toLowerCase();
  return /^image\/(gif|jpeg|png|webp)$/.test(mimeType) ? mimeType : "";
}

function getImageDataUrl(value: unknown, mimeType: string, maxBytes: number): string {
  if (!ArrayBuffer.isView(value)) {
    return "";
  }

  const buffer = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!buffer.length || buffer.length > maxBytes) {
    return "";
  }

  return `data:${mimeType};base64,${buffer.toString("base64")}`;
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

function getTelegramErrorText(error: unknown): string {
  const source = getRecord(error);
  return normalizeText(source.text || source.errorMessage || source.message);
}

function serializeError(error: unknown): string {
  return getTelegramErrorText(error) || "Telegram request failed.";
}

function isUnauthorizedError(error: unknown): boolean {
  return /AUTH_KEY_UNREGISTERED|SESSION_EXPIRED|SESSION_REVOKED|USER_DEACTIVATED/i.test(
    getTelegramErrorText(error)
  );
}

function formatMessageDate(value: unknown): string {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }

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
    sender.displayName ||
    [sender.firstName, sender.lastName].map(normalizeText).filter(Boolean).join(" ") ||
    sender.id
  );
}

function renderRichText(value: unknown): string {
  const source = getRecord(value);
  const type = normalizeText(source._);
  if (!type || type === "textEmpty" || type === "textImage") {
    return "";
  }
  if (type === "textPlain") {
    return String(source.text || "");
  }
  if (type === "textMath") {
    return String(source.source || "");
  }
  if (type === "textCustomEmoji") {
    return String(source.alt || "");
  }
  if (type === "textConcat") {
    return Array.isArray(source.texts) ? source.texts.map(renderRichText).join("") : "";
  }
  return renderRichText(source.text);
}

function renderPageCaption(value: unknown): string {
  const caption = getRecord(value);
  return [renderRichText(caption.text), renderRichText(caption.credit)]
    .map(normalizeText)
    .filter(Boolean)
    .join("\n");
}

function renderPageListItem(value: unknown, prefix: string): string {
  const item = getRecord(value);
  const content = item.text
    ? renderRichText(item.text)
    : renderPageBlocks(Array.isArray(item.blocks) ? item.blocks : []);
  const checkbox = item.checkbox === true ? `[${item.checked === true ? "x" : " "}] ` : "";
  return content
    .split("\n")
    .map((line, index) => `${index === 0 ? `${prefix}${checkbox}` : "  "}${line}`)
    .join("\n");
}

function renderPageBlock(value: unknown): string {
  const block = getRecord(value);
  const type = normalizeText(block._);

  switch (type) {
    case "pageBlockUnsupported":
    case "pageBlockDivider":
    case "pageBlockAnchor":
      return "";
    case "pageBlockList":
      return Array.isArray(block.items)
        ? block.items.map((item) => renderPageListItem(item, "- ")).join("\n")
        : "";
    case "pageBlockOrderedList":
      return Array.isArray(block.items)
        ? block.items.map((item, index) => {
          const source = getRecord(item);
          return renderPageListItem(item, `${normalizeText(source.num) || index + 1}. `);
        }).join("\n")
        : "";
    case "pageBlockTable": {
      const title = renderRichText(block.title);
      const rows = Array.isArray(block.rows)
        ? block.rows.map((row) => {
          const cells = getRecord(row).cells;
          return Array.isArray(cells)
            ? cells.map((cell) => renderRichText(getRecord(cell).text)).join(" | ")
            : "";
        }).filter(Boolean)
        : [];
      return [title, ...rows].map(normalizeText).filter(Boolean).join("\n");
    }
    case "pageBlockBlockquote":
    case "pageBlockPullquote": {
      const quote = renderRichText(block.text);
      const caption = renderRichText(block.caption);
      return [quote && quote.split("\n").map((line) => `> ${line}`).join("\n"), caption]
        .map(normalizeText)
        .filter(Boolean)
        .join("\n");
    }
    case "pageBlockCover":
      return renderPageBlock(block.cover);
    case "pageBlockDetails":
      return [
        renderRichText(block.title),
        renderPageBlocks(Array.isArray(block.blocks) ? block.blocks : [])
      ].map(normalizeText).filter(Boolean).join("\n");
    case "pageBlockEmbedPost":
      return [
        normalizeText(block.author),
        renderPageBlocks(Array.isArray(block.blocks) ? block.blocks : []),
        renderPageCaption(block.caption)
      ].filter(Boolean).join("\n");
    case "pageBlockCollage":
    case "pageBlockSlideshow":
      return [
        renderPageBlocks(Array.isArray(block.items) ? block.items : []),
        renderPageCaption(block.caption)
      ].map(normalizeText).filter(Boolean).join("\n");
    case "pageBlockPhoto":
    case "pageBlockVideo":
    case "pageBlockAudio":
    case "pageBlockEmbed":
    case "pageBlockMap":
      return renderPageCaption(block.caption);
    case "pageBlockMath":
      return normalizeText(block.source);
    case "pageBlockBlockquoteBlocks":
      return [
        renderPageBlocks(Array.isArray(block.blocks) ? block.blocks : []),
        renderPageCaption(block.caption)
      ].map(normalizeText).filter(Boolean).join("\n");
    default:
      return renderRichText(block.text);
  }
}

function renderPageBlocks(blocks: unknown[]): string {
  return blocks.map(renderPageBlock).map(normalizeText).filter(Boolean).join("\n");
}

function renderRichMessageText(message: unknown = {}): string {
  const richMessage = getRecord(getRecord(message).richMessage);
  return renderPageBlocks(Array.isArray(richMessage.blocks) ? richMessage.blocks : []);
}

function getMessageText(message: unknown = {}): string {
  const source = getRecord(message);
  return normalizeText(source.text) || renderRichMessageText(source);
}

function mapMessage(message: unknown = {}): TelegramMappedMessage {
  const source = getRecord(message);
  const isImage = Boolean(getTelegramImageMimeType(source));
  return {
    id: source.id,
    text: getMessageText(source),
    outgoing: source.isOutgoing === true,
    senderName: getSenderName(source),
    sentAt: formatMessageDate(source.date),
    hasMedia: Boolean(source.media),
    isImage
  };
}

function getMessageMedia(message: unknown = {}): UnknownRecord {
  return getRecord(getRecord(message).media);
}

function getPreviewLocations(message: unknown = {}): unknown[] {
  const media = getMessageMedia(message);
  const thumbnails = Array.isArray(media.thumbnails) ? [...media.thumbnails] : [];
  return thumbnails
    .filter((thumbnail) => {
      const source = getRecord(thumbnail);
      return Number.isFinite(Number(source.width)) && Number.isFinite(Number(source.height));
    })
    .sort((left, right) => {
      const leftRecord = getRecord(left);
      const rightRecord = getRecord(right);
      return Number(rightRecord.width) * Number(rightRecord.height) -
        Number(leftRecord.width) * Number(leftRecord.height);
    });
}

async function mapMessageWithImagePreview(client: TelegramRuntimeClient, message: unknown = {}): Promise<TelegramMappedMessage> {
  const mapped = mapMessage(message);
  const mimeType = getTelegramImageMimeType(message);
  if (!mimeType) {
    return mapped;
  }

  for (const location of getPreviewLocations(message)) {
    try {
      const preview = await client.downloadAsBuffer(location);
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

function parseGramJsSession(sessionString: string): MtcuteSessionData {
  if (!sessionString.startsWith(GRAMJS_SESSION_VERSION)) {
    throw new Error("Unsupported GramJS session version.");
  }

  const encoded = sessionString.slice(1);
  const payload = Buffer.from(encoded, "base64");
  if (payload.length < 1 + 2 + 1 + 2 + 256) {
    throw new Error("The stored GramJS session is invalid.");
  }

  let offset = 0;
  const dcId = payload.readUInt8(offset);
  offset += 1;
  let ipAddress = "";

  if (encoded.length === 352) {
    ipAddress = [...payload.subarray(offset, offset + 4)].join(".");
    offset += 4;
  } else {
    const addressLength = payload.readInt16BE(offset);
    offset += 2;
    if (addressLength <= 0 || addressLength > 100 || offset + addressLength + 2 > payload.length) {
      throw new Error("The stored GramJS datacenter address is invalid.");
    }
    ipAddress = payload.subarray(offset, offset + addressLength).toString("utf8");
    offset += addressLength;
  }

  const port = payload.readInt16BE(offset);
  offset += 2;
  const authKey = payload.subarray(offset);
  if (!dcId || !ipAddress || port <= 0 || authKey.length !== 256) {
    throw new Error("The stored GramJS session is incomplete.");
  }

  const primaryDc = { id: dcId, ipAddress, port };
  return {
    authKey: Uint8Array.from(authKey),
    primaryDcs: {
      main: primaryDc,
      media: primaryDc
    }
  };
}

function isGramJsSession(sessionString: string): boolean {
  return sessionString.startsWith(GRAMJS_SESSION_VERSION);
}

class TelegramService extends EventEmitter {
  client: TelegramRuntimeClient | null;
  clientKey: string;
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

    fs.mkdirSync(path.dirname(this.sessionFilePath), { recursive: true, mode: 0o700 });
    fs.writeFileSync(
      this.sessionFilePath,
      `${JSON.stringify({
        encryptedSession: safeStorage.encryptString(sessionString).toString("base64"),
        sessionFormat: "mtcute-v3",
        updatedAt: new Date().toISOString()
      }, null, 2)}\n`,
      { mode: 0o600 }
    );
  }

  async clearSession(): Promise<void> {
    try {
      fs.unlinkSync(this.sessionFilePath);
    } catch (error: unknown) {
      if (getErrorCode(error) !== "ENOENT") {
        throw error;
      }
    }
    this.detachMessageEventHandler();
    const client = this.client;
    this.client = null;
    this.clientKey = "";
    this.pendingLogin = null;
    if (client) {
      await client.destroy().catch(() => {});
    }
  }

  detachMessageEventHandler(): void {
    if (!this.messageEventClient || !this.messageEventHandler) {
      return;
    }

    this.messageEventClient.onNewMessage.remove(this.messageEventHandler);
    this.messageEventClient = null;
    this.messageEventHandler = null;
  }

  attachMessageEventHandler(client: TelegramRuntimeClient): void {
    if (this.messageEventClient === client) {
      return;
    }

    this.detachMessageEventHandler();
    const handler: TelegramEventHandler = (message) => {
      if (!isRecord(message)) {
        return;
      }

      this.emit("message", {
        chatId: getMessageChatId(message),
        topicIds: getMessageTopicIds(message).map(String),
        message: mapMessage(message)
      });
    };

    client.onNewMessage.add(handler);
    this.messageEventClient = client;
    this.messageEventHandler = handler;
  }

  getClientKey(credentials: TelegramCredentials): string {
    return `${credentials.apiId}:${credentials.apiHash}`;
  }

  async getClient(credentials: TelegramCredentials): Promise<TelegramRuntimeClient> {
    const key = this.getClientKey(credentials);
    if (this.client && this.clientKey === key) {
      if (!this.client.isConnected) {
        await this.client.connect();
      }
      return this.client;
    }

    if (this.client) {
      this.detachMessageEventHandler();
      await this.client.destroy().catch(() => {});
      this.client = null;
      this.clientKey = "";
    }

    const mtcute = await loadMtcute();
    const client = new mtcute.TelegramClient({
      apiId: credentials.apiId,
      apiHash: credentials.apiHash,
      storage: new mtcute.MemoryStorage()
    }) as unknown as TelegramRuntimeClient;
    const storedSession = this.getStoredSession();
    const migrateGramJsSession = isGramJsSession(storedSession);

    try {
      await client.prepare();
      if (storedSession) {
        await client.importSession(
          migrateGramJsSession ? parseGramJsSession(storedSession) : storedSession
        );
      }
      await client.connect();
      if (migrateGramJsSession) {
        const me = await client.getMe();
        await client.notifyLoggedIn(me.raw);
        this.saveSession(await client.exportSession());
      }
    } catch (error) {
      await client.destroy().catch(() => {});
      throw error;
    }

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
    try {
      await client.getMe();
    } catch (error) {
      if (isUnauthorizedError(error)) {
        throw new Error("Telegram user is not authenticated.");
      }
      throw error;
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
      const me = await client.getMe();
      return {
        state: "ready",
        summary: `Connected as ${me.username ? `@${me.username}` : normalizeText(me.displayName) || "Telegram user"}.`
      };
    } catch (error) {
      if (isUnauthorizedError(error)) {
        return {
          state: "notAuthenticated",
          summary: "Telegram user is not authenticated."
        };
      }
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
    try {
      await client.getMe();
      return {
        state: "ready",
        summary: "Telegram user is already authenticated."
      };
    } catch (error) {
      if (!isUnauthorizedError(error)) {
        throw error;
      }
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

    login.authPromise = client.start({
      phone: normalizedPhoneNumber,
      codeSentCallback: (sentCode) => {
        login.phase = "codeRequired";
        login.isCodeViaApp = sentCode.type === "app";
        login.summary = login.isCodeViaApp
          ? "Enter the code sent in Telegram."
          : "Enter the Telegram login code.";
      },
      code: async () => new Promise((resolve) => {
        login.codeResolve = resolve;
      }),
      password: async () => {
        login.phase = "passwordRequired";
        login.summary = "Enter the Telegram 2FA password.";
        return new Promise((resolve) => {
          login.passwordResolve = resolve;
        });
      },
      invalidCodeCallback: (type) => {
        login.phase = type === "code" ? "codeRequired" : "passwordRequired";
        login.summary = type === "code"
          ? "The Telegram login code is invalid. Try again."
          : "The Telegram 2FA password is invalid. Try again.";
      }
    }).then(async (user) => {
      this.saveSession(await client.exportSession());
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
      if (
        (login.phase === "codeRequired" && login.codeResolve) ||
        (login.phase === "passwordRequired" && login.passwordResolve)
      ) {
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

  getPeerValue(target: unknown = {}): string | number {
    const source = getRecord(target);
    const chatId = normalizeText(source.chatId);
    if (!chatId) {
      throw new Error("Project Telegram chat is not configured.");
    }

    if (chatId.startsWith("@")) {
      return chatId.slice(1);
    }

    if (/^-?\d+$/.test(chatId)) {
      const numericChatId = Number(chatId);
      if (!Number.isSafeInteger(numericChatId)) {
        throw new Error("Project Telegram chat ID exceeds the supported numeric range.");
      }
      return numericChatId;
    }

    return chatId;
  }

  getTopicThreadId(topic: unknown = {}): number | null {
    return normalizeThreadId(getRecord(topic).id);
  }

  getTopicTopMessageId(topic: unknown = {}): number | null {
    return this.getTopicThreadId(topic);
  }

  async listForumTopics(client: TelegramRuntimeClient, target: unknown = {}, query: unknown = ""): Promise<UnknownRecord[]> {
    const topics = await client.getForumTopics(this.getPeerValue(target), {
      query: normalizeText(query) || undefined,
      limit: 100
    });
    return Array.isArray(topics) ? topics.filter(isRecord) : [];
  }

  async findForumTopic(client: TelegramRuntimeClient, target: unknown = {}): Promise<UnknownRecord | null> {
    const normalizedTarget = normalizeTarget(target);
    const title = normalizeTopicTitle(normalizedTarget.topicTitle);
    const threadId = normalizeThreadId(normalizedTarget.threadId);

    if (threadId) {
      try {
        const [topic] = await client.getForumTopicsById(this.getPeerValue(normalizedTarget), [threadId]);
        if (topic && (!title || normalizeTopicTitle(topic.title) === title)) {
          return topic;
        }
      } catch {
        // Fall back to title lookup so stale stored thread IDs can self-heal.
      }
    }

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

    await client.createForumTopic({
      chatId: this.getPeerValue(normalizedTarget),
      title: normalizedTarget.topicTitle
    });

    const created = await this.findForumTopic(client, {
      ...normalizedTarget,
      threadId: ""
    });
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
      threadId: "",
      topicTopMessageId: ""
    });
  }

  getMessageOptions(target: unknown = {}): { threadId?: number } {
    const threadId = normalizeThreadId(getRecord(target).threadId);
    return threadId ? { threadId } : {};
  }

  async getTopicMessages(client: TelegramRuntimeClient, target: unknown = {}, threadId: number): Promise<UnknownRecord[]> {
    const messages = await client.getHistory(this.getPeerValue(target), {
      limit: TOPIC_HISTORY_SCAN_LIMIT
    });

    return messages
      .filter((message) => getMessageTopicIds(message).includes(threadId))
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
      const threadId = normalizeThreadId(resolvedTarget.threadId);

      let messages;
      try {
        messages = threadId
          ? await this.getTopicMessages(client, resolvedTarget, threadId)
          : await client.getHistory(this.getPeerValue(resolvedTarget), { limit: MESSAGE_LIMIT });
      } catch (error) {
        if (!/TOPIC_ID_INVALID/.test(getTelegramErrorText(error)) || !normalizeThreadId(normalizedTarget.threadId)) {
          throw error;
        }

        resolvedTarget = await this.resolveProjectTopicWithoutStoredThread(client, normalizedTarget);
        const retryThreadId = normalizeThreadId(resolvedTarget.threadId);
        messages = retryThreadId
          ? await this.getTopicMessages(client, resolvedTarget, retryThreadId)
          : await client.getHistory(this.getPeerValue(resolvedTarget), { limit: MESSAGE_LIMIT });
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
      ? await client.sendMedia(this.getPeerValue(resolvedTarget), {
        type: pastedImage.mimeType === "image/gif" ? "document" : "photo",
        file: pastedImage.buffer,
        fileName: pastedImage.name,
        fileMime: pastedImage.mimeType
      }, {
        caption: messageWithMetadata,
        ...this.getMessageOptions(resolvedTarget)
      })
      : await client.sendText(
        this.getPeerValue(resolvedTarget),
        messageWithMetadata,
        this.getMessageOptions(resolvedTarget)
      );

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
    const [message] = await client.getMessages(this.getPeerValue(resolvedTarget), [id]);
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

    const image = await client.downloadAsBuffer(getMessageMedia(message));
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
  mapMessage,
  normalizeTarget,
  parseGramJsSession,
  parsePastedImage,
  renderRichMessageText
};
