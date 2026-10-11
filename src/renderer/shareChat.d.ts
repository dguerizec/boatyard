import type { ShareChatInput, ShareChatSnapshot } from '../shared/shareChat.js';
export type ShareChatAdapter = {
  read(id?: string): Promise<ShareChatSnapshot>;
  send(id: string, input: ShareChatInput): Promise<unknown>;
  delete?(id: string, messageId: string): Promise<void>;
  image(id: string, messageId: string): Promise<string> | string;
  subscribe(callback: () => void): (() => void) | undefined;
  unread?(count: number): void;
  openLink?(url: string): void;
};
export function createShareChat(root: HTMLElement, adapter: ShareChatAdapter): { refresh(): Promise<void>; setVisible(value: boolean): void; dispose(): void };
