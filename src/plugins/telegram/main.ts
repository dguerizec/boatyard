"use strict";

import type { PluginActions, PluginEvents, PluginPaths } from "../../shared/pluginTypes";

const { TelegramService } = require("./service");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

type TelegramStatusPayload = { globalConfig?: Record<string, unknown> };
type TelegramMessagesPayload = { target?: Record<string, unknown>; globalConfig?: Record<string, unknown> };
type TelegramSendMessagePayload = { target?: Record<string, unknown>; text?: unknown; image?: unknown; globalConfig?: Record<string, unknown> };
type TelegramMessageImagePayload = { target?: Record<string, unknown>; messageId?: unknown; globalConfig?: Record<string, unknown> };
type TelegramStartLoginPayload = { globalConfig?: Record<string, unknown>; phoneNumber?: unknown };
type TelegramCodePayload = { code?: unknown };
type TelegramPasswordPayload = { password?: unknown };
type TelegramPluginContext = {
  actions: PluginActions;
  events: PluginEvents;
  paths: PluginPaths;
};

const sharedServices = new Map<string, InstanceType<typeof TelegramService>>();

function getConnectionIdentity(globalConfig: unknown): string {
  const config = globalConfig && typeof globalConfig === "object" && !Array.isArray(globalConfig)
    ? globalConfig as Record<string, unknown>
    : {};
  const apiId = Number(String(config.telegramApiId || "").trim());
  const apiHash = String(config.telegramApiHash || "").trim();
  return Number.isInteger(apiId) && apiId > 0 && apiHash ? `${apiId}:${apiHash}` : "";
}

function getConnectionSessionPath(pluginDataPath: string, identity: string): string {
  const hash = crypto.createHash("sha256").update(identity).digest("hex");
  return path.join(pluginDataPath, "sessions", `${hash}.json`);
}

function migrateLegacySession(sessionFilePath: string, paths: PluginPaths): void {
  if (fs.existsSync(sessionFilePath)) {
    return;
  }
  const legacyPaths = [
    path.join(paths.userData, "telegram-session.json"),
    path.join(paths.pluginData, "telegram-session.json")
  ];
  const legacyPath = legacyPaths.find((candidate) => fs.existsSync(candidate));
  if (!legacyPath) {
    return;
  }
  fs.mkdirSync(path.dirname(sessionFilePath), { recursive: true, mode: 0o700 });
  fs.renameSync(legacyPath, sessionFilePath);
}

function activate(ctx: TelegramPluginContext) {
  const subscribedServices = new Set<InstanceType<typeof TelegramService>>();
  let activeService: InstanceType<typeof TelegramService> | null = null;

  function getService(globalConfig: unknown): InstanceType<typeof TelegramService> | null {
    const identity = getConnectionIdentity(globalConfig);
    if (!identity) {
      return null;
    }
    const serviceKey = `${ctx.paths.userData}\u0000${identity}`;
    let service = sharedServices.get(serviceKey);
    if (!service) {
      const sessionFilePath = getConnectionSessionPath(ctx.paths.pluginData, identity);
      migrateLegacySession(sessionFilePath, ctx.paths);
      service = new TelegramService({ sessionFilePath });
      sharedServices.set(serviceKey, service);
    }
    if (!subscribedServices.has(service)) {
      subscribedServices.add(service);
      service.on("message", (payload: unknown) => {
        ctx.events.emit("message", payload);
      });
    }
    return service;
  }

  function requireService(globalConfig: unknown): InstanceType<typeof TelegramService> {
    const service = getService(globalConfig);
    if (!service) {
      throw new Error("Telegram API credentials are not configured.");
    }
    return service;
  }

  ctx.actions.handle<TelegramStatusPayload>("status", ({ globalConfig = {} } = {}) => {
    const service = getService(globalConfig);
    activeService = service;
    return service
      ? service.getStatus(globalConfig)
      : { state: "notConfigured", summary: "Telegram API credentials are not configured." };
  });

  ctx.actions.handle<TelegramMessagesPayload>("messages", ({ target = {}, globalConfig = {} } = {}) => {
    return requireService(globalConfig).listMessages(target, globalConfig);
  });

  ctx.actions.handle<TelegramSendMessagePayload>("sendMessage", ({ target = {}, text = "", image, globalConfig = {} } = {}) => {
    return requireService(globalConfig).sendMessage(target, text, globalConfig, image);
  });

  ctx.actions.handle<TelegramMessageImagePayload>("messageImage", ({ target = {}, messageId, globalConfig = {} } = {}) => {
    return requireService(globalConfig).getMessageImage(target, messageId, globalConfig);
  });

  ctx.actions.handle<TelegramStartLoginPayload>("startLogin", ({ globalConfig = {}, phoneNumber = "" } = {}) => {
    activeService = requireService(globalConfig);
    return activeService.startLogin(globalConfig, phoneNumber);
  });

  ctx.actions.handle<TelegramCodePayload>("completeLoginCode", ({ code = "" } = {}) => {
    if (!activeService) {
      throw new Error("Telegram login is not in progress.");
    }
    return activeService.completeLoginCode(code);
  });

  ctx.actions.handle<TelegramPasswordPayload>("completeLoginPassword", ({ password = "" } = {}) => {
    if (!activeService) {
      throw new Error("Telegram login is not in progress.");
    }
    return activeService.completeLoginPassword(password);
  });

  ctx.actions.handle("logout", () => {
    if (!activeService) {
      throw new Error("Telegram API credentials are not configured.");
    }
    const service = activeService;
    service.clearSession();
    return { state: "notAuthenticated", summary: "Telegram user is not authenticated." };
  });
}

export { activate, getConnectionIdentity };
