"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const {
  addTopicMetadataPrefix,
  getTopicMetadataPrefix,
  mapMessage,
  parseGramJsSession,
  parsePastedImage,
  renderRichMessageText,
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
    media: {
      file?: Buffer;
      fileMime?: unknown;
      fileName?: unknown;
      type?: unknown;
    };
    options: {
      caption?: unknown;
    };
  }> = [];
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.getAuthorizedClient = async () => ({
    sendMedia: async (
      peer: unknown,
      media: { file?: Buffer; fileMime?: unknown; fileName?: unknown; type?: unknown },
      options: { caption?: unknown }
    ) => {
      sent.push({ peer, media, options });
      return { text: "caption", isOutgoing: true };
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
  const file = sent[0].media.file;
  if (!file) {
    throw new Error("Expected sendMedia to receive the pasted image.");
  }
  assert.equal(sent[0].media.type, "photo");
  assert.equal(sent[0].media.fileName, "pasted.png");
  assert.equal(sent[0].media.fileMime, "image/png");
  assert.deepEqual([...file], [1, 2, 3]);
});

test("TelegramService loads image thumbnails and downloads the full image on demand", async () => {
  const thumbnail = Buffer.from([1, 2, 3]);
  const fullImage = Buffer.from([4, 5, 6]);
  const thumbnailLocation = { width: 320, height: 320 };
  const media = {
    type: "photo",
    thumbnails: [thumbnailLocation]
  };
  const message = {
    date: new Date("2026-07-30T22:42:53.000Z"),
    id: 12,
    isOutgoing: true,
    media,
    sender: { displayName: "David" },
    text: "image caption"
  };
  const downloadCalls: unknown[] = [];
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.getAuthorizedClient = async () => ({
    downloadAsBuffer: async (location: unknown) => {
      downloadCalls.push(location);
      return location === thumbnailLocation ? thumbnail : fullImage;
    },
    getHistory: async () => [message],
    getMessages: async () => [message]
  });
  service.getPeerValue = () => "chat";
  service.resolveProjectTopic = async (_client: unknown, target: unknown) => target;

  const listed = await service.listMessages({ chatId: "chat" }, {});
  assert.equal(listed.messages[0].imagePreviewDataUrl, "data:image/jpeg;base64,AQID");

  const image = await service.getMessageImage({ chatId: "chat" }, 12, {});
  assert.equal(image.dataUrl, "data:image/jpeg;base64,BAUG");
  assert.deepEqual(downloadCalls, [thumbnailLocation, media]);
});

test("renderRichMessageText preserves structured Telegram response content", () => {
  const message = {
    richMessage: {
      blocks: [
        {
          _: "pageBlockHeading2",
          text: { _: "textPlain", text: "Payload recommendation" }
        },
        {
          _: "pageBlockParagraph",
          text: {
            _: "textConcat",
            texts: [
              { _: "textPlain", text: "Use a " },
              {
                _: "textUrl",
                url: "https://example.com/vl53l1x",
                text: {
                  _: "textBold",
                  text: { _: "textPlain", text: "VL53L1X" }
                }
              },
              { _: "textPlain", text: " sensor." }
            ]
          }
        },
        {
          _: "pageBlockList",
          items: [
            {
              _: "pageListItemText",
              text: { _: "textPlain", text: "Keep the payload below 2 g." }
            }
          ]
        },
        {
          _: "pageBlockTable",
          title: { _: "textPlain", text: "Candidates" },
          rows: [
            {
              _: "pageTableRow",
              cells: [
                { _: "pageTableCell", header: true, text: { _: "textPlain", text: "Sensor" } },
                { _: "pageTableCell", header: true, text: { _: "textPlain", text: "Weight" } }
              ]
            },
            {
              _: "pageTableRow",
              cells: [
                { _: "pageTableCell", text: { _: "textPlain", text: "VL53L1X" } },
                { _: "pageTableCell", text: { _: "textPlain", text: "1–2 g" } }
              ]
            }
          ]
        },
        {
          _: "pageBlockBlockquote",
          text: { _: "textPlain", text: "Treat it as a tiny-drone payload." },
          caption: { _: "textEmpty" }
        }
      ]
    }
  };

  const expected = [
    "Payload recommendation",
    "Use a VL53L1X sensor.",
    "- Keep the payload below 2 g.",
    "Candidates",
    "Sensor | Weight",
    "VL53L1X | 1–2 g",
    "> Treat it as a tiny-drone payload."
  ].join("\n");

  assert.equal(renderRichMessageText(message), expected);
  const mapped = mapMessage(message);
  assert.equal(mapped.text, expected);
  assert.equal(mapped.hasMedia, false);
  assert.deepEqual(mapped.richContent, [
    {
      type: "heading",
      level: 2,
      content: [{ text: "Payload recommendation" }]
    },
    {
      type: "paragraph",
      content: [
        { text: "Use a " },
        {
          text: "VL53L1X",
          href: "https://example.com/vl53l1x",
          marks: ["bold"]
        },
        { text: " sensor." }
      ]
    },
    {
      type: "list",
      ordered: false,
      items: [
        {
          blocks: [
            {
              type: "paragraph",
              content: [{ text: "Keep the payload below 2 g." }]
            }
          ]
        }
      ]
    },
    {
      type: "table",
      title: [{ text: "Candidates" }],
      rows: [
        [
          { content: [{ text: "Sensor" }], header: true },
          { content: [{ text: "Weight" }], header: true }
        ],
        [
          { content: [{ text: "VL53L1X" }] },
          { content: [{ text: "1–2 g" }] }
        ]
      ]
    },
    {
      type: "blockquote",
      content: [{ text: "Treat it as a tiny-drone payload." }]
    }
  ]);
});

test("mapMessage preserves links and formatting from standard Telegram entities", () => {
  const text = "Open PickaTube or https://picka.tube";
  const mapped = mapMessage({
    text,
    entities: [
      {
        kind: "text_link",
        offset: 5,
        length: 9,
        params: {
          kind: "text_link",
          url: "https://picka.tube/"
        }
      },
      {
        kind: "bold",
        offset: 5,
        length: 9,
        params: { kind: "bold" }
      },
      {
        kind: "url",
        offset: 18,
        length: 18,
        params: { kind: "url" }
      }
    ]
  });

  assert.equal(mapped.text, text);
  assert.deepEqual(mapped.richContent, [
    {
      type: "paragraph",
      content: [
        { text: "Open " },
        {
          text: "PickaTube",
          href: "https://picka.tube/",
          marks: ["bold"]
        },
        { text: " or " },
        {
          text: "https://picka.tube",
          href: "https://picka.tube"
        }
      ]
    }
  ]);
});

test("TelegramService emits mapped new messages through the mtcute callback", () => {
  let callbackAttached = false;
  let newMessageHandler: (message: unknown) => void = (_message: unknown) => {
    throw new Error("The mtcute new-message callback was not attached.");
  };
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.attachMessageEventHandler({
    onNewMessage: {
      add(handler: (message: unknown) => void) {
        callbackAttached = true;
        newMessageHandler = handler;
      },
      remove() {}
    }
  });

  let payload: unknown;
  service.once("message", (value: unknown) => {
    payload = value;
  });
  if (!callbackAttached) {
    throw new Error("Expected the mtcute new-message callback to be attached.");
  }
  newMessageHandler({
    id: 1021,
    chat: { id: -1004341559831 },
    replyToMessage: { id: 1020, threadId: 54 },
    text: "PickaTube",
    entities: [
      {
        kind: "text_link",
        offset: 0,
        length: 9,
        params: {
          kind: "text_link",
          url: "https://picka.tube/"
        }
      }
    ]
  });

  assert.deepEqual(payload, {
    chatId: "-1004341559831",
    topicIds: ["1021", "54", "1020"],
    message: {
      id: 1021,
      text: "PickaTube",
      outgoing: false,
      senderName: "",
      sentAt: "",
      hasMedia: false,
      isImage: false,
      richContent: [
        {
          type: "paragraph",
          content: [
            {
              text: "PickaTube",
              href: "https://picka.tube/"
            }
          ]
        }
      ]
    }
  });
});

test("parseGramJsSession converts an existing StringSession without exposing it", () => {
  const dcId = 4;
  const address = Buffer.from("149.154.167.91");
  const addressLength = Buffer.alloc(2);
  addressLength.writeInt16BE(address.length);
  const port = Buffer.alloc(2);
  port.writeInt16BE(443);
  const authKey = Buffer.alloc(256, 7);
  const encoded = Buffer.concat([
    Buffer.from([dcId]),
    addressLength,
    address,
    port,
    authKey
  ]).toString("base64");

  const parsed = parseGramJsSession(`1${encoded}`);

  assert.deepEqual(parsed.primaryDcs.main, {
    id: dcId,
    ipAddress: "149.154.167.91",
    port: 443
  });
  assert.equal(parsed.primaryDcs.media, parsed.primaryDcs.main);
  assert.deepEqual([...parsed.authKey], [...authKey]);
});

test("TelegramService filters private bot history by canonical thread ID", async () => {
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  const messages = [
    { id: 1014, replyToMessage: { threadId: 71 } },
    { id: 1013, replyToMessage: { threadId: 72 } },
    { id: 71 }
  ];
  const client = {
    getHistory: async () => messages
  };
  service.getPeerValue = () => "chat";

  const result = await service.getTopicMessages(client, { chatId: "chat" }, 71);
  assert.deepEqual(result.map((message: { id: number }) => message.id), [1014, 71]);
});

test("TelegramService allows retrying an invalid login code", async () => {
  const submittedCodes: string[] = [];
  const service = new TelegramService({ sessionFilePath: "/tmp/telegram-session.json" });
  service.saveSession = () => {};
  service.getClient = async () => ({
    exportSession: async () => "session",
    getMe: async () => {
      throw { text: "AUTH_KEY_UNREGISTERED" };
    },
    start: async (options: {
      code(): Promise<string>;
      codeSentCallback(code: { type: string }): void;
      invalidCodeCallback(type: "code" | "password"): void;
    }) => {
      options.codeSentCallback({ type: "app" });
      submittedCodes.push(await options.code());
      options.invalidCodeCallback("code");
      submittedCodes.push(await options.code());
      return { id: 1 };
    }
  });

  assert.deepEqual(
    await service.startLogin(
      { telegramApiId: 123, telegramApiHash: "hash" },
      "+33123456789"
    ),
    {
      state: "codeRequired",
      summary: "Enter the code sent in Telegram.",
      isCodeViaApp: true
    }
  );

  assert.deepEqual(await service.completeLoginCode("11111"), {
    state: "codeRequired",
    summary: "The Telegram login code is invalid. Try again.",
    isCodeViaApp: true
  });
  assert.deepEqual(await service.completeLoginCode("22222"), {
    state: "ready",
    summary: "Telegram user is authenticated."
  });
  assert.deepEqual(submittedCodes, ["11111", "22222"]);
});

export {};
