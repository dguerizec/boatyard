"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addTopicMetadataPrefix,
  getTopicMetadataPrefix
} = require(`${process.cwd()}/build/plugins/telegram/service`);

test("getTopicMetadataPrefix serializes resolved Telegram topic metadata", () => {
  assert.equal(
    getTopicMetadataPrefix({
      threadId: "22",
      topicTopMessageId: "11",
      topicTitle: "sillage"
    }),
    '<boatyard-topic id="22" name="sillage" />'
  );
});

test("getTopicMetadataPrefix escapes Telegram topic metadata attributes", () => {
  assert.equal(
    getTopicMetadataPrefix({
      topicTopMessageId: "22",
      topicTitle: 'Project "A" <main> & docs'
    }),
    '<boatyard-topic id="22" name="Project &quot;A&quot; &lt;main&gt; &amp; docs" />'
  );
});

test("addTopicMetadataPrefix prepends metadata to messages with topic context", () => {
  assert.equal(
    addTopicMetadataPrefix("hello", {
      threadId: "22",
      topicTitle: "sillage"
    }),
    '<boatyard-topic id="22" name="sillage" />\nhello'
  );
});

test("addTopicMetadataPrefix leaves messages unchanged without topic context", () => {
  assert.equal(addTopicMetadataPrefix("hello", {}), "hello");
});

export {};
