import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { BrowserWindow } from "electron";

const run = promisify(execFile);
export interface HugescreenEdgeDriver {
  unavailableReason(): Promise<string | null>;
  anchor(signal: AbortSignal): Promise<(point: { x: number; y: number }) => Promise<void>>;
}

function coordinates(output: string): { x: number; y: number } {
  const x = /^X=(-?\d+)$/m.exec(output);
  const y = /^Y=(-?\d+)$/m.exec(output);
  if (!x || !y) throw new Error("Could not read native pointer coordinates.");
  return { x: Number(x[1]), y: Number(y[1]) };
}

/** Use native window-relative pixels, including on scaled X11/XWayland displays. */
export function createHugescreenEdgeDriver(window: BrowserWindow): HugescreenEdgeDriver {
  const command = async (args: string[], signal?: AbortSignal) => (await run("xdotool", args, {
    signal, timeout: 1000, maxBuffer: 4096, env: { ...process.env, LC_ALL: "C" }
  })).stdout;
  const id = () => String(window.getNativeWindowHandle().readUInt32LE(0));
  return {
    async unavailableReason() {
      if (process.platform !== "linux" || !process.env.DISPLAY) {
        return "Edge steps require Linux with X11 or XWayland and xdotool.";
      }
      try {
        // Query our actual X window, not just DISPLAY: native Wayland must fail this probe.
        await command(["getwindowgeometry", "--shell", id()]);
        return null;
      } catch (error) {
        return (error as NodeJS.ErrnoException).code === "ENOENT"
          ? "Install xdotool to enable edge steps."
          : "Edge steps require X11 or XWayland. On Wayland, restart with --ozone-platform=x11.";
      }
    },
    async anchor(signal) {
      const windowId = id();
      const pointer = coordinates(await command(["getmouselocation", "--shell"], signal));
      const geometry = await command(["getwindowgeometry", "--shell", windowId], signal);
      const origin = coordinates(geometry);
      const bounds = window.getBounds();
      const nativeWidth = Number(/^WIDTH=(\d+)$/m.exec(geometry)?.[1]);
      const scale = nativeWidth / bounds.width;
      if (!Number.isFinite(scale) || scale <= 0) throw new Error("Could not read native window scale.");
      const x = String(pointer.x - origin.x);
      const y = String(pointer.y - origin.y);
      return async point => {
        // Move in native pixels without resizing. Electron setPosition can accumulate
        // size rounding on fractional scales. Wait for the WM before moving the pointer.
        const expected = { x: origin.x + (point.x - bounds.x) * scale,
          y: origin.y + (point.y - bounds.y) * scale };
        const deadline = performance.now() + 500;
        let actual = coordinates(await command(["windowmove", windowId,
          String(Math.round(expected.x)), String(Math.round(expected.y)),
          "getwindowgeometry", "--shell", windowId], signal));
        while (true) {
          if (Math.abs(actual.x - expected.x) <= 2 && Math.abs(actual.y - expected.y) <= 2) break;
          if (performance.now() >= deadline) throw new Error("Native window position did not settle.");
          await new Promise(resolve => setTimeout(resolve, 4));
          actual = coordinates(await command(["getwindowgeometry", "--shell", windowId], signal));
        }
        const target = { x: actual.x + Number(x), y: actual.y + Number(y) };
        let cursor = coordinates(await command(["mousemove", "--window", windowId, "--", x, y,
          "getmouselocation", "--shell"], signal));
        while (Math.abs(cursor.x - target.x) > 2 || Math.abs(cursor.y - target.y) > 2) {
          if (performance.now() >= deadline) throw new Error("Native pointer position did not settle.");
          await new Promise(resolve => setTimeout(resolve, 4));
          cursor = coordinates(await command(["getmouselocation", "--shell"], signal));
        }
      };
    }
  };
}
