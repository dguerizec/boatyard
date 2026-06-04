"use strict";

const { safeStorage } = require("electron");

function getCredentialOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

class PasswordManager {
  constructor({ store, confirmSave }) {
    this.store = store;
    this.confirmSave = confirmSave;
  }

  isEnabled() {
    const settings = this.store.getState().settings;
    return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
  }

  getStatus() {
    return {
      enabled: this.isEnabled(),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

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
      console.warn(`Could not decrypt password for ${origin}: ${error.message}`);
      return null;
    }
  }

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
