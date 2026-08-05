import type { AppTheme } from "./themeController.js";

type TerminalRuntimeGlobal = {
  Terminal?: XtermGlobal;
  FitAddon?: FitAddonGlobal;
};

const DARK_TERMINAL_THEME: XtermTheme = {
  background: "#080c11",
  foreground: "#d7dde5",
  cursor: "#41b883",
  cursorAccent: "#080c11",
  selectionBackground: "rgba(65, 184, 131, 0.3)",
  black: "#101418",
  red: "#e06c75",
  green: "#41b883",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#d7dde5",
  brightBlack: "#65717c",
  brightRed: "#f07c85",
  brightGreen: "#5bc995",
  brightYellow: "#f0cf8a",
  brightBlue: "#78baf2",
  brightMagenta: "#d58be8",
  brightCyan: "#70c5cf",
  brightWhite: "#f4f7fa"
};

const LIGHT_TERMINAL_THEME: XtermTheme = {
  background: "#ffffff",
  foreground: "#18201c",
  cursor: "#147a52",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(20, 122, 82, 0.24)",
  black: "#18201c",
  red: "#b3263b",
  green: "#147a52",
  yellow: "#8a5d00",
  blue: "#175fa5",
  magenta: "#8a4a9c",
  cyan: "#087a85",
  white: "#53635c",
  brightBlack: "#65756e",
  brightRed: "#d13c50",
  brightGreen: "#1b8f61",
  brightYellow: "#a66f00",
  brightBlue: "#2878c7",
  brightMagenta: "#a25db3",
  brightCyan: "#14939e",
  brightWhite: "#18201c"
};

export function getTerminalTheme(theme: AppTheme): XtermTheme {
  return {
    ...(theme === "light" ? LIGHT_TERMINAL_THEME : DARK_TERMINAL_THEME)
  };
}

export function applyTerminalTheme(term: XtermTerminal, theme: AppTheme) {
  term.options.theme = getTerminalTheme(theme);
}

export function getXtermConstructor(globalScope: TerminalRuntimeGlobal): XtermConstructor | null {
  const terminalGlobal = globalScope.Terminal;
  if (!terminalGlobal) {
    return null;
  }

  return ("Terminal" in terminalGlobal ? terminalGlobal.Terminal || null : terminalGlobal) as XtermConstructor | null;
}

export function getFitAddonConstructor(globalScope: TerminalRuntimeGlobal): FitAddonConstructor | null {
  const fitAddonGlobal = globalScope.FitAddon;
  if (!fitAddonGlobal) {
    return null;
  }

  return ("FitAddon" in fitAddonGlobal ? fitAddonGlobal.FitAddon || null : fitAddonGlobal) as FitAddonConstructor | null;
}

export function getTerminalFitSize(term: XtermTerminal, fitAddon: FitAddonInstance) {
  const dimensions = fitAddon.proposeDimensions();

  if (!dimensions) {
    return {
      cols: Math.max(20, term.cols || 80),
      rows: Math.max(5, term.rows || 24)
    };
  }

  return {
    cols: dimensions.cols,
    rows: dimensions.rows
  };
}

export function fitTerminal(term: XtermTerminal, fitAddon: FitAddonInstance) {
  const size = getTerminalFitSize(term, fitAddon);
  fitAddon.fit();
  return size;
}
