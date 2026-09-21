import type { BrowserWindow, Rectangle } from "electron";

/** Large initial X11 windows can be clamped to the screen and auto-maximized. */
export function needsOversizedRestore(bounds: Rectangle, area: Rectangle, state: {
  isMaximized?: boolean; isFullScreen?: boolean;
}, platform = process.platform): boolean {
  return platform === "linux" && !state.isMaximized && !state.isFullScreen &&
    (bounds.width >= area.width || bounds.height >= area.height);
}

export function getOversizedBootstrapBounds(bounds: Rectangle, area: Rectangle): Rectangle {
  return {
    x: area.x + 50,
    y: area.y + 50,
    width: Math.min(bounds.width, Math.max(640, area.width - 100)),
    height: Math.min(bounds.height, Math.max(480, area.height - 100))
  };
}

/** Restore user-selected geometry after mapping, then release the temporary size hints. */
export async function restoreOversizedWindow(window: BrowserWindow, bounds: Rectangle): Promise<void> {
  const minimum = window.getMinimumSize();
  try {
    // Let the WM finish mapping the modest bootstrap window before setting large hints.
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (window.isDestroyed()) return;
    window.setMinimumSize(bounds.width, bounds.height);
    window.setBounds(bounds);
    await new Promise((resolve) => setTimeout(resolve, 150));
  } finally {
    if (!window.isDestroyed()) {
      window.setMinimumSize(minimum[0]!, minimum[1]!);
      window.setOpacity(1);
    }
  }
}
