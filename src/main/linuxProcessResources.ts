"use strict";

const fs = require("node:fs/promises");
const path = require("node:path");

type ProcessIdentity = { pid: number; parentPid: number };
type ProcessMemory = { pssBytes: number; rssBytes: number; swapPssBytes: number };
type ProcessSource = {
  list(): Promise<ProcessIdentity[]>;
  readMemory(pid: number): Promise<ProcessMemory>;
};

const EMPTY_PROCESS_MEMORY: ProcessMemory = Object.freeze({
  pssBytes: 0,
  rssBytes: 0,
  swapPssBytes: 0
});

function parseKilobyteField(text: string, field: string): number {
  const match = text.match(new RegExp(`^${field}:\\s+(\\d+)\\s+kB$`, "m"));
  return match ? Number(match[1]) * 1024 : 0;
}

function parseProcessMemory(text: string): ProcessMemory {
  return {
    pssBytes: parseKilobyteField(text, "Pss"),
    rssBytes: parseKilobyteField(text, "Rss"),
    swapPssBytes: parseKilobyteField(text, "SwapPss")
  };
}

function parseProcessStat(pid: number, text: string): ProcessIdentity | null {
  const commandEnd = text.lastIndexOf(")");
  if (commandEnd < 0) {
    return null;
  }
  const fields = text.slice(commandEnd + 1).trim().split(/\s+/);
  const parentPid = Number(fields[1]);
  return Number.isInteger(parentPid) ? { pid, parentPid } : null;
}

function createLinuxProcessSource(procRoot = "/proc"): ProcessSource {
  return {
    async list() {
      const entries = await fs.readdir(procRoot, { withFileTypes: true });
      const identities = await Promise.all(entries
        .filter((entry: { isDirectory(): boolean; name: string }) => entry.isDirectory() && /^\d+$/.test(entry.name))
        .map(async (entry: { name: string }) => {
          const pid = Number(entry.name);
          try {
            return parseProcessStat(pid, await fs.readFile(path.join(procRoot, entry.name, "stat"), "utf8"));
          } catch {
            return null;
          }
        }));
      return identities.filter((entry: ProcessIdentity | null): entry is ProcessIdentity => Boolean(entry));
    },
    async readMemory(pid) {
      try {
        return parseProcessMemory(await fs.readFile(path.join(procRoot, String(pid), "smaps_rollup"), "utf8"));
      } catch {
        try {
          const status = await fs.readFile(path.join(procRoot, String(pid), "status"), "utf8");
          return {
            pssBytes: 0,
            rssBytes: parseKilobyteField(status, "VmRSS"),
            swapPssBytes: 0
          };
        } catch {
          return { ...EMPTY_PROCESS_MEMORY };
        }
      }
    }
  };
}

function collectDescendantProcessIds(rootPids: Iterable<number>, identities: ProcessIdentity[]): Set<number> {
  const childrenByParent = new Map<number, number[]>();
  for (const { pid, parentPid } of identities) {
    childrenByParent.set(parentPid, [...(childrenByParent.get(parentPid) || []), pid]);
  }

  const processIds = new Set<number>();
  const pending = [...rootPids].filter((pid) => Number.isInteger(pid) && pid > 0);
  while (pending.length) {
    const pid = pending.pop() as number;
    if (processIds.has(pid)) {
      continue;
    }
    processIds.add(pid);
    pending.push(...(childrenByParent.get(pid) || []));
  }
  return processIds;
}

function aggregateProcessMemory(
  processIds: Iterable<number>,
  memoryByPid: Map<number, ProcessMemory>
): ProcessMemory {
  const result = { ...EMPTY_PROCESS_MEMORY };
  for (const pid of new Set(processIds)) {
    const memory = memoryByPid.get(pid) || EMPTY_PROCESS_MEMORY;
    result.pssBytes += memory.pssBytes;
    result.rssBytes += memory.rssBytes;
    result.swapPssBytes += memory.swapPssBytes;
  }
  return result;
}

export {
  EMPTY_PROCESS_MEMORY,
  aggregateProcessMemory,
  collectDescendantProcessIds,
  createLinuxProcessSource,
  parseProcessMemory
};

export type { ProcessIdentity, ProcessMemory, ProcessSource };
