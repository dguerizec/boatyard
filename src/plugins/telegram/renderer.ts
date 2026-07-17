"use strict";

(function registerTelegramPlugin(globalScope: BoatyardPluginRendererGlobal) {
  type TelegramProject = {
    id?: string;
    name?: string;
    slug?: string;
  };

  type TelegramConfig = {
    telegramBotUsername?: string;
    telegramChatId?: string;
    telegramChatTitle?: string;
    telegramDefaultChatId?: string;
    telegramDefaultChatTitle?: string;
    telegramThreadId?: string;
    telegramTopicTitle?: string;
    telegramTopicTopMessageId?: string;
  };

  type TelegramTarget = {
    botUsername: string;
    chatId: string;
    chatTitle: string;
    threadId: string;
    topicTitle: string;
    topicTopMessageId: string;
  };

  type TelegramStatus = {
    state?: string;
    summary?: string;
  };

  type TelegramMessage = {
    hasMedia?: boolean;
    id?: string | number;
    imagePreviewDataUrl?: string;
    isImage?: boolean;
    outgoing?: boolean;
    senderName?: string;
    sentAt?: string;
    text?: string;
  };

  type TelegramImageAttachment = {
    dataUrl: string;
    mimeType: string;
    name: string;
  };

  type TelegramUpdate = {
    chatId?: string;
    topicIds?: unknown[];
  };

  type TelegramConversationProps = {
    globalPluginConfig?: TelegramConfig;
    pluginConfig?: TelegramConfig;
    project?: TelegramProject;
    projectConfig?: TelegramConfig;
    projectId?: string;
  };

  type TelegramConversationOptions = {
    compact?: boolean;
  };

  type TelegramLoadOptions = {
    scrollToBottom?: boolean;
  };

  type TelegramRendererService = PluginRegistryRecord & {
    completeLoginCode(code: unknown): Promise<TelegramStatus>;
    completeLoginPassword(password: unknown): Promise<TelegramStatus>;
    getMessages(project: TelegramProject, options?: TelegramConversationProps): Promise<{
      messages?: TelegramMessage[];
      status?: TelegramStatus;
      target?: Partial<TelegramTarget>;
    }>;
    getMessageImage(project: TelegramProject, messageId: string | number, options?: TelegramConversationProps): Promise<{ dataUrl?: string }>;
    getStatus(options?: TelegramConversationProps): Promise<TelegramStatus>;
    getTarget(project?: TelegramProject, projectConfig?: TelegramConfig, globalConfig?: TelegramConfig): TelegramTarget;
    logout(): Promise<TelegramStatus>;
    onMessage(callback: (update: TelegramUpdate) => void): () => void;
    sendMessage(project: TelegramProject, text: string, image: TelegramImageAttachment | null, options?: TelegramConversationProps): Promise<unknown>;
    startLogin(globalConfig: TelegramConfig | undefined, phoneNumber: string): Promise<TelegramStatus>;
  };
  type TelegramSettingsFields = {
    setActionMessage(key: string, value: string): void;
    setDefaultValue(key: string, value: string): void;
  };
  type TelegramFieldContext = {
    fields: TelegramSettingsFields;
    project: TelegramProject;
  };
  type TelegramCoreFieldChangedEvent = {
    coreFields: TelegramProject;
    field: string;
    fields?: TelegramSettingsFields;
  };
  type TelegramGlobalSettingsOpenedEvent = {
    globalConfig?: TelegramConfig;
  };
  type TelegramPluginContext = PluginRegistryRecord & {
    events: {
      on<TEvent extends PluginRegistryRecord = PluginRegistryRecord>(eventName: string, callback: (event: TEvent) => void): void;
    };
    panes: {
      register(definition: Record<string, unknown>): void;
    };
    services: {
      provide(id: string, service: unknown): void;
    };
    settings: {
      registerGlobalSection(section: Record<string, unknown>): void;
      registerProjectSection(section: Record<string, unknown>): void;
    };
    status: {
      set(status: unknown): void;
    };
    widgets: {
      register(definition: Record<string, unknown>): void;
    };
  };

  const registry = globalScope.BoatyardPluginRegistry;

  if (!registry) {
    throw new Error("Plugin registry is unavailable.");
  }

  function invokePlugin(actionName: string, payload: Record<string, unknown> = {}) {
    return globalScope.boatyard?.invokePlugin?.("boatyard.telegram", actionName, payload);
  }

  function normalizeText(value: unknown) {
    return String(value || "").trim();
  }

  function stripTopicMetadataPrefix(text: unknown) {
    return String(text || "").replace(/^<boatyard-topic\b[^>]*\/>\s*\n?/, "").trim();
  }

  function getProjectTopicTitle(project: TelegramProject = {}, config: TelegramConfig = {}) {
    return normalizeText(config.telegramTopicTitle || project.slug || project.name);
  }

  function getTarget(project: TelegramProject = {}, projectConfig: TelegramConfig = {}, globalConfig: TelegramConfig = {}): TelegramTarget {
    return {
      chatId: normalizeText(projectConfig.telegramChatId || globalConfig.telegramDefaultChatId),
      threadId: normalizeText(projectConfig.telegramThreadId),
      topicTopMessageId: normalizeText(projectConfig.telegramTopicTopMessageId),
      topicTitle: getProjectTopicTitle(project, projectConfig),
      chatTitle: normalizeText(projectConfig.telegramChatTitle || globalConfig.telegramDefaultChatTitle),
      botUsername: normalizeText(projectConfig.telegramBotUsername || globalConfig.telegramBotUsername)
    };
  }

  function getTargetLabel(target: Partial<TelegramTarget> = {}) {
    const topic = normalizeText(target.topicTitle);
    const chat = normalizeText(target.chatTitle || target.chatId);
    if (chat && topic) {
      return `${chat} / ${topic}`;
    }
    return topic || chat || "No Telegram topic";
  }

  function getTelegramWebLink(target: Partial<TelegramTarget> = {}) {
    const chatId = normalizeText(target.chatId);
    const threadId = normalizeText(target.threadId);
    if (!chatId) {
      return "";
    }

    if (chatId.startsWith("@")) {
      return `https://t.me/${encodeURIComponent(chatId.slice(1))}${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;
    }

    const supergroupMatch = chatId.match(/^-100(\d+)$/);
    if (supergroupMatch) {
      return `https://t.me/c/${supergroupMatch[1]}${threadId ? `/${encodeURIComponent(threadId)}` : ""}`;
    }

    return "";
  }

  function isNumericTelegramChatId(value: unknown) {
    return /^-?\d+$/.test(normalizeText(value));
  }

  function doesTelegramUpdateMatchTarget(update: TelegramUpdate = {}, target: Partial<TelegramTarget> = {}) {
    const updateChatId = normalizeText(update.chatId);
    const targetChatId = normalizeText(target.chatId);
    if (targetChatId && isNumericTelegramChatId(targetChatId) && updateChatId !== targetChatId) {
      return false;
    }

    const targetTopicIds = new Set([
      normalizeText(target.threadId),
      normalizeText(target.topicTopMessageId)
    ].filter(Boolean));
    if (!targetTopicIds.size) {
      return !targetChatId || !isNumericTelegramChatId(targetChatId) || updateChatId === targetChatId;
    }

    return Array.isArray(update.topicIds) && update.topicIds.some((id) => targetTopicIds.has(normalizeText(id)));
  }

  function createTelegramService(): TelegramRendererService {
    return Object.freeze({
      version: "0.1.0",
      getTarget,
      getWebLink: getTelegramWebLink,
      async getStatus(options: TelegramConversationProps = {}) {
        if (!globalScope.boatyard?.invokePlugin) {
          return {
            state: "unavailable",
            summary: "Telegram IPC bridge is unavailable."
          };
        }
        return await invokePlugin("status", { globalConfig: options.globalPluginConfig || {} }) as TelegramStatus;
      },
      async getMessages(project: TelegramProject, options: TelegramConversationProps = {}) {
        const target = getTarget(project, options.pluginConfig, options.globalPluginConfig);
        if (!globalScope.boatyard?.invokePlugin) {
          return {
            status: {
              state: "unavailable",
              summary: "Telegram IPC bridge is unavailable."
            },
            target,
            messages: []
          };
        }
        return await invokePlugin("messages", { target, globalConfig: options.globalPluginConfig || {} }) as Awaited<ReturnType<TelegramRendererService["getMessages"]>>;
      },
      async getMessageImage(project: TelegramProject, messageId: string | number, options: TelegramConversationProps = {}) {
        const target = getTarget(project, options.pluginConfig, options.globalPluginConfig);
        return await invokePlugin("messageImage", {
          target,
          messageId,
          globalConfig: options.globalPluginConfig || {}
        }) as { dataUrl?: string };
      },
      async sendMessage(project: TelegramProject, text: string, image: TelegramImageAttachment | null, options: TelegramConversationProps = {}) {
        const target = getTarget(project, options.pluginConfig, options.globalPluginConfig);
        return invokePlugin("sendMessage", { target, text, image, globalConfig: options.globalPluginConfig || {} });
      },
      async startLogin(globalConfig: TelegramConfig | undefined, phoneNumber: string) {
        return await invokePlugin("startLogin", { globalConfig: globalConfig || {}, phoneNumber }) as TelegramStatus;
      },
      async completeLoginCode(code: unknown) {
        return await invokePlugin("completeLoginCode", { code }) as TelegramStatus;
      },
      async completeLoginPassword(password: unknown) {
        return await invokePlugin("completeLoginPassword", { password }) as TelegramStatus;
      },
      async logout() {
        return await invokePlugin("logout") as TelegramStatus;
      },
      onMessage(callback: (update: TelegramUpdate) => void) {
        return globalScope.boatyard?.onPluginEvent?.("boatyard.telegram", "message", (payload: unknown) => {
          callback(payload as TelegramUpdate);
        }) || (() => {});
      },
      openTelegram(target: Partial<TelegramTarget> = {}) {
        const link = getTelegramWebLink(target);
        return link ? globalScope.boatyard?.openExternal?.(link) : null;
      }
    });
  }

  function setStatusText(element: HTMLElement, status: TelegramStatus = {}) {
    const summary = status.summary || status.state || "Telegram status unavailable.";
    element.className = `telegram-status-indicator ${status.state || "unknown"}`;
    element.title = summary;
    element.setAttribute("aria-label", summary);
  }

  function renderMessages(list: HTMLElement, messages: TelegramMessage[] = [], openImage?: (message: TelegramMessage) => void) {
    list.replaceChildren();
    if (!messages.length) {
      const empty = document.createElement("p");
      empty.className = "telegram-empty";
      empty.textContent = "No synced messages yet.";
      list.append(empty);
      return;
    }

    for (const message of messages) {
      const row = document.createElement("article");
      row.className = `telegram-message ${message.outgoing ? "outgoing" : "incoming"}`;

      const meta = document.createElement("div");
      meta.className = "telegram-message-meta";
      meta.textContent = [message.senderName, message.sentAt].map(normalizeText).filter(Boolean).join(" - ");
      row.append(meta);

      if (message.isImage && message.id !== undefined) {
        const imageButton = document.createElement("button");
        imageButton.type = "button";
        imageButton.className = "telegram-message-image";
        imageButton.title = "View image";
        imageButton.setAttribute("aria-label", "View image");
        if (message.imagePreviewDataUrl) {
          const image = document.createElement("img");
          image.src = message.imagePreviewDataUrl;
          image.alt = "Telegram image";
          imageButton.append(image);
        } else {
          imageButton.textContent = "Image";
        }
        imageButton.addEventListener("click", () => openImage?.(message));
        row.append(imageButton);
      } else if (message.hasMedia) {
        const media = document.createElement("div");
        media.className = "telegram-message-media";
        media.textContent = message.isImage ? "Image" : "Attachment";
        row.append(media);
      }

      const body = document.createElement("p");
      body.textContent = stripTopicMetadataPrefix(message.text);
      if (body.textContent) {
        row.append(body);
      }
      list.append(row);
    }
  }

  async function persistResolvedTarget(props: TelegramConversationProps = {}, target: Partial<TelegramTarget> = {}) {
    const threadId = normalizeText(target.threadId);
    const topicTopMessageId = normalizeText(target.topicTopMessageId);
    const currentConfig = props.projectConfig || props.pluginConfig || {};
    const hasUnchangedResolvedTarget =
      normalizeText(currentConfig.telegramThreadId) === threadId &&
      normalizeText(currentConfig.telegramTopicTopMessageId) === topicTopMessageId;
    if (
      !props.projectId ||
      !threadId ||
      hasUnchangedResolvedTarget ||
      !globalScope.boatyard?.updateProjectPluginConfig
    ) {
      return;
    }

    const nextConfig = {
      ...currentConfig,
      telegramThreadId: threadId,
      telegramTopicTopMessageId: topicTopMessageId,
      telegramTopicTitle: target.topicTitle || currentConfig.telegramTopicTitle || ""
    };
    props.projectConfig = nextConfig;
    props.pluginConfig = nextConfig;

    await globalScope.boatyard.updateProjectPluginConfig(props.projectId, "boatyard.telegram", {
      telegramThreadId: threadId,
      telegramTopicTopMessageId: topicTopMessageId,
      telegramTopicTitle: nextConfig.telegramTopicTitle
    });
  }

  function cleanupWhenRemoved(element: HTMLElement, cleanup: unknown) {
    if (typeof cleanup !== "function" || typeof globalScope.MutationObserver !== "function" || !document.body) {
      return;
    }

    const observer = new globalScope.MutationObserver(() => {
      if (element.isConnected) {
        return;
      }

      cleanup();
      observer.disconnect();
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function getComposerLineHeight(input: HTMLElement) {
    const styles = globalScope.getComputedStyle?.(input);
    const lineHeight = Number.parseFloat(styles?.lineHeight || "");
    if (Number.isFinite(lineHeight) && lineHeight > 0) {
      return lineHeight;
    }

    const fontSize = Number.parseFloat(styles?.fontSize || "");
    return Number.isFinite(fontSize) && fontSize > 0 ? fontSize * 1.45 : 22;
  }

  function resizeComposerInput(input: HTMLTextAreaElement, maxLines = 8) {
    const styles = globalScope.getComputedStyle?.(input);
    const verticalPadding =
      Number.parseFloat(styles?.paddingTop || "0") +
      Number.parseFloat(styles?.paddingBottom || "0");
    const verticalBorder =
      Number.parseFloat(styles?.borderTopWidth || "0") +
      Number.parseFloat(styles?.borderBottomWidth || "0");
    const maxHeight = Math.ceil(getComposerLineHeight(input) * maxLines + verticalPadding + verticalBorder);

    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight + verticalBorder, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight + verticalBorder > maxHeight ? "auto" : "hidden";
  }

  function getImageFileExtension(mimeType: string) {
    return {
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp"
    }[mimeType] || "png";
  }

  function readImageAttachment(file: File, mimeType: string): Promise<TelegramImageAttachment> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.addEventListener("error", () => reject(reader.error || new Error("Could not read the pasted image.")));
      reader.addEventListener("load", () => {
        const dataUrl = typeof reader.result === "string" ? reader.result : "";
        if (!dataUrl.startsWith("data:image/")) {
          reject(new Error("The pasted clipboard item is not an image."));
          return;
        }

        resolve({
          dataUrl,
          mimeType,
          name: file.name || `pasted-image.${getImageFileExtension(mimeType)}`
        });
      });
      reader.readAsDataURL(file);
    });
  }

  function createTelegramConversation(container: HTMLElement, props: TelegramConversationProps = {}, service: TelegramRendererService, options: TelegramConversationOptions = {}) {
    const project = props.project || {};
    const target = service.getTarget(project, props.projectConfig || props.pluginConfig, props.globalPluginConfig);
    const compact = options.compact === true;

    const shell = document.createElement("section");
    shell.className = compact ? "telegram-conversation telegram-widget-conversation" : "telegram-conversation telegram-pane";

    const header = document.createElement("header");
    header.className = compact ? "telegram-widget-header" : "telegram-pane-header";

    const titleWrap = document.createElement("div");
    if (compact) {
      titleWrap.className = "telegram-widget-title";
    }
    const kicker = document.createElement("p");
    kicker.className = "kicker";
    kicker.textContent = "Telegram";
    const title = document.createElement("h3");
    title.textContent = getTargetLabel(target);
    titleWrap.append(kicker, title);

    const actions = document.createElement("div");
    actions.className = "telegram-pane-actions";

    const refreshButton = document.createElement("button");
    refreshButton.type = "button";
    refreshButton.className = compact ? "telegram-widget-button" : "secondary-button";
    refreshButton.textContent = "Refresh";
    const status = document.createElement("span");
    status.className = "telegram-status-indicator";
    status.title = "Loading Telegram status.";
    status.setAttribute("aria-label", "Loading Telegram status.");
    status.setAttribute("role", "status");
    actions.append(status, refreshButton);
    header.append(titleWrap, actions);

    const auth = document.createElement("form");
    auth.className = "telegram-auth";
    const phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.autocomplete = "tel";
    phoneInput.placeholder = "+15551234567";
    phoneInput.setAttribute("aria-label", "Telegram phone number");
    const startLoginButton = document.createElement("button");
    startLoginButton.type = "button";
    startLoginButton.textContent = "Send code";

    const codeInput = document.createElement("input");
    codeInput.type = "text";
    codeInput.inputMode = "numeric";
    codeInput.autocomplete = "one-time-code";
    codeInput.placeholder = "Login code";
    codeInput.setAttribute("aria-label", "Telegram login code");
    const codeButton = document.createElement("button");
    codeButton.type = "button";
    codeButton.textContent = "Confirm";

    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.placeholder = "2FA password";
    passwordInput.setAttribute("aria-label", "Telegram 2FA password");
    const passwordButton = document.createElement("button");
    passwordButton.type = "button";
    passwordButton.textContent = "Unlock";

    const phoneRow = document.createElement("div");
    phoneRow.className = "telegram-auth-row";
    phoneRow.append(phoneInput, startLoginButton);
    const codeRow = document.createElement("div");
    codeRow.className = "telegram-auth-row";
    codeRow.append(codeInput, codeButton);
    const passwordRow = document.createElement("div");
    passwordRow.className = "telegram-auth-row";
    passwordRow.append(passwordInput, passwordButton);
    auth.append(phoneRow, codeRow, passwordRow);

    const list = document.createElement("div");
    list.className = "telegram-message-list";

    const form = document.createElement("form");
    form.className = "telegram-composer";
    const composerInput = document.createElement("div");
    composerInput.className = "telegram-composer-input";
    const attachmentPreview = document.createElement("div");
    attachmentPreview.className = "telegram-composer-attachment";
    attachmentPreview.hidden = true;
    const attachmentImage = document.createElement("img");
    attachmentImage.alt = "Pasted image";
    const removeAttachmentButton = document.createElement("button");
    removeAttachmentButton.type = "button";
    removeAttachmentButton.className = "telegram-composer-remove-attachment";
    removeAttachmentButton.textContent = "Remove image";
    removeAttachmentButton.title = "Remove pasted image";
    attachmentPreview.append(attachmentImage, removeAttachmentButton);
    const input = document.createElement("textarea");
    input.rows = 1;
    input.placeholder = `Message ${target.botUsername ? `@${target.botUsername.replace(/^@/, "")}` : "TARS"}`;
    const sendButton = document.createElement("button");
    sendButton.type = "submit";
    sendButton.textContent = "Send";
    composerInput.append(attachmentPreview, input);
    form.append(composerInput, sendButton);
    resizeComposerInput(input);
    let pastedImage: TelegramImageAttachment | null = null;

    function clearPastedImage() {
      pastedImage = null;
      attachmentImage.removeAttribute("src");
      attachmentPreview.hidden = true;
    }

    function showPastedImage(image: TelegramImageAttachment) {
      pastedImage = image;
      attachmentImage.src = image.dataUrl;
      attachmentPreview.hidden = false;
    }

    function updateAuthState(state: TelegramStatus) {
      const phase = state?.state || "";
      const shouldShowAuth = ["authenticating", "notAuthenticated", "codeRequired", "passwordRequired", "ready"].includes(phase);
      auth.hidden = phase === "ready" || !shouldShowAuth;
      phoneRow.hidden = phase === "codeRequired" || phase === "passwordRequired";
      if (phase === "ready") {
        phoneRow.hidden = true;
      }
      codeRow.hidden = phase !== "codeRequired";
      passwordRow.hidden = phase !== "passwordRequired";
      form.hidden = phase !== "ready";
    }

    function showImagePreview(message: TelegramMessage) {
      if (message.id === undefined) {
        return;
      }

      function openDialog(dataUrl: string) {
        const dialog = document.createElement("dialog");
        dialog.className = "telegram-image-dialog";
        const panel = document.createElement("div");
        panel.className = "telegram-image-dialog-panel";
        const image = document.createElement("img");
        image.src = dataUrl;
        image.alt = "Telegram image";
        const closeButton = document.createElement("button");
        closeButton.type = "button";
        closeButton.className = "secondary-button";
        closeButton.textContent = "Close";
        closeButton.addEventListener("click", () => dialog.close());
        dialog.addEventListener("cancel", (event) => {
          event.preventDefault();
          dialog.close();
        });
        panel.append(image, closeButton);
        dialog.append(panel);

        if (typeof globalScope.BoatyardOverlayDialog?.show === "function") {
          void globalScope.BoatyardOverlayDialog.show(dialog, {
            freeze: "overlap",
            freezeMargin: 16,
            removeOnClose: true
          });
        } else {
          document.body.append(dialog);
          dialog.showModal();
        }

        return { dialog, image };
      }

      if (!message.imagePreviewDataUrl) {
        void service.getMessageImage(project, message.id, props).then((result) => {
          const dataUrl = normalizeText(result?.dataUrl);
          if (dataUrl) {
            openDialog(dataUrl);
          }
        }).catch((error) => {
          setStatusText(status, {
            state: "error",
            summary: (error as Error).message
          });
        });
        return;
      }

      const { dialog, image } = openDialog(message.imagePreviewDataUrl);

      void service.getMessageImage(project, message.id, props).then((result) => {
        const dataUrl = normalizeText(result?.dataUrl);
        if (dataUrl && dialog.open) {
          image.src = dataUrl;
        }
      }).catch((error) => {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      });
    }

    function isScrolledToBottom(element: HTMLElement) {
      return element.scrollHeight - element.scrollTop - element.clientHeight < 24;
    }

    async function load(options: TelegramLoadOptions = {}) {
      const shouldScrollToBottom = options.scrollToBottom === true || isScrolledToBottom(list);
      const previousScrollTop = list.scrollTop;
      refreshButton.disabled = true;
      try {
        const data = await service.getMessages(project, props);
        await persistResolvedTarget(props, data.target);
        setStatusText(status, data.status || {});
        updateAuthState(data.status || {});
        renderMessages(list, data.messages, showImagePreview);
        list.scrollTop = shouldScrollToBottom ? list.scrollHeight : previousScrollTop;
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      } finally {
        refreshButton.disabled = false;
      }
    }

    refreshButton.addEventListener("click", () => load());
    startLoginButton.addEventListener("click", async () => {
      startLoginButton.disabled = true;
      try {
        const nextStatus = await service.startLogin(props.globalPluginConfig, phoneInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      } finally {
        startLoginButton.disabled = false;
      }
    });
    codeButton.addEventListener("click", async () => {
      codeButton.disabled = true;
      try {
        const nextStatus = await service.completeLoginCode(codeInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
        if (nextStatus.state === "ready") {
          await load();
        }
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      } finally {
        codeButton.disabled = false;
      }
    });
    passwordButton.addEventListener("click", async () => {
      passwordButton.disabled = true;
      try {
        const nextStatus = await service.completeLoginPassword(passwordInput.value);
        setStatusText(status, nextStatus);
        updateAuthState(nextStatus);
        if (nextStatus.state === "ready") {
          await load();
        }
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      } finally {
        passwordButton.disabled = false;
      }
    });
    input.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) {
        return;
      }

      event.preventDefault();
      if (typeof form.requestSubmit === "function") {
        form.requestSubmit();
      } else {
        sendButton.click();
      }
    });
    input.addEventListener("input", () => resizeComposerInput(input));
    input.addEventListener("paste", async (event) => {
      const clipboardItems = [...(event.clipboardData?.items || [])];
      const imageItem = clipboardItems.find((item) => /^image\/(gif|jpeg|png|webp)$/i.test(item.type));
      const imageFile = imageItem?.getAsFile();
      if (!imageItem || !imageFile) {
        return;
      }

      event.preventDefault();
      try {
        showPastedImage(await readImageAttachment(imageFile, imageItem.type.toLowerCase()));
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      }
    });
    removeAttachmentButton.addEventListener("click", clearPastedImage);
    form.addEventListener("submit", async (event: SubmitEvent) => {
      event.preventDefault();
      const text = normalizeText(input.value);
      const image = pastedImage;
      if (!text && !image) {
        return;
      }

      sendButton.disabled = true;
      removeAttachmentButton.disabled = true;
      try {
        await service.sendMessage(project, text, image, props);
        input.value = "";
        clearPastedImage();
        resizeComposerInput(input);
        await load({ scrollToBottom: true });
      } catch (error) {
        setStatusText(status, {
          state: "error",
          summary: (error as Error).message
        });
      } finally {
        sendButton.disabled = false;
        removeAttachmentButton.disabled = false;
      }
    });

    shell.append(header, auth, list, form);
    container.append(shell);
    load();

    const unsubscribeTelegramMessage = service.onMessage((update: TelegramUpdate) => {
      if (!shell.isConnected) {
        unsubscribeTelegramMessage();
        return;
      }
      if (doesTelegramUpdateMatchTarget(update, service.getTarget(project, props.projectConfig || props.pluginConfig, props.globalPluginConfig))) {
        load();
      }
    });

    return unsubscribeTelegramMessage;
  }

  function createTelegramPane(container: HTMLElement, props: TelegramConversationProps = {}, service: TelegramRendererService) {
    return createTelegramConversation(container, props, service);
  }

  function createTelegramWidget(_project: TelegramProject, props: TelegramConversationProps = {}, service: TelegramRendererService) {
    const card = document.createElement("article");
    card.className = "widget-card telegram-widget";

    const content = document.createElement("div");
    content.className = "widget-content telegram-widget-content";
    card.append(content);
    cleanupWhenRemoved(card, createTelegramConversation(content, props, service, { compact: true }));
    return card;
  }

  function syncProjectTopicField(event: TelegramCoreFieldChangedEvent) {
    if (!["slug", "name"].includes(event.field)) {
      return;
    }

    event.fields?.setDefaultValue("telegramTopicTitle", getProjectTopicTitle(event.coreFields));
  }

  async function refreshTelegramStatus(ctx: TelegramPluginContext, globalConfig: TelegramConfig = {}) {
    const service = registry.getService<TelegramRendererService>("boatyard.telegram");
    if (!service) {
      return;
    }

    ctx.status.set(await service.getStatus({ globalPluginConfig: globalConfig }));
  }

  registry.register(
    {
      id: "boatyard.telegram",
      name: "Telegram",
      version: "0.1.0",
      apiVersion: "0.1",
      contributes: {
        widgets: ["boatyard.telegram.topic"],
        panes: ["boatyard.telegram.pane"],
        globalSettings: ["boatyard.telegram.global"],
        projectSettings: ["boatyard.telegram.project"],
        services: ["boatyard.telegram"]
      },
      permissions: [
        "projectConfig:read",
        "projectConfig:write",
        "pane:dom",
        "widget:provide",
        "service:provide"
      ]
    },
    {
      activate(ctx: TelegramPluginContext) {
        const service = createTelegramService();
        ctx.services.provide("boatyard.telegram", service);
        ctx.events.on("boatyard.projectForm.coreFieldChanged", syncProjectTopicField);
        ctx.events.on("boatyard.globalSettings.opened", (event: unknown) => {
          refreshTelegramStatus(ctx, (event as TelegramGlobalSettingsOpenedEvent).globalConfig || {});
        });

        ctx.status.set({
          state: "activating",
          summary: "Checking Telegram client configuration."
        });
        refreshTelegramStatus(ctx);

        ctx.settings.registerGlobalSection({
          id: "boatyard.telegram.global",
          title: "Telegram",
          fields: [
            {
              key: "telegramApiId",
              label: "Telegram API ID",
              type: "text",
              valueType: "text",
              placeholder: "123456"
            },
            {
              key: "telegramApiHash",
              label: "Telegram API hash",
              type: "password",
              valueType: "text"
            },
            {
              key: "telegramDefaultChatId",
              label: "Default project chat ID",
              type: "text",
              valueType: "text",
              placeholder: "-1001234567890"
            },
            {
              key: "telegramDefaultChatTitle",
              label: "Default chat title",
              type: "text",
              valueType: "text",
              placeholder: "TARS projects"
            },
            {
              key: "telegramBotUsername",
              label: "TARS bot username",
              type: "text",
              valueType: "text",
              placeholder: "tars_bot"
            },
            {
              key: "telegramSession",
              label: "Telegram session",
              type: "text",
              valueType: "text",
              readOnly: true,
              persist: false,
              defaultValue: "Stored locally for this OS user",
              action: {
                hidden: false,
                label: "Logout",
                pendingLabel: "Logging out...",
                message: "Disconnect the Telegram user session.",
                async run({ fields }: Pick<TelegramFieldContext, "fields">) {
                  const nextStatus = await service.logout();
                  ctx.status.set(nextStatus);
                  fields.setActionMessage("telegramSession", "Telegram user is logged out.");
                }
              }
            }
          ]
        });

        ctx.settings.registerProjectSection({
          id: "boatyard.telegram.project",
          title: "Telegram",
          fields: [
            {
              key: "telegramChatId",
              label: "Telegram chat ID",
              type: "text",
              valueType: "text",
              placeholder: "Use global default"
            },
            {
              key: "telegramThreadId",
              label: "Telegram topic ID",
              type: "text",
              valueType: "text",
              placeholder: "message_thread_id"
            },
            {
              key: "telegramTopicTitle",
              label: "Telegram topic title",
              type: "text",
              valueType: "text",
              defaultValue({ project }: Pick<TelegramFieldContext, "project">) {
                return getProjectTopicTitle(project);
              }
            },
            {
              key: "telegramChatTitle",
              label: "Telegram chat title",
              type: "text",
              valueType: "text",
              placeholder: "Use global default"
            }
          ]
        });

        ctx.panes.register({
          id: "boatyard.telegram.pane",
          webAppId: "telegram",
          key: "telegram",
          title: "Telegram",
          kind: "dom",
          scope: "project",
          render(container: HTMLElement, props: TelegramConversationProps) {
            return createTelegramPane(container, props, service);
          }
        });

        ctx.widgets.register({
          id: "boatyard.telegram.topic",
          name: "Telegram",
          title: "Telegram",
          scope: "project",
          category: "Communication",
          status: "experimental",
          defaultVisible: false,
          description: "Shows the Telegram project topic connected to the TARS bot.",
          layout: {
            default: { columns: 4, rows: 4 },
            min: { columns: 3, rows: 3 }
          },
          createElement(project: TelegramProject, props: TelegramConversationProps = {}) {
            return createTelegramWidget(project, props, service);
          }
        });
      }
    }
  );
})(window);
