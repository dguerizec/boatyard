"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addTopicMetadataPrefix,
  getTopicMetadataPrefix,
  parsePastedImage,
  TelegramService
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

test("parsePastedImage accepts supported clipboard image data", () => {
  const image = parsePastedImage({
    dataUrl: "data:image/png;base64,AQID",
    name: "screenshot.png"
  });

  assert.equal(image.name, "screenshot.png");
  assert.deepEqual([...image.buffer], [1, 2, 3]);
});

test("TelegramService sends a pasted image with the message as its caption", async () => {
  const sent: Array<{
    peer: unknown;
    options: {
      caption?: unknown;
      file?: {
        buffer?: Buffer;
        name?: unknown;
      };
    };
  }> = [];
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.getAuthorizedClient = async () => ({
    sendFile: async (peer: unknown, options: { caption?: unknown; file?: { buffer?: Buffer; name?: unknown } }) => {
      sent.push({ peer, options });
      return { message: "caption", out: true };
    }
  });
  service.getPeerValue = () => "chat";
  service.resolveProjectTopic = async (_client: unknown, target: unknown) => target;

  await service.sendMessage({ chatId: "chat" }, "caption", {}, {
    dataUrl: "data:image/png;base64,AQID",
    name: "pasted.png"
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].peer, "chat");
  assert.equal(sent[0].options.caption, "caption");
  const file = sent[0].options.file;
  if (!file) {
    throw new Error("Expected sendFile to receive the pasted image.");
  }
  assert.equal(file.name, "pasted.png");
  assert.deepEqual([...(file.buffer || Buffer.alloc(0))], [1, 2, 3]);
});

test("TelegramService loads image thumbnails and downloads the full image on demand", async () => {
  const thumbnail = Buffer.from([1, 2, 3]);
  const fullImage = Buffer.from([4, 5, 6]);
  const message = {
    id: 12,
    media: { photo: { id: 1 } },
    message: "image caption",
    out: true
  };
  const downloadCalls: Array<{ thumb?: unknown }> = [];
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.getAuthorizedClient = async () => ({
    getMessages: async (_peer: unknown, options: { ids?: number } = {}) => options.ids ? [message] : [message],
    downloadMedia: async (_message: unknown, options: { thumb?: unknown } = {}) => {
      downloadCalls.push(options);
      return options.thumb === 2 ? thumbnail : fullImage;
    }
  });
  service.getPeerValue = () => "chat";
  service.resolveProjectTopic = async (_client: unknown, target: unknown) => target;

  const listed = await service.listMessages({ chatId: "chat" }, {});
  assert.equal(listed.messages[0].imagePreviewDataUrl, "data:image/jpeg;base64,AQID");

  const image = await service.getMessageImage({ chatId: "chat" }, 12, {});
  assert.equal(image.dataUrl, "data:image/jpeg;base64,BAUG");
  assert.deepEqual(downloadCalls.map((call) => call.thumb), [2, undefined]);
});

export {};
