import type {
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents as ElectronWebContents
} from "electron";

const { app, clipboard, Menu, nativeImage } = require("electron");

type WebAppContextMenuOptions = {
  getSourceKey: (webContents: ElectronWebContents) => string;
  openExternalUrl: (url: unknown) => unknown;
  sendOpenUrlRequest: (sourceWebAppKey: unknown, url: unknown, source: string) => boolean;
};

type ImageContext = {
  copyFromPoint: boolean;
  srcURL: string;
};

function normalizeImageUrl(url: unknown) {
  return String(url || "").trim();
}

async function getDomImageUrl(webContents: ElectronWebContents, params: ContextMenuParams): Promise<string> {
  if (webContents.isDestroyed()) {
    return "";
  }

  try {
    const result = await webContents.executeJavaScript(`(() => {
      const start = document.elementFromPoint(${JSON.stringify(params.x)}, ${JSON.stringify(params.y)});
      const absoluteUrl = (value) => {
        const raw = String(value || "").trim();
        if (!raw || raw === "none") {
          return "";
        }
        try {
          return new URL(raw, document.baseURI).href;
        } catch {
          return "";
        }
      };
      const cssUrl = (value) => {
        const match = String(value || "").match(/url\\((?:"([^"]*)"|'([^']*)'|([^)]*))\\)/);
        return absoluteUrl(match?.[1] || match?.[2] || match?.[3] || "");
      };
      const parentOf = (element) => element?.parentElement || element?.getRootNode?.()?.host || null;
      for (let element = start; element; element = parentOf(element)) {
        if (element instanceof HTMLImageElement) {
          const url = absoluteUrl(element.currentSrc || element.src);
          if (url) {
            return url;
          }
        }
        if (element instanceof HTMLInputElement && element.type === "image") {
          const url = absoluteUrl(element.src);
          if (url) {
            return url;
          }
        }
        if (element instanceof SVGImageElement) {
          const url = absoluteUrl(element.href?.baseVal || element.getAttribute("href"));
          if (url) {
            return url;
          }
        }
        if (element instanceof HTMLVideoElement) {
          const url = absoluteUrl(element.poster);
          if (url) {
            return url;
          }
        }
        for (const pseudo of ["", "::before", "::after"]) {
          const url = cssUrl(getComputedStyle(element, pseudo).backgroundImage);
          if (url) {
            return url;
          }
        }
      }
      return "";
    })()`, true);
    return normalizeImageUrl(result);
  } catch {
    return "";
  }
}

async function getImageContext(webContents: ElectronWebContents, params: ContextMenuParams): Promise<ImageContext | null> {
  const srcURL = normalizeImageUrl(params.srcURL);
  if (params.mediaType === "image" && srcURL) {
    return {
      copyFromPoint: true,
      srcURL
    };
  }

  const domImageUrl = await getDomImageUrl(webContents, params);
  return domImageUrl
    ? {
        copyFromPoint: false,
        srcURL: domImageUrl
      }
    : null;
}

async function copyImageFromUrl(webContents: ElectronWebContents, srcURL: string) {
  if (srcURL.startsWith("data:")) {
    const image = nativeImage.createFromDataURL(srcURL);
    if (!image.isEmpty()) {
      clipboard.writeImage(image);
    }
    return;
  }

  const response = await webContents.session.fetch(srcURL);
  if (!response.ok) {
    return;
  }

  const image = nativeImage.createFromBuffer(Buffer.from(await response.arrayBuffer()));
  if (!image.isEmpty()) {
    clipboard.writeImage(image);
  }
}

export async function createWebAppContextMenu(
  webContents: ElectronWebContents,
  params: ContextMenuParams,
  {
    getSourceKey,
    openExternalUrl,
    sendOpenUrlRequest
  }: WebAppContextMenuOptions
) {
  const template: MenuItemConstructorOptions[] = [];
  const imageContext = await getImageContext(webContents, params);

  if (params.isEditable) {
    template.push(
      { role: "undo", enabled: params.editFlags?.canUndo },
      { role: "redo", enabled: params.editFlags?.canRedo },
      { type: "separator" },
      { role: "cut", enabled: params.editFlags?.canCut },
      { role: "copy", enabled: params.editFlags?.canCopy },
      { role: "paste", enabled: params.editFlags?.canPaste },
      { role: "delete", enabled: params.editFlags?.canDelete },
      { type: "separator" },
      { role: "selectAll", enabled: params.editFlags?.canSelectAll }
    );
  } else if (params.selectionText) {
    template.push({ role: "copy" });
  }

  if (imageContext) {
    if (template.length) {
      template.push({ type: "separator" });
    }
    template.push(
      {
        label: "Open image with...",
        click: () => {
          if (!sendOpenUrlRequest(getSourceKey(webContents), imageContext.srcURL, "context-menu")) {
            openExternalUrl(imageContext.srcURL);
          }
        }
      },
      {
        label: "Open image in browser",
        click: () => openExternalUrl(imageContext.srcURL)
      },
      {
        label: "Copy image",
        click: () => {
          if (imageContext.copyFromPoint) {
            webContents.copyImageAt(params.x, params.y);
          } else {
            void copyImageFromUrl(webContents, imageContext.srcURL).catch(() => undefined);
          }
        }
      },
      {
        label: "Copy image address",
        click: () => clipboard.writeText(imageContext.srcURL)
      }
    );
  }

  if (params.linkURL) {
    if (template.length) {
      template.push({ type: "separator" });
    }
    template.push(
      {
        label: "Open with...",
        click: () => {
          if (!sendOpenUrlRequest(getSourceKey(webContents), params.linkURL, "context-menu")) {
            openExternalUrl(params.linkURL);
          }
        }
      },
      {
        label: "Open link in browser",
        click: () => openExternalUrl(params.linkURL)
      },
      {
        label: "Copy link address",
        click: () => clipboard.writeText(params.linkURL)
      }
    );
  }

  if (template.length) {
    template.push({ type: "separator" });
  }

  template.push(
    {
      label: "Back",
      enabled: webContents.canGoBack(),
      click: () => webContents.goBack()
    },
    {
      label: "Forward",
      enabled: webContents.canGoForward(),
      click: () => webContents.goForward()
    },
    {
      label: "Reload",
      click: () => webContents.reload()
    }
  );

  if (!app.isPackaged) {
    template.push(
      { type: "separator" },
      {
        label: "Inspect element",
        click: () => webContents.inspectElement(params.x, params.y)
      }
    );
  }

  return Menu.buildFromTemplate(template);
}
