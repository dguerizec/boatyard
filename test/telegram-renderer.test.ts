"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");
const { registerPluginRegistry } = require(`${process.cwd()}/build/renderer/pluginRegistry`);
const { registerWidgetRegistry } = require(`${process.cwd()}/build/renderer/widgetRegistry`);

type EventHandler = (event: { preventDefault(): void }) => void;

class FakeElement {
  attributes = new Map<string, string>();
  children: FakeElement[] = [];
  className = "";
  disabled = false;
  href = "";
  tagName: string;
  textContent = "";
  title = "";
  private listeners = new Map<string, EventHandler[]>();

  constructor(tagName: string) {
    this.tagName = tagName.toLowerCase();
  }

  get childElementCount() {
    return this.children.length;
  }

  append(...children: FakeElement[]) {
    this.children.push(...children);
  }

  addEventListener(name: string, handler: EventHandler) {
    const handlers = this.listeners.get(name) || [];
    handlers.push(handler);
    this.listeners.set(name, handlers);
  }

  setAttribute(name: string, value: unknown) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name: string) {
    this.attributes.delete(name);
  }

  trigger(name: string) {
    for (const handler of this.listeners.get(name) || []) {
      handler({ preventDefault() {} });
    }
  }
}

type TelegramRendererService = {
  mergeMessages(messages: unknown[], message: unknown): unknown[];
  renderMessageButtons(message: unknown, activate?: (button: unknown) => unknown): FakeElement | null;
  renderMessageContent(message: unknown): FakeElement | null;
};

type PluginRegistry = {
  applyEnabledState(state: Record<string, unknown>): void;
  getService(id: string): TelegramRendererService;
};

type RendererWindow = Record<string, unknown> & {
  BoatyardPluginRegistry?: PluginRegistry;
  boatyard: {
    invokePlugin(): Promise<unknown>;
    onPluginEvent(): () => void;
    openExternal(url: string): void;
  };
  window?: RendererWindow;
};

function loadTelegramRendererService(openedUrls: string[] = []): TelegramRendererService {
  const rendererWindow: RendererWindow = {
    boatyard: {
      invokePlugin: async () => ({
        state: "notConfigured",
        summary: "Telegram API credentials are not configured."
      }),
      onPluginEvent: () => (() => {}),
      openExternal: (url) => {
        openedUrls.push(url);
      }
    }
  };
  const context = {
    console,
    URL,
    document: {
      createElement: (tagName: string) => new FakeElement(tagName)
    },
    window: rendererWindow
  };
  rendererWindow.window = rendererWindow;
  registerWidgetRegistry(rendererWindow);
  registerPluginRegistry(rendererWindow);
  vm.createContext(context);
  vm.runInContext(
    fs.readFileSync(`${process.cwd()}/build/plugins/telegram/renderer.js`, "utf8"),
    context
  );
  const registry = rendererWindow.BoatyardPluginRegistry;
  if (!registry) {
    throw new Error("Telegram plugin registry was not initialized.");
  }
  registry.applyEnabledState({});
  return registry.getService("boatyard.telegram");
}

function findByTag(root: FakeElement, tagName: string): FakeElement | null {
  if (root.tagName === tagName) {
    return root;
  }
  for (const child of root.children) {
    const match = findByTag(child, tagName);
    if (match) {
      return match;
    }
  }
  return null;
}

function findByClass(root: FakeElement, className: string): FakeElement | null {
  if (root.className.split(/\s+/).includes(className)) {
    return root;
  }
  for (const child of root.children) {
    const match = findByClass(child, className);
    if (match) {
      return match;
    }
  }
  return null;
}

function findAllByClass(root: FakeElement, className: string): FakeElement[] {
  return [
    ...(root.className.split(/\s+/).includes(className) ? [root] : []),
    ...root.children.flatMap((child) => findAllByClass(child, className))
  ];
}

function getText(root: FakeElement): string {
  return `${root.textContent}${root.children.map(getText).join("")}`;
}

function requireElement(element: FakeElement | null): FakeElement {
  if (!element) {
    throw new Error("Expected a rendered element.");
  }
  return element;
}

