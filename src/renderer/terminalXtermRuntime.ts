import type { AppTheme } from "./themeController.js";

type TerminalRuntimeGlobal = {
  Terminal?: XtermGlobal;
  FitAddon?: FitAddonGlobal;
};

const DARK_TERMINAL_THEME: XtermTheme = {
  background: "#101521",
  foreground: "#e7eaf4",
  cursor: "#a6b2ff",
  cursorAccent: "#101521",
  selectionBackground: "rgba(166, 178, 255, 0.3)",
  black: "#111520",
  red: "#e06c75",
  green: "#41b883",
  yellow: "#e5c07b",
  blue: "#61afef",
  magenta: "#c678dd",
  cyan: "#56b6c2",
  white: "#e7eaf4",
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
  foreground: "#252a40",
  cursor: "#5364b7",
  cursorAccent: "#ffffff",
  selectionBackground: "rgba(83, 100, 183, 0.24)",
  black: "#252a40",
  red: "#b3263b",
  green: "#147a52",
  yellow: "#8a5d00",
  blue: "#175fa5",
  magenta: "#8a4a9c",
  cyan: "#087a85",
  white: "#59627d",
  brightBlack: "#626d87",
  brightRed: "#d13c50",
  brightGreen: "#1b8f61",
  brightYellow: "#a66f00",
  brightBlue: "#2878c7",
  brightMagenta: "#a25db3",
  brightCyan: "#14939e",
  brightWhite: "#252a40"
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
