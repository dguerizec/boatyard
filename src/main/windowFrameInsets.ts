import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";

export type WindowFrameInsets = { left: number; right: number; top: number; bottom: number };
export const NO_FRAME_INSETS: WindowFrameInsets = { left: 0, right: 0, top: 0, bottom: 0 };
const run = promisify(execFile);

export function parseX11FrameInsets(output: string, scaleFactor = 1): WindowFrameInsets | null {
  const match = output.match(/_NET_FRAME_EXTENTS\(CARDINAL\)\s*=\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+)/);
  if (!match) return null;
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  const values = match.slice(1).map((value) => Math.ceil(Number(value) / scale));
  if (values.some((value) => !Number.isFinite(value) || !Number.isSafeInteger(value))) return null;
  return { left: values[0]!, right: values[1]!, top: values[2]!, bottom: values[3]! };
}

/** Electron's Linux bounds exclude the window manager's server-side decoration. */
export async function readWindowFrameInsets(window: BrowserWindow, scaleFactor: number): Promise<WindowFrameInsets | null> {
  if (process.platform !== "linux" || window.isDestroyed()) return NO_FRAME_INSETS;
  try {
    const id = window.getNativeWindowHandle().readUInt32LE(0);
    const { stdout } = await run("xprop", ["-id", String(id), "_NET_FRAME_EXTENTS"], {
      timeout: 1000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" }
    });
    // No property is normal for an undecorated window or an X server without a WM.
    return parseX11FrameInsets(stdout, scaleFactor) || NO_FRAME_INSETS;
  } catch {
    return null;
  }
}
