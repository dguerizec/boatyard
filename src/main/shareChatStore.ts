import { randomUUID } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync, renameSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { ShareChatInput, ShareChatMessage, ShareChatSession, ShareChatSnapshot } from "../shared/shareChat.js";

export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_SESSION_IMAGE_BYTES = 200 * 1024 * 1024;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
type Conversation = Omit<ShareChatSession, "count"> & { messages: ShareChatMessage[] };

/** Local archive authority, shared by the HTTP client and operator IPC. */
export class ShareChatStore {
  private readonly conversations = new Map<string, Conversation>();
  private readonly listeners = new Set<() => void>();
  activeId: string | null = null;
  constructor(private readonly directory: string) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const name of readdirSync(directory)) {
      if (!name.endsWith(".json") || !UUID.test(name.slice(0, -5))) continue;
      try {
        const conversation = JSON.parse(readFileSync(join(directory, name), "utf8")) as Conversation;
        if (conversation.id !== name.slice(0, -5) || typeof conversation.startedAt !== "string" || !Array.isArray(conversation.messages)
          || conversation.messages.some(message => !UUID.test(message.id) || typeof message.text !== "string" || typeof message.createdAt !== "string")) throw new Error("Invalid Share chat archive.");
        // A process exit also ends the sharing session; its archive remains readable.
        if (!conversation.endedAt) { conversation.endedAt = new Date().toISOString(); this.save(conversation); }
        this.conversations.set(conversation.id, conversation);
      } catch {
        console.warn(`Could not load Share chat archive ${name}. The original file has been preserved.`);
      }
    }
  }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  private save(conversation: Conversation) {
    const file = join(this.directory, `${conversation.id}.json`), temporary = `${file}.tmp`;
    writeFileSync(temporary, JSON.stringify(conversation) + "\n", { mode: 0o600 }); renameSync(temporary, file);
  }
  begin() {
    if (this.activeId) throw new Error("A Share chat is already active.");
    const conversation: Conversation = { id: randomUUID(), startedAt: new Date().toISOString(), endedAt: null, messages: [] };
    this.save(conversation); this.conversations.set(conversation.id, conversation); this.activeId = conversation.id; this.changed();
  }
  end() {
    const conversation = this.activeId ? this.get(this.activeId) : null;
    if (!conversation) return;
    const ended = { ...conversation, endedAt: new Date().toISOString() };
    this.save(ended); this.conversations.set(ended.id, ended); this.activeId = null; this.changed();
  }
  private get(id: string) {
    const conversation = this.conversations.get(id);
    if (!conversation) throw new Error("Conversation not found.");
    return conversation;
  }
  snapshot(id: string | null = this.activeId, archives = false): ShareChatSnapshot {
    const conversation = id ? this.get(id) : null;
    const summary = (value: Conversation): ShareChatSession => ({ id: value.id, startedAt: value.startedAt, endedAt: value.endedAt, count: value.messages.length });
    return { activeId: this.activeId, session: conversation ? summary(conversation) : null, messages: conversation ? structuredClone(conversation.messages) : [],
      ...(archives ? { sessions: [...this.conversations.values()].map(summary).sort((a, b) => b.startedAt.localeCompare(a.startedAt)) } : {}) };
  }
  send(id: string, authorId: string, author: string, value: unknown) {
    if (id !== this.activeId) throw new Error("This conversation has ended.");
    const conversation = this.get(id), input = value as ShareChatInput;
    if (!input || typeof input.text !== "string" || input.text.length > 8000 || typeof input.requestId !== "string" || !/^[\w-]{16,100}$/.test(input.requestId)) throw new Error("Invalid chat message.");
    const duplicate = conversation.messages.find(message => message.authorId === authorId && message.requestId === input.requestId);
    if (duplicate) return structuredClone(duplicate);
    if (conversation.messages.length >= 5000) throw new Error("This conversation has reached its message limit.");
    const message: ShareChatMessage = { id: randomUUID(), authorId, author, createdAt: new Date().toISOString(), text: input.text.trim(), requestId: input.requestId };
    let image: Buffer | undefined;
    if (input.image !== undefined) {
      if (typeof input.image !== "string" || input.image.length > MAX_CHAT_IMAGE_BYTES * 1.4 + 100) throw new Error("Images must be at most 5 MB.");
      const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(input.image);
      if (!match) throw new Error("Use a PNG, JPEG or WebP image.");
      image = Buffer.from(match[2], "base64");
      const mime = match[1];
      const valid = mime === "image/png" ? image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : mime === "image/jpeg" ? image[0] === 255 && image[1] === 216 && image[2] === 255
        : image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP";
      if (!valid || image.length > MAX_CHAT_IMAGE_BYTES) throw new Error("Invalid image or image larger than 5 MB.");
      if (conversation.messages.reduce((sum, value) => sum + (value.image?.bytes || 0), 0) + image.length > MAX_SESSION_IMAGE_BYTES) throw new Error("This conversation has reached its image storage limit.");
      message.image = { mime, bytes: image.length };
    }
    if (!message.text && !image) throw new Error("Write a message or paste an image.");
    const file = join(this.directory, `${message.id}.image`);
    if (image) writeFileSync(file, image, { mode: 0o600 });
    const updated = { ...conversation, messages: [...conversation.messages, message] };
    try { this.save(updated); } catch (error) { if (image) unlinkSync(file); throw error; }
    this.conversations.set(id, updated); this.changed(); return structuredClone(message);
  }
  delete(id: string, messageId: string) {
    const conversation = this.get(id), message = conversation.messages.find(value => value.id === messageId);
    if (!message) throw new Error("Message not found.");
    const updated = { ...conversation, messages: conversation.messages.filter(value => value.id !== messageId) };
    this.save(updated); this.conversations.set(id, updated);
    if (message.image) unlinkSync(join(this.directory, `${message.id}.image`));
    this.changed();
  }
  image(id: string, messageId: string) {
    const message = this.get(id).messages.find(value => value.id === messageId);
    if (!message?.image || !UUID.test(messageId)) throw new Error("Image not found.");
    return { mime: message.image.mime, bytes: readFileSync(join(this.directory, `${messageId}.image`)) };
  }
}
