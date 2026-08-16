import { randomUUID } from "node:crypto";

type RendererTarget = {
  id: number;
  isDestroyed(): boolean;
  send(channel: string, payload: unknown): void;
};

type PendingRequest = {
  reject: (error: Error) => void;
  resolve: (value: unknown) => void;
  targetId: number;
  timer: ReturnType<typeof setTimeout>;
};

type RendererResponse = {
  error?: {
    code?: unknown;
    message?: unknown;
  };
  requestId?: unknown;
  result?: unknown;
};

export class McpRendererError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "McpRendererError";
    this.code = code;
  }
}

export class McpRendererBroker {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly timeoutMs: number;

  constructor(timeoutMs = 10_000) {
    this.timeoutMs = timeoutMs;
  }

  request(target: RendererTarget, operation: string, input: Record<string, unknown>): Promise<unknown> {
    if (target.isDestroyed()) {
      return Promise.reject(new McpRendererError("WINDOW_NOT_AVAILABLE", "The target Boatyard window is closed."));
    }
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new McpRendererError("RENDERER_TIMEOUT", `The Boatyard window did not answer ${operation} in time.`));
      }, this.timeoutMs);
      timer.unref?.();
      this.pending.set(requestId, {
        reject,
        resolve,
        targetId: target.id,
        timer
      });
      try {
        target.send("mcp:request", { requestId, operation, input });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(requestId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  acceptResponse(senderId: number, payload: unknown): boolean {
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return false;
    }
    const response = payload as RendererResponse;
    const requestId = typeof response.requestId === "string" ? response.requestId : "";
    const pending = this.pending.get(requestId);
    if (!pending || pending.targetId !== senderId) {
      return false;
    }
    clearTimeout(pending.timer);
    this.pending.delete(requestId);
    if (response.error) {
      pending.reject(new McpRendererError(
        String(response.error.code || "RENDERER_ERROR"),
        String(response.error.message || "The Boatyard window rejected the MCP request.")
      ));
    } else {
      pending.resolve(response.result);
    }
    return true;
  }

  rejectTarget(targetId: number): void {
    for (const [requestId, pending] of this.pending) {
      if (pending.targetId !== targetId) {
        continue;
      }
      clearTimeout(pending.timer);
      this.pending.delete(requestId);
      pending.reject(new McpRendererError("WINDOW_NOT_AVAILABLE", "The target Boatyard window was closed."));
    }
  }

  close(): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new McpRendererError("MCP_STOPPED", "The Boatyard MCP server stopped."));
    }
    this.pending.clear();
  }
}
