import assert from "node:assert/strict";
import test from "node:test";

const { getConnectionIdentity } = require(`${process.cwd()}/build/plugins/telegram/main`);

test("Telegram connection identities group only matching API credentials", () => {
  assert.equal(
    getConnectionIdentity({ telegramApiId: "123", telegramApiHash: "same-connection" }),
    "123:same-connection"
  );
  assert.equal(
    getConnectionIdentity({ telegramApiId: 123, telegramApiHash: "other-connection" }),
    "123:other-connection"
  );
  assert.equal(getConnectionIdentity({ telegramApiId: "not-a-number", telegramApiHash: "hash" }), "");
  assert.equal(getConnectionIdentity({ telegramApiId: 123 }), "");
});
