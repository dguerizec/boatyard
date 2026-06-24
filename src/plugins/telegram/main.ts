"use strict";

import type { PluginActions, PluginEvents, PluginPaths } from "../pluginTypes";

const { TelegramService } = require("./service");
const fs = require("node:fs");
const path = require("node:path");

type TelegramStatusPayload = { globalConfig?: Record<string, unknown> };
type TelegramMessagesPayload = { target?: Record<string, unknown>; globalConfig?: Record<string, unknown> };
type TelegramSendMessagePayload = { target?: Record<string, unknown>; text?: unknown; globalConfig?: Record<string, unknown> };
type TelegramStartLoginPayload = { globalConfig?: Record<string, unknown>; phoneNumber?: unknown };
type TelegramCodePayload = { code?: unknown };
type TelegramPasswordPayload = { password?: unknown };
type TelegramPluginContext = {
  actions: PluginActions;
  events: PluginEvents;
  paths: PluginPaths;
};

function activate(ctx: TelegramPluginContext) {
  const legacySessionPath = path.join(ctx.paths.userData, "telegram-session.json");
  const pluginSessionPath = path.join(ctx.paths.pluginData, "telegram-session.json");
  const sessionFilePath = fs.existsSync(legacySessionPath) && !fs.existsSync(pluginSessionPath)
    ? legacySessionPath
    : pluginSessionPath;

  const service = new TelegramService({
    sessionFilePath
  });

  service.on("message", (payload) => {
    ctx.events.emit("message", payload);
  });

  ctx.actions.handle<TelegramStatusPayload>("status", ({ globalConfig = {} } = {}) => {
    return service.getStatus(globalConfig);
  });

  ctx.actions.handle<TelegramMessagesPayload>("messages", ({ target = {}, globalConfig = {} } = {}) => {
    return service.listMessages(target, globalConfig);
  });

  ctx.actions.handle<TelegramSendMessagePayload>("sendMessage", ({ target = {}, text = "", globalConfig = {} } = {}) => {
    return service.sendMessage(target, text, globalConfig);
  });

  ctx.actions.handle<TelegramStartLoginPayload>("startLogin", ({ globalConfig = {}, phoneNumber = "" } = {}) => {
    return service.startLogin(globalConfig, phoneNumber);
  });

  ctx.actions.handle<TelegramCodePayload>("completeLoginCode", ({ code = "" } = {}) => {
    return service.completeLoginCode(code);
  });

  ctx.actions.handle<TelegramPasswordPayload>("completeLoginPassword", ({ password = "" } = {}) => {
    return service.completeLoginPassword(password);
  });

  ctx.actions.handle("logout", () => {
    service.clearSession();
    return { state: "notAuthenticated", summary: "Telegram user is not authenticated." };
  });
}

export { activate };
