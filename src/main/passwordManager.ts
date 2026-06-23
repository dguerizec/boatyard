"use strict";

const { safeStorage } = require("electron");

type PasswordSettings = {
  passwordManagerEnabled?: boolean;
  passwordManagerDisclaimerAccepted?: boolean;
};

type StoredPasswordCredential = {
  username: string;
  encryptedPassword: string;
};

type PasswordStore = {
  getState(): { settings: PasswordSettings };
  getPasswordCredential(origin: string): StoredPasswordCredential | null;
  updatePasswordCredential(origin: string, credential: StoredPasswordCredential): unknown;
};

type ConfirmSaveCallback = (payload: {
  origin: string;
  username: string;
  isUpdate: boolean;
}) => boolean | Promise<boolean>;

type PasswordCredential = {
  origin: string;
  username: string;
  password: string;
};

type PasswordManagerStatus = {
  enabled: boolean;
  encryptionAvailable: boolean;
};

type SaveCredentialInput = {
  url?: unknown;
  username?: unknown;
  password?: unknown;
};

type SaveCredentialResult =
  | { saved: true }
  | { saved: false; reason: "disabled" | "encryption-unavailable" | "empty" | "unchanged" | "cancelled" };

function getCredentialOrigin(rawUrl: unknown): string {
  try {
    const parsed = new URL(String(rawUrl || ""));
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.origin : "";
  } catch {
    return "";
  }
}

class PasswordManager {
  private store: PasswordStore;
  private confirmSave: ConfirmSaveCallback;

  constructor({ store, confirmSave }: { store: PasswordStore; confirmSave: ConfirmSaveCallback }) {
    this.store = store;
    this.confirmSave = confirmSave;
  }

  isEnabled(): boolean {
    const settings = this.store.getState().settings;
    return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
  }

  getStatus(): PasswordManagerStatus {
    return {
      enabled: this.isEnabled(),
      encryptionAvailable: safeStorage.isEncryptionAvailable()
    };
  }

  getCredential(url: unknown): PasswordCredential | null {
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

  async saveCredential({ url, username, password }: SaveCredentialInput): Promise<SaveCredentialResult> {
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
