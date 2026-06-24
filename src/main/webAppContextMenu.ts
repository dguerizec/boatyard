import type {
  ContextMenuParams,
  MenuItemConstructorOptions,
  WebContents as ElectronWebContents
} from "electron";

const { app, clipboard, Menu } = require("electron");

type WebAppContextMenuOptions = {
  getSourceKey: (webContents: ElectronWebContents) => string;
  openExternalUrl: (url: unknown) => unknown;
  sendOpenUrlRequest: (sourceWebAppKey: unknown, url: unknown, source: string) => boolean;
};

export function createWebAppContextMenu(
  webContents: ElectronWebContents,
  params: ContextMenuParams,
  {
    getSourceKey,
    openExternalUrl,
    sendOpenUrlRequest
  }: WebAppContextMenuOptions
) {
  const template: MenuItemConstructorOptions[] = [];

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
