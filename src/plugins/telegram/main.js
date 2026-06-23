// @ts-check
"use strict";

const { TelegramService } = require("./service");
const fs = require("node:fs");
const path = require("node:path");

/**
 * @typedef {import("../pluginTypes").PluginActions} PluginActions
 * @typedef {import("../pluginTypes").PluginEvents} PluginEvents
 * @typedef {import("../pluginTypes").PluginPaths} PluginPaths
 * @typedef {{
 *   actions: PluginActions,
 *   events: PluginEvents,
 *   paths: PluginPaths
 * }} TelegramPluginContext
 */

/**
 * @param {TelegramPluginContext} ctx
 */
function activate(ctx) {
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

  ctx.actions.handle("status", ({ globalConfig = {} } = {}) => {
    return service.getStatus(globalConfig);
  });

  ctx.actions.handle("messages", ({ target = {}, globalConfig = {} } = {}) => {
    return service.listMessages(target, globalConfig);
  });

  ctx.actions.handle("sendMessage", ({ target = {}, text = "", globalConfig = {} } = {}) => {
    return service.sendMessage(target, text, globalConfig);
  });

  ctx.actions.handle("startLogin", ({ globalConfig = {}, phoneNumber = "" } = {}) => {
    return service.startLogin(globalConfig, phoneNumber);
  });

  ctx.actions.handle("completeLoginCode", ({ code = "" } = {}) => {
    return service.completeLoginCode(code);
  });

  ctx.actions.handle("completeLoginPassword", ({ password = "" } = {}) => {
    return service.completeLoginPassword(password);
  });

  ctx.actions.handle("logout", () => {
    service.clearSession();
    return { state: "notAuthenticated", summary: "Telegram user is not authenticated." };
  });
}

module.exports = { activate };
