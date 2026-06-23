// @ts-check
"use strict";

const { safeStorage } = require("electron");

/**
 * @typedef {{ passwordManagerEnabled?: boolean, passwordManagerDisclaimerAccepted?: boolean }} PasswordSettings
 * @typedef {{ username: string, encryptedPassword: string }} StoredPasswordCredential
 * @typedef {{
 *   getState(): { settings: PasswordSettings },
 *   getPasswordCredential(origin: string): StoredPasswordCredential | null,
 *   updatePasswordCredential(origin: string, credential: StoredPasswordCredential): unknown
 * }} PasswordStore
 * @typedef {(payload: { origin: string, username: string, isUpdate: boolean }) => boolean | Promise<boolean>} ConfirmSaveCallback
 * @typedef {{ origin: string, username: string, password: string }} PasswordCredential
 * @typedef {{ enabled: boolean, encryptionAvailable: boolean }} PasswordManagerStatus
 * @typedef {{ url?: unknown, username?: unknown, password?: unknown }} SaveCredentialInput
 * @typedef {{ saved: true } | { saved: false, reason: "disabled" | "encryption-unavailable" | "empty" | "unchanged" | "cancelled" }} SaveCredentialResult
 */

/**
 * @param {unknown} rawUrl
 * @returns {string}
 */
function getCredentialOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

class PasswordManager {
  /**
   * @param {{ store: PasswordStore, confirmSave: ConfirmSaveCallback }} options
   */
  constructor({ store, confirmSave }) {
    /** @type {PasswordStore} */
    this.store = store;
    /** @type {ConfirmSaveCallback} */
    this.confirmSave = confirmSave;
  }

  /**
   * @returns {boolean}
   */
  isEnabled() {
    const settings = this.store.getState().settings;
    return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
  }

  /**
   * @returns {PasswordManagerStatus}
   */
  getStatus() {
    return {
      enabled: this.isEnabled(),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  /**
   * @param {unknown} url
   * @returns {PasswordCredential | null}
   */
  getCredential(url) {
    if (!this.isEnabled() || !safeStorage.isEncryptionAvailable()) {
      return null;
    }

    const origin = getCredentialOrigin(url);
    const credential = origin ? this.store.getPasswordCredential(origin) : null;
    if (!credential) {
      return null;
    }

    try {
      return {
        origin,
        username: credential.username,
        password: safeStorage.decryptString(Buffer.from(credential.encryptedPassword, "base64"))
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Could not decrypt password for ${origin}: ${message}`);
      return null;
    }
  }

  /**
   * @param {SaveCredentialInput} input
   * @returns {Promise<SaveCredentialResult>}
   */
  async saveCredential({ url, username, password }) {
    if (!this.isEnabled()) {
      return { saved: false, reason: "disabled" };
    }

    if (!safeStorage.isEncryptionAvailable()) {
      return { saved: false, reason: "encryption-unavailable" };
    }

    const origin = getCredentialOrigin(url);
    const normalizedUsername = String(username || "").trim();
    const normalizedPassword = String(password || "");

    if (!origin || !normalizedUsername || !normalizedPassword) {
      return { saved: false, reason: "empty" };
    }

    const existing = this.getCredential(origin);
    if (existing?.username === normalizedUsername && existing.password === normalizedPassword) {
      return { saved: false, reason: "unchanged" };
    }

    const confirmed = await this.confirmSave({
      origin,
      username: normalizedUsername,
      isUpdate: Boolean(existing)
    });

    if (!confirmed) {
      return { saved: false, reason: "cancelled" };
    }

    const encryptedPassword = safeStorage.encryptString(normalizedPassword).toString("base64");
    this.store.updatePasswordCredential(origin, {
      username: normalizedUsername,
      encryptedPassword
    });
    return { saved: true };
  }
}

module.exports = {
  PasswordManager,
  getCredentialOrigin
};
