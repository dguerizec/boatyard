import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const { SecretStore } = require(`${process.cwd()}/build/main/secretStore`);

test("SecretStore shares saved passwords across configuration profiles", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "boatyard-secrets-"));
  const filePath = path.join(root, "secrets.json");
  const secrets = new SecretStore(filePath);

  secrets.updatePasswordCredential("https://example.test", {
    username: "alice",
    encryptedPassword: "encrypted-alice"
  });
  secrets.importPasswordVault({
    "https://example.test": {
      username: "replacement",
      encryptedPassword: "encrypted-replacement"
    },
    "https://other.test": {
      username: "bob",
      encryptedPassword: "encrypted-bob"
    }
  });

  const reloaded = new SecretStore(filePath);
  reloaded.load();
  assert.deepEqual(reloaded.getPasswordCredential("https://example.test"), {
    username: "alice",
    encryptedPassword: "encrypted-alice"
  });
  assert.deepEqual(reloaded.getPasswordCredential("https://other.test"), {
    username: "bob",
    encryptedPassword: "encrypted-bob"
  });
  assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
});
