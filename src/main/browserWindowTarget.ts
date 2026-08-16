type RendererTarget = {
  isDestroyed(): boolean;
  send(channel: string, ...args: unknown[]): void;
};

type BrowserWindowTarget<T extends RendererTarget> = {
  isDestroyed(): boolean;
  readonly webContents: T;
};

function getLiveWindowWebContents<T extends RendererTarget>(window: BrowserWindowTarget<T>): T | null {
  if (window.isDestroyed()) {
    return null;
  }

  const webContents = window.webContents;
  return webContents.isDestroyed() ? null : webContents;
}

export { getLiveWindowWebContents };
