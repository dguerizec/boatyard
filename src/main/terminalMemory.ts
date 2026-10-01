import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { collectDescendantProcessIds } from "./linuxProcessResources.js";

const execFileAsync = promisify(execFile);
type ProcessMemoryRow = { pid: number; parentPid: number; rssBytes: number };

export function parseProcessMemoryRows(output: string): ProcessMemoryRow[] {
  return output.split("\n").flatMap((line) => {
    const fields = line.trim().split(/\s+/);
    if (fields.length !== 3) return [];
    const [pid, parentPid, rssKiB] = fields.map(Number);
    return Number.isInteger(pid) && pid > 0 && Number.isInteger(parentPid) && parentPid >= 0
      && Number.isFinite(rssKiB) && rssKiB >= 0
      ? [{ pid, parentPid, rssBytes: rssKiB * 1024 }]
      : [];
  });
}

export function getWindowMemoryBytes(panes: string, processes: ProcessMemoryRow[]): Map<string, number | null> {
  const rootsByWindow = new Map<string, number[]>();
  for (const line of panes.split("\n")) {
    const [windowId, pidText] = line.split("\t");
    const pid = Number(pidText);
    if (windowId && Number.isInteger(pid) && pid > 0) {
      rootsByWindow.set(windowId, [...(rootsByWindow.get(windowId) || []), pid]);
    }
  }
  const memoryByPid = new Map(processes.map((row) => [row.pid, row.rssBytes]));
  return new Map([...rootsByWindow].map(([windowId, roots]) => {
    if (roots.some((pid) => !memoryByPid.has(pid))) return [windowId, null];
    const pids = collectDescendantProcessIds(roots, processes);
    const bytes = [...pids].reduce((total, pid) => total + (memoryByPid.get(pid) || 0), 0);
    return [windowId, bytes];
  }));
}

// Share a short-lived process snapshot across projects and simultaneous tab requests.
export function createTerminalMemoryReader() {
  let snapshot: Promise<ProcessMemoryRow[]> | null = null;
  let sampledAt = 0;
  return async (panes: string): Promise<Map<string, number | null>> => {
    if (!snapshot || Date.now() - sampledAt >= 2000) {
      sampledAt = Date.now();
      snapshot = execFileAsync("ps", ["-A", "-o", "pid=,ppid=,rss="], {
        timeout: 3000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true
      }).then(({ stdout }) => parseProcessMemoryRows(stdout)).catch(() => []);
    }
    return getWindowMemoryBytes(panes, await snapshot);
  };
}