test("Telegram renderer creates safe DOM for rich message blocks", () => {
  const openedUrls: string[] = [];
  const service = loadTelegramRendererService(openedUrls);
  const content = service.renderMessageContent({
    text: "Flattened fallback",
    richContent: [
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
                content: [{ text: "Keep it below 2 g." }]
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
    ]
  });

  if (!content) {
    throw new Error("Expected rich Telegram content.");
  }
  assert.equal(content.className, "telegram-message-content");
  assert.equal(getText(requireElement(findByTag(content, "h2"))), "Payload recommendation");
  assert.equal(getText(requireElement(findByTag(content, "strong"))), "VL53L1X");
  const link = requireElement(findByTag(content, "a"));
  assert.equal(link.href, "https://example.com/vl53l1x");
  link.trigger("click");
  assert.deepEqual(openedUrls, ["https://example.com/vl53l1x"]);
  assert.equal(getText(requireElement(findByTag(content, "ul"))), "Keep it below 2 g.");
  assert.equal(getText(requireElement(findByTag(content, "th"))), "Sensor");
  assert.equal(getText(requireElement(findByTag(content, "blockquote"))), "Treat it as a tiny-drone payload.");
  assert.ok(findByClass(content, "telegram-rich-table-scroll"));
  assert.equal(getText(content).includes("Flattened fallback"), false);
});

test("Telegram renderer keeps plain text as a metadata-free fallback", () => {
  const service = loadTelegramRendererService();
  const content = service.renderMessageContent({
    text: '<boatyard-topic id="71" name="espfly" />\nPlain response'
  });

  if (!content) {
    throw new Error("Expected plain Telegram content.");
  }
  assert.equal(content.tagName, "p");
  assert.equal(content.className, "telegram-message-text");
  assert.equal(content.textContent, "Plain response");
});

test("Telegram renderer does not create links for unsafe protocols", () => {
  const service = loadTelegramRendererService();
  const content = service.renderMessageContent({
    richContent: [
      {
        type: "paragraph",
        content: [{ text: "Unsafe link", href: "javascript:alert(1)" }]
      }
    ]
  });

  if (!content) {
    throw new Error("Expected rich Telegram content.");
  }
  assert.equal(findByTag(content, "a"), null);
  assert.equal(getText(content), "Unsafe link");
});

test("Telegram renderer displays inline choices as actionable button rows", () => {
  const openedUrls: string[] = [];
  const activated: unknown[] = [];
  const service = loadTelegramRendererService(openedUrls);
  const keyboard = service.renderMessageButtons({
    buttons: [
      [
        { column: 0, row: 0, text: "Single choice", type: "callback" },
        { column: 1, row: 0, text: "Multiple choice", type: "callback" }
      ],
      [
        { column: 0, row: 1, text: "Help", type: "url", url: "https://example.com/help" }
      ]
    ]
  }, (button) => {
    activated.push(button);
  });

  if (!keyboard) {
    throw new Error("Expected Telegram choice buttons.");
  }
  assert.equal(keyboard.className, "telegram-message-keyboard");
  assert.equal(findAllByClass(keyboard, "telegram-message-keyboard-row").length, 2);
  const choices = findAllByClass(keyboard, "telegram-message-choice");
  assert.deepEqual(choices.map((button) => button.textContent), ["Single choice", "Multiple choice", "Help"]);

  choices[0].trigger("click");
  assert.deepEqual(activated, [{ column: 0, row: 0, text: "Single choice", type: "callback" }]);
  choices[2].trigger("click");
  assert.deepEqual(openedUrls, ["https://example.com/help"]);
});

test("Telegram renderer merges live callback messages without waiting for history", () => {
  const service = loadTelegramRendererService();
  const initial = [
    { id: 10, text: "First" },
    { id: 11, text: "Pending" }
  ];

  assert.deepEqual(
    JSON.parse(JSON.stringify(service.mergeMessages(initial, { id: 11, text: "Updated" }))),
    [
      { id: 10, text: "First" },
      { id: 11, text: "Updated" }
    ]
  );
  assert.deepEqual(
    JSON.parse(JSON.stringify(service.mergeMessages(initial, { id: 12, text: "Live" }))),
    [
      { id: 10, text: "First" },
      { id: 11, text: "Pending" },
      { id: 12, text: "Live" }
    ]
  );
});

test("Telegram rich message styles include responsive tables and semantic blocks", () => {
  const styles = fs.readFileSync(`${process.cwd()}/src/plugins/telegram/style.css`, "utf8");
  const renderer = fs.readFileSync(`${process.cwd()}/src/plugins/telegram/renderer.ts`, "utf8");

  assert.match(styles, /\.telegram-rich-table-scroll\s*\{[\s\S]*overflow-x: auto;/);
  assert.match(styles, /\.telegram-rich-table\s*\{[\s\S]*border-collapse: collapse;/);
  assert.match(styles, /\.telegram-rich-blockquote\s*\{[\s\S]*border-left:/);
  assert.match(styles, /\.telegram-rich-list\s*\{/);
  assert.match(styles, /\.telegram-rich-link\s*\{[\s\S]*text-decoration: underline;/);
  assert.match(styles, /\.telegram-message-choice\s*\{[\s\S]*flex: 1 1 0;/);
  assert.doesNotMatch(styles, /\.telegram-message-media\s*\{/);
  assert.doesNotMatch(renderer, /textContent = "Attachment"/);
});

export {};
