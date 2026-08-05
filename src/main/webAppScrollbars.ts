import type { WebContents } from "electron";

type StyleableWebContents = Pick<WebContents, "insertCSS" | "isDestroyed">;

export const WEBAPP_DEFAULT_SCROLLBAR_CSS = `
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track,
::-webkit-scrollbar-corner {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background-color: rgba(127, 127, 127, 0.62);
  background-clip: content-box;
}

::-webkit-scrollbar-thumb:hover {
  background-color: rgba(127, 127, 127, 0.86);
}
`;

export async function applyDefaultWebAppScrollbarStyle(webContents: StyleableWebContents): Promise<boolean> {
  if (webContents.isDestroyed()) {
    return false;
  }

  try {
    // User-origin declarations replace browser defaults while author-origin page styles stay in control.
    await webContents.insertCSS(WEBAPP_DEFAULT_SCROLLBAR_CSS, { cssOrigin: "user" });
    return true;
  } catch {
    // Navigation can replace the document while the stylesheet is being inserted.
    return false;
  }
}
