import { slugifyTmuxName } from "./terminalSessionNames.js";

type ExecFileAsync = (
  command: string,
  args: string[],
  options: { timeout: number; windowsHide: boolean }
) => Promise<{ stdout?: unknown }>;

type TmuxClientSession = {
  group: string;
  name: string;
  ownerPid: number;
};

type TerminalClientSessionCleanupFailure = {
  message: string;
  sessionName: string;
};

type TerminalClientSessionCleanupReport = {
  error: string;
  failed: TerminalClientSessionCleanupFailure[];
  removedSessionNames: string[];
};

type TerminalClientSessionCleanupOptions = {
  execFileAsync: ExecFileAsync;
  isProcessAlive?: (pid: number) => boolean;
  sessionPrefix?: string;
};

const TMUX_CLIENT_OWNER_PID_ENV = "BOATYARD_CLIENT_OWNER_PID";

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeError(error: unknown, fallback: string): string {
  const source = error && typeof error === "object"
    ? error as { message?: unknown; stderr?: unknown; stdout?: unknown }
    : {};
  return normalizeText(source.stderr) || normalizeText(source.stdout) || normalizeText(source.message) || fallback;
}

function isNoTmuxServerError(error: unknown): boolean {
  return /no server running|failed to connect to server/i.test(normalizeError(error, ""));
}

function parseTmuxClientSessions(value: unknown): TmuxClientSession[] {
  return normalizeText(value)
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      const [name = "", group = "", ownerPid = "0"] = line.split("|");
      const normalizedName = normalizeText(name);
      const normalizedGroup = normalizeText(group) || normalizedName;
      if (!normalizedName || !normalizedGroup) {
        return [];
      }
      return [{
        group: normalizedGroup,
        name: normalizedName,
        ownerPid: Math.max(0, Number(ownerPid) || 0)
      }];
    });
}

function parseTmuxClientNames(value: unknown): Set<string> {
  return new Set(normalizeText(value).split(/\r?\n/).map(normalizeText).filter(Boolean));
}

function isManagedClientSession(session: TmuxClientSession, sessionPrefix: string): boolean {
  const normalizedPrefix = slugifyTmuxName(sessionPrefix, "boatyard");
  return session.group.startsWith(`${normalizedPrefix}-`) &&
    session.name.startsWith(`${session.group}-client-`) &&
    session.name.length > session.group.length + 8;
}

function defaultIsProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return Boolean(error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "EPERM");
  }
}

function getTerminalClientSessionCreationArgs(
  projectSession: string,
  clientSession: string,
  ownerPid = process.pid
): string[] {
  return [
    "new-session",
    "-d",
    "-t",
    projectSession,
    "-s",
    clientSession,
    "-e",
    `${TMUX_CLIENT_OWNER_PID_ENV}=${ownerPid}`
  ];
}

async function cleanupOrphanedTerminalClientSessions({
  execFileAsync,
  isProcessAlive = defaultIsProcessAlive,
  sessionPrefix = "boatyard"
}: TerminalClientSessionCleanupOptions): Promise<TerminalClientSessionCleanupReport> {
  try {
    const [sessionsResult, clientsResult] = await Promise.all([
      execFileAsync("tmux", [
        "list-sessions",
        "-F",
        `#{session_name}|#{session_group}|#{E:${TMUX_CLIENT_OWNER_PID_ENV}}`
      ], { timeout: 5000, windowsHide: true }),
      execFileAsync("tmux", ["list-clients", "-F", "#{client_session}"], { timeout: 5000, windowsHide: true })
    ]);
    const activeSessions = parseTmuxClientNames(clientsResult.stdout);
    const candidates = parseTmuxClientSessions(sessionsResult.stdout).filter((session) => {
      if (!isManagedClientSession(session, sessionPrefix) || activeSessions.has(session.name)) {
        return false;
      }
      if (session.ownerPid > 0) {
        return !isProcessAlive(session.ownerPid);
      }
      return true;
    });
    const removedSessionNames: string[] = [];
    const failed: TerminalClientSessionCleanupFailure[] = [];
    for (const session of candidates) {
      try {
        await execFileAsync("tmux", ["kill-session", "-t", session.name], { timeout: 5000, windowsHide: true });
        removedSessionNames.push(session.name);
      } catch (error) {
        failed.push({
          message: normalizeError(error, "Could not remove this orphaned terminal session."),
          sessionName: session.name
        });
      }
    }
    return { error: "", failed, removedSessionNames };
  } catch (error) {
    return {
      error: isNoTmuxServerError(error) ? "" : normalizeError(error, "Could not inspect terminal sessions."),
      failed: [],
      removedSessionNames: []
    };
  }
}

export {
  TMUX_CLIENT_OWNER_PID_ENV,
  cleanupOrphanedTerminalClientSessions,
  getTerminalClientSessionCreationArgs,
  parseTmuxClientSessions
};

export type {
  TerminalClientSessionCleanupOptions,
  TerminalClientSessionCleanupReport,
  TmuxClientSession
};
