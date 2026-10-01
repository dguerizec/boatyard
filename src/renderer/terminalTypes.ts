export type TerminalTab = {
  id: string;
  index?: number;
  name?: string;
  memoryBytes?: number | null;
};

export type TerminalWorktree = {
  branch?: string;
  detached?: boolean;
  name: string;
  path: string;
};

export type TerminalTabMenu = HTMLDivElement & {
  cleanup?: () => void;
};

export type TerminalCard = HTMLElement & {
  terminalTabsElement?: HTMLElement;
  terminalTabsScrollControls?: {
    tabs: HTMLElement;
    leftButton: HTMLButtonElement;
    rightButton: HTMLButtonElement;
  };
  terminalTabsResizeObserver?: ResizeObserver;
};
