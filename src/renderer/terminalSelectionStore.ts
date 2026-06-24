import type { UnknownRecord } from "./rendererRecords.js";
import type { TerminalState, TerminalSurfacesBridge } from "./terminalSurfaceTypes.js";

type TerminalSelectionStoreOptions = {
  boatyard: Pick<TerminalSurfacesBridge, "updateTerminalSelection">;
  getState: () => TerminalState;
};

export function createTerminalSelectionStore({ boatyard, getState }: TerminalSelectionStoreOptions) {
  function getPersistedTerminalWindowId(projectId: string | undefined, surfaceKey: string | undefined) {
    if (!projectId || !surfaceKey) {
      return null;
    }

    return getState().terminalSelections?.[projectId]?.[surfaceKey] || null;
  }

  function rememberTerminalSelection(projectId: unknown, surfaceKey: unknown, windowId: unknown) {
    const normalizedProjectId = String(projectId || "").trim();
    const normalizedSurfaceKey = String(surfaceKey || "").trim();
    const normalizedWindowId = String(windowId || "").trim();
    if (!normalizedProjectId || !normalizedSurfaceKey) {
      return;
    }

    const terminalSelections = {
      ...(getState().terminalSelections || {})
    };
    getState().terminalSelections = terminalSelections;

    if (!normalizedWindowId) {
      const projectSelections = terminalSelections[normalizedProjectId];
      if (projectSelections) {
        delete projectSelections[normalizedSurfaceKey];
        if (!Object.keys(projectSelections).length) {
          delete terminalSelections[normalizedProjectId];
        }
      }
      return;
    }

    terminalSelections[normalizedProjectId] = {
      ...(terminalSelections[normalizedProjectId] || {}),
      [normalizedSurfaceKey]: normalizedWindowId
    };
  }

  function persistTerminalSelection(projectId: unknown, surfaceKey: unknown, windowId: unknown) {
    if (!surfaceKey || !boatyard.updateTerminalSelection) {
      return;
    }

    rememberTerminalSelection(projectId, surfaceKey, windowId);

    const normalizedProjectId = String(projectId || "").trim();
    const normalizedSurfaceKey = String(surfaceKey || "").trim();
    const normalizedWindowId = String(windowId || "").trim();
    boatyard.updateTerminalSelection(normalizedProjectId, normalizedSurfaceKey, normalizedWindowId)
      .then((selections: UnknownRecord) => {
        if (!selections || typeof selections !== "object" || Array.isArray(selections)) {
          return;
        }

        const terminalSelections = {
          ...(getState().terminalSelections || {})
        };
        getState().terminalSelections = terminalSelections;
        if (Object.keys(selections).length) {
          terminalSelections[normalizedProjectId] = selections as Record<string, string>;
        } else {
          delete terminalSelections[normalizedProjectId];
        }
      })
      .catch((error: unknown) => {
        console.error("Could not persist terminal selection:", error);
      });
  }

  return Object.freeze({
    getPersistedTerminalWindowId,
    persistTerminalSelection,
    rememberTerminalSelection
  });
}
