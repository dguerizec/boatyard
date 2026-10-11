export type ShareChatInput = { text: string; image?: string; requestId: string };
export type ShareChatMessage = { id: string; authorId: string; author: string; createdAt: string; text: string; requestId: string; image?: { mime: string; bytes: number } };
export type ShareChatSession = { id: string; startedAt: string; endedAt: string | null; count: number };
export type ShareChatSnapshot = { activeId: string | null; session: ShareChatSession | null; messages: ShareChatMessage[]; sessions?: ShareChatSession[] };
