type TerminalSelectionBoatyardApi = {
  readTerminalSelection: () => Promise<string>;
  writeTerminal: (terminalId: string, data: string) => unknown;
  writeTerminalSelection: (selection: string) => Promise<unknown>;
};

type TerminalSelectionSession = {
  terminalId?: string;
  term?: XtermTerminal;
};

type TerminalSelectionBridgeOptions = {
  boatyard: TerminalSelectionBoatyardApi;
  getSession: () => TerminalSelectionSession | undefined;
  scheduleTerminalTabSync: (terminalId: string, followupsRemaining?: number) => void;
  term: XtermTerminal;
  viewport: HTMLElement;
};

export function createTerminalSelectionBridge({
  boatyard,
  getSession,
  scheduleTerminalTabSync,
  term,
  viewport
}: TerminalSelectionBridgeOptions) {
  let selectionTimer: ReturnType<typeof setTimeout> | null = null;
  let lastMiddlePaste = {
    text: "",
    time: 0
  };
  let suppressNativePasteUntil = 0;

  const publishTerminalSelection = (delay = 0) => {
    if (selectionTimer) {
      clearTimeout(selectionTimer);
    }
    selectionTimer = setTimeout(() => {
      const selection = term.getSelection();
      if (selection) {
        boatyard.writeTerminalSelection(selection).catch((error) => {
          console.error("Could not write terminal selection:", error);
        });
      }
    }, delay);
  };

  const selectionDisposable = term.onSelectionChange(() => {
    publishTerminalSelection(60);
  });

  const onLeftMouseUpSelection = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }

    publishTerminalSelection(0);
  };

  const onLeftMouseDownSelection = (event: MouseEvent) => {
    if (event.button !== 0 || event.shiftKey || term.modes.mouseTrackingMode === "none") {
      return;
    }

    try {
      Object.defineProperty(event, "shiftKey", {
        configurable: true,
        value: true
      });
    } catch (error) {
      console.error("Could not force terminal selection mode:", error);
    }
  };

  const onMiddleMouseDownPaste = (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
    suppressNativePasteUntil = Date.now() + 300;
    term.focus();
    boatyard.readTerminalSelection()
      .then((selection) => {
        if (!selection) {
          return;
        }

        const session = getSession();
        if (!session?.terminalId) {
          return;
        }

        const now = Date.now();
        if (selection === lastMiddlePaste.text && now - lastMiddlePaste.time < 150) {
          return;
        }

        lastMiddlePaste = {
          text: selection,
          time: now
        };
        session.term?.focus();
        boatyard.writeTerminal(session.terminalId, selection);
        scheduleTerminalTabSync(session.terminalId, /[\x04\r\n]/.test(selection) ? 3 : 0);
      })
      .catch((error) => {
        console.error("Could not read terminal selection:", error);
      });
  };

  const onMiddleAuxClick = (event: MouseEvent) => {
    if (event.button !== 1) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };

  const onNativePaste = (event: ClipboardEvent) => {
    if (Date.now() > suppressNativePasteUntil) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") {
      event.stopImmediatePropagation();
    }
  };

  document.addEventListener("mouseup", onLeftMouseUpSelection, true);
  viewport.addEventListener("mousedown", onLeftMouseDownSelection, true);
  viewport.addEventListener("mousedown", onMiddleMouseDownPaste, true);
  viewport.addEventListener("auxclick", onMiddleAuxClick, true);
  viewport.addEventListener("paste", onNativePaste, true);

  return Object.freeze({
    disposables: [
      selectionDisposable,
      {
        dispose: () => {
          if (selectionTimer) {
            clearTimeout(selectionTimer);
          }
        }
      }
    ],
    removeEventListeners() {
      document.removeEventListener("mouseup", onLeftMouseUpSelection, true);
      viewport.removeEventListener("mousedown", onLeftMouseDownSelection, true);
      viewport.removeEventListener("mousedown", onMiddleMouseDownPaste, true);
      viewport.removeEventListener("auxclick", onMiddleAuxClick, true);
      viewport.removeEventListener("paste", onNativePaste, true);
    }
  });
}
