type TerminalRuntimeGlobal = {
  Terminal?: XtermGlobal;
  FitAddon?: FitAddonGlobal;
};

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
