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
};

type PasswordSecrets = {
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

type SafeStorage = {
  decryptString(value: Buffer): string;
  encryptString(value: string): Buffer;
  isEncryptionAvailable(): boolean;
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
  private secrets: PasswordSecrets;
  private confirmSave: ConfirmSaveCallback;
  private safeStorage: SafeStorage;
  private pendingSaves = new Map<string, Promise<SaveCredentialResult>>();

  constructor({
    store,
    secrets,
    confirmSave,
    safeStorage: storage = safeStorage
  }: {
    store: PasswordStore;
    secrets: PasswordSecrets;
    confirmSave: ConfirmSaveCallback;
    safeStorage?: SafeStorage;
  }) {
    this.store = store;
    this.secrets = secrets;
    this.confirmSave = confirmSave;
    this.safeStorage = storage;
  }

  isEnabled(): boolean {
    const settings = this.store.getState().settings;
    return settings.passwordManagerEnabled === true && settings.passwordManagerDisclaimerAccepted === true;
  }

  getStatus(): PasswordManagerStatus {
    return {
      enabled: this.isEnabled(),
      encryptionAvailable: this.safeStorage.isEncryptionAvailable()
    };
  }

  getCredential(url: unknown): PasswordCredential | null {
    if (!this.isEnabled() || !this.safeStorage.isEncryptionAvailable()) {
      return null;
    }

    const origin = getCredentialOrigin(url);
    const credential = origin ? this.secrets.getPasswordCredential(origin) : null;
    if (!credential) {
      return null;
    }

    try {
      return {
        origin,
        username: credential.username,
        password: this.safeStorage.decryptString(Buffer.from(credential.encryptedPassword, "base64"))
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

    if (!this.safeStorage.isEncryptionAvailable()) {
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

    const pendingSave = this.pendingSaves.get(origin);
    if (pendingSave) {
      return pendingSave;
    }

    const save = this.confirmAndStoreCredential({
      origin,
      username: normalizedUsername,
      password: normalizedPassword,
      isUpdate: Boolean(existing)
    });
    this.pendingSaves.set(origin, save);

    try {
      return await save;
    } finally {
      if (this.pendingSaves.get(origin) === save) {
        this.pendingSaves.delete(origin);
      }
    }
  }

  private async confirmAndStoreCredential({
    origin,
    username,
    password,
    isUpdate
  }: PasswordCredential & { isUpdate: boolean }): Promise<SaveCredentialResult> {
    const confirmed = await this.confirmSave({ origin, username, isUpdate });
    if (!confirmed) {
      return { saved: false, reason: "cancelled" };
    }

    const encryptedPassword = this.safeStorage.encryptString(password).toString("base64");
    this.secrets.updatePasswordCredential(origin, {
      username,
      encryptedPassword
    });
    return { saved: true };
  }
}

module.exports = {
  PasswordManager,
  getCredentialOrigin
};

export {};
