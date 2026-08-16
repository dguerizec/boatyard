import { timingSafeEqual } from "node:crypto";
import { createServer, type Server as HttpServer } from "node:http";
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import {
  localhostHostValidation,
  localhostOriginValidation,
  toNodeHandler
} from "@modelcontextprotocol/node";
import { z } from "zod";
import type { McpSettings } from "./mcpSettingsStore.js";

type McpPaneApi = {
  listWindows(): unknown;
  requestPane(
    contextId: string,
    windowId: string,
    operation: string,
    input: Record<string, unknown>
  ): Promise<unknown>;
};

type McpServerServiceOptions = {
  api: McpPaneApi;
  getSettings: () => McpSettings;
  version: string;
};

export type McpServerStatus = {
  enabled: boolean;
  endpoint: string;
  error: string | null;
  listening: boolean;
  port: number;
  token: string;
};

function jsonResult(value: unknown) {
  const structuredContent = value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : { value };
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    structuredContent
  };
}

function errorResult(error: unknown) {
  const source = error && typeof error === "object" ? error as { code?: unknown; message?: unknown } : {};
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        code: String(source.code || "BOATYARD_ERROR"),
        message: String(source.message || error || "Boatyard rejected the request.")
      })
    }],
    isError: true
  };
}

function tokenMatchesAny(authorization: string | undefined, expectedTokens: string[]): boolean {
  const match = String(authorization || "").match(/^Bearer\s+(.+)$/i);
  if (!match) {
    return false;
  }
  const actual = Buffer.from(match[1], "utf8");
  let matches = false;
  for (const expectedToken of expectedTokens) {
    const expected = Buffer.from(expectedToken, "utf8");
    if (actual.length === expected.length && timingSafeEqual(actual, expected)) {
      matches = true;
    }
  }
  return matches;
}

export class McpServerService {
  private readonly api: McpPaneApi;
  private configurationQueue: Promise<void> = Promise.resolve();
  private error: string | null = null;
  private readonly getSettings: () => McpSettings;
  private handler: ReturnType<typeof createMcpHandler> | null = null;
  private httpServer: HttpServer | null = null;
  private readonly version: string;

  constructor({ api, getSettings, version }: McpServerServiceOptions) {
    this.api = api;
    this.getSettings = getSettings;
    this.version = version;
  }

  getStatus(): McpServerStatus {
    const settings = this.getSettings();
    return {
      enabled: settings.enabled,
      endpoint: `http://127.0.0.1:${settings.port}/mcp`,
      error: this.error,
      listening: Boolean(this.httpServer?.listening),
      port: settings.port,
      token: settings.token
    };
  }

  configure(): Promise<McpServerStatus> {
    const result = this.configurationQueue.then(() => this.reconfigure());
    this.configurationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  stop(): Promise<void> {
    const result = this.configurationQueue.then(() => this.stopNow());
    this.configurationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async reconfigure(): Promise<McpServerStatus> {
    await this.stopNow();
    this.error = null;
    if (this.getSettings().enabled) {
      try {
        await this.start();
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        await this.stopNow();
      }
    }
    return this.getStatus();
  }

  private async stopNow(): Promise<void> {
    const httpServer = this.httpServer;
    const handler = this.handler;
    this.httpServer = null;
    this.handler = null;
    if (handler) {
      await handler.close();
    }
    if (httpServer) {
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  }

  private createProtocolServer(): McpServer {
    const protocolServer = new McpServer({ name: "boatyard", version: this.version });
    protocolServer.registerTool("list_windows", {
      title: "List Boatyard windows",
      description: "List open Boatyard windows and the projects whose active pane layouts they can expose.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async () => {
      try {
        return jsonResult(this.api.listWindows());
      } catch (error) {
        return errorResult(error);
      }
    });

    const targetSchema = {
      contextId: z.string().min(1).describe("Opaque configuration context ID returned by list_windows"),
      windowId: z.string().min(1).describe("Boatyard window ID returned by list_windows"),
      projectId: z.string().min(1).describe("Project ID returned by list_windows; use __global__ for Global")
    };
    protocolServer.registerTool("get_pane_layout", {
      title: "Get active pane layout",
      description: "Read the active split tree and exact pane choice selected in every pane.",
      inputSchema: z.object(targetSchema),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (input) => this.invokePane("get_pane_layout", input));
    protocolServer.registerTool("list_pane_types", {
      title: "List pane choices",
      description: "List every exact entry and subtype currently selectable in a pane's Boatyard dropdown.",
      inputSchema: z.object({ ...targetSchema, paneId: z.string().min(1) }),
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (input) => this.invokePane("list_pane_types", input));
    protocolServer.registerTool("assign_pane_type", {
      title: "Assign pane choice",
      description: "Select an exact dropdown entry in an existing pane. Optionally reject the change if the layout revision moved.",
      inputSchema: z.object({
        ...targetSchema,
        paneId: z.string().min(1),
        choiceId: z.string().min(1),
        expectedRevision: z.string().min(1).optional()
      }),
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false }
    }, async (input) => this.invokePane("assign_pane_type", input));
    return protocolServer;
  }

  private async invokePane(operation: string, input: Record<string, unknown>) {
    try {
      return jsonResult(await this.api.requestPane(
        String(input.contextId),
        String(input.windowId),
        operation,
        input
      ));
    } catch (error) {
      return errorResult(error);
    }
  }

  private async start(): Promise<void> {
    const settings = this.getSettings();
    this.error = null;
    this.handler = createMcpHandler(() => this.createProtocolServer(), {
      onerror: (error) => console.warn(`Boatyard MCP request failed: ${error.message}`)
    });
    const nodeHandler = toNodeHandler(this.handler);
    const validateHost = localhostHostValidation();
    const validateOrigin = localhostOriginValidation();
    const httpServer = createServer((request, response) => {
      let pathname = "";
      try {
        pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
      } catch {
        response.writeHead(400).end("Invalid request URL.");
        return;
      }
      if (pathname !== "/mcp") {
        response.writeHead(404).end("Not found.");
        return;
      }
      if (!validateHost(request, response) || !validateOrigin(request, response)) {
        return;
      }
      const currentSettings = this.getSettings();
      if (!tokenMatchesAny(request.headers.authorization, [
        currentSettings.token,
        ...Object.values(currentSettings.managedClientTokens).filter((token): token is string => Boolean(token))
      ])) {
        response.writeHead(401, {
          "Content-Type": "application/json",
          "WWW-Authenticate": "Bearer"
        });
        response.end(JSON.stringify({ error: "unauthorized" }));
        return;
      }
      void nodeHandler(request, response).catch((error: unknown) => {
        console.warn(`Boatyard MCP HTTP request failed: ${error instanceof Error ? error.message : String(error)}`);
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "application/json" });
        }
        if (!response.writableEnded) {
          response.end(JSON.stringify({ error: "internal_error" }));
        }
      });
    });
    this.httpServer = httpServer;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        httpServer.off("listening", onListening);
        reject(error);
      };
      const onListening = () => {
        httpServer.off("error", onError);
        resolve();
      };
      httpServer.once("error", onError);
      httpServer.once("listening", onListening);
      httpServer.listen(settings.port, "127.0.0.1");
    });
    httpServer.unref();
  }
}
