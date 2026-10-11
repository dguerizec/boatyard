import type { ShareSidebarState } from "../shared/shareSidebar.js";
export type { ShareSidebarState, ShareTab } from "../shared/shareSidebar.js";

export function normalizeShareSidebarState(value: unknown): ShareSidebarState {
  const source = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    pinned: source.pinned === true,
    collapsed: source.collapsed === true,
    width: typeof source.width === "number" && Number.isFinite(source.width) ? Math.min(640, Math.max(300, source.width)) : 380,
    tab: source.tab === "chat" || source.tab === "setup" || source.tab === "projects" ? source.tab : "session"
  };
}
