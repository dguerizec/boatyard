import type { TerminalCard, TerminalTab } from "./terminalTypes.js";
import type { BoatyardBridge, RendererProject, RendererState } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

export type TerminalSurfacesBridge = BoatyardBridge & {
  attachTerminal(projectId: string, windowId: string, size: unknown): Promise<{
    tab: TerminalTab;
    terminalId: string;
  }>;
  closeTerminalTab(projectId: string, windowId: string): Promise<TerminalTab[]>;
  createTerminalTab(projectId: string, name: string): Promise<TerminalTab>;
  detachTerminal(terminalId: string): Promise<unknown>;
  listTerminalTabs(projectId: string): Promise<unknown>;
  readTerminalSelection: () => Promise<string>;
  renameTerminalTab(projectId: string, windowId: string, name: string): Promise<unknown>;
  resizeTerminal(terminalId: string, size: unknown): Promise<unknown> | unknown;
  updateTerminalSelection?: (
    projectId: string,
    surfaceKey: string,
    windowId: string
  ) => Promise<UnknownRecord>;
  updateTerminalTabOrder?: (projectId: string, windowIds: string[]) => Promise<unknown>;
  writeTerminal(terminalId: string, data: string): Promise<unknown> | unknown;
  writeTerminalSelection: (selection: string) => Promise<unknown>;
};

export type TerminalState = RendererState & {
  terminalSelections?: Record<string, Record<string, string>>;
  terminalTabOrders?: Record<string, string[]>;
};

export type TerminalSurfacesOptions = {
  boatyard: TerminalSurfacesBridge;
  getProjectById: (projectId?: string) => RendererProject | null;
  getState: () => TerminalState;
  createToolIcon: (name: string) => Node;
  clamp: (value: number, min: number, max: number) => number;
  defaultWidgetPaneId: string;
};

export type TerminalSurfaceSession = {
  activeWindowId: string;
  card: TerminalCard;
  disposables?: Array<{ dispose?: () => void }>;
  fitAddon?: FitAddonInstance;
  lastOutputTabSyncAt?: number;
  projectId: string;
  removeMiddleClickPaste?: () => void;
  resizeObserver?: ResizeObserver;
  surfaceId: string;
  tabsResizeObserver?: ResizeObserver;
  term?: XtermTerminal;
  terminalId?: string;
};

export type TerminalOutputSession = {
  lastOutputTabSyncAt: number;
  projectId: string;
  surfaceId: string;
  term: XtermTerminal;
};

export type TerminalTabSyncTimer = {
  followupsRemaining: number;
  timer: ReturnType<typeof setTimeout>;
};

export type TerminalCloseFocus = {
  surfaceId: string;
  timestamp: number;
  windowId: string;
};

export type TerminalSurfaceOptions = {
  actionsContainer?: HTMLElement | null;
  className?: string;
  storageKey?: string;
  tabsContainer?: HTMLElement | null;
  tagName?: keyof HTMLElementTagNameMap;
};

export type TerminalExitPayload = {
  projectId?: unknown;
  terminalId?: unknown;
  windowId?: unknown;
};

export type TerminalDataPayload = {
  data?: unknown;
  terminalId?: unknown;
};
