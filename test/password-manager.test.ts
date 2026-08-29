"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { PasswordManager, getCredentialOrigin } = require(`${process.cwd()}/build/main/passwordManager`);

test("getCredentialOrigin keeps only http and https origins", () => {
  assert.equal(getCredentialOrigin("https://example.com/login?next=/app"), "https://example.com");
  assert.equal(getCredentialOrigin("http://localhost:5173/path"), "http://localhost:5173");
  assert.equal(getCredentialOrigin("file:///tmp/page.html"), "");
  assert.equal(getCredentialOrigin("not a url"), "");
});

test("PasswordManager saves a confirmed credential through the secrets store", async () => {
  const saved = new Map<string, { encryptedPassword: string; username: string }>();
  const manager = new PasswordManager({
    store: {
      getState: () => ({
        settings: {
          passwordManagerEnabled: true,
          passwordManagerDisclaimerAccepted: true
        }
      })
    },
    secrets: {
      getPasswordCredential: (origin: string) => saved.get(origin) || null,
      updatePasswordCredential: (origin: string, credential: { encryptedPassword: string; username: string }) => saved.set(origin, credential)
    },
    confirmSave: () => true,
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
    }
  });

  assert.deepEqual(await manager.saveCredential({
    url: "https://example.test/sign-in",
    username: "alice",
    password: "correct horse battery staple"
  }), { saved: true });
  assert.deepEqual(saved.get("https://example.test"), {
    username: "alice",
    encryptedPassword: Buffer.from("encrypted:correct horse battery staple").toString("base64")
  });
});

test("PasswordManager coalesces concurrent saves for the same origin", async () => {
  const saved = new Map<string, { encryptedPassword: string; username: string }>();
  let confirmationCount = 0;
  let storeUpdateCount = 0;
  let resolveConfirmation!: (confirmed: boolean) => void;
  const confirmation = new Promise<boolean>((resolve) => {
    resolveConfirmation = resolve;
  });
  const manager = new PasswordManager({
    store: {
      getState: () => ({
        settings: {
          passwordManagerEnabled: true,
          passwordManagerDisclaimerAccepted: true
        }
      })
    },
    secrets: {
      getPasswordCredential: (origin: string) => saved.get(origin) || null,
      updatePasswordCredential: (origin: string, credential: { encryptedPassword: string; username: string }) => {
        storeUpdateCount += 1;
        saved.set(origin, credential);
      }
    },
    confirmSave: () => {
      confirmationCount += 1;
      return confirmation;
    },
    safeStorage: {
      isEncryptionAvailable: () => true,
      encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
      decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
    }
  });
  const credential = {
    url: "https://example.test/sign-in",
    username: "alice",
    password: "correct horse battery staple"
  };

  const firstSave = manager.saveCredential(credential);
  const duplicateSave = manager.saveCredential(credential);

  assert.equal(confirmationCount, 1);
  resolveConfirmation(true);
  assert.deepEqual(await Promise.all([firstSave, duplicateSave]), [
    { saved: true },
    { saved: true }
  ]);
  assert.equal(storeUpdateCount, 1);

  assert.deepEqual(await manager.saveCredential({
    ...credential,
    password: "updated horse battery staple"
  }), { saved: true });
  assert.equal(confirmationCount, 2);
  assert.equal(storeUpdateCount, 2);
});

export {};
