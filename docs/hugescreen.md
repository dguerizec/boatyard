# Hugescreen experiment

Hugescreen pans the entire native Boatyard window, including the sidebar and
embedded web views. It does not zoom, resize, maximize, or restore window geometry.
Only the user changes the window size, using their window manager's controls.

- Toggle the **Hugescreen** button or press **Ctrl+Shift+H** in a workspace window.
- Tap **Ctrl**, release it, then press **Ctrl** again within 350 ms and hold it.
  The first tap must last no more than 250 ms. Move the mouse while holding the
  second press to move the window in the opposite direction, bringing the target
  toward the pointer; no mouse button is needed.
- Release **Ctrl**, press **Escape**, or switch to another window to stop panning.
  Escape does not change window geometry or disable Hugescreen.
- Toggle Hugescreen off to disable the gesture. This also leaves window geometry
  unchanged.

Panning is bounded to the screen work area selected when enabling the mode. A
window larger than that area continues covering it; a smaller window stays within
it. Maximized and fullscreen windows are left untouched: unmaximize or leave
fullscreen yourself before panning. Resizing cancels an ongoing pan.
On X11, the limits include the actual native decoration sizes reported by
`_NET_FRAME_EXTENTS` (read using `xprop`), converted to logical pixels for the
screen's scale. The measurement refreshes on focus and Ctrl presses, so changing
caption size or theme does not rely on a fixed-height allowance.

Mouse and keyboard interception happens in Electron's main process for both the
workspace renderer and its embedded web contents. During a pan only the native
parent's position changes. Child-view bounds and zoom factors are not updated.
Ordinary window-state persistence continues to save the user's actual geometry.

Native Wayland does not support Electron window positioning. On a Wayland desktop,
launch with `--ozone-platform=x11` to try XWayland. Window-manager size constraints,
shortcut handling, and rendering smoothness depend on the desktop environment.
See [Electron's positioning documentation](https://www.electronjs.org/docs/latest/api/browser-window#winsetpositionx-y-animate).

## Restart restoration

Window positions retain negative desktop coordinates. On Linux, normal windows
that fill or exceed the work area are restored after the native window has been
mapped. Temporary minimum-size hints prevent the window manager from clamping the
saved dimensions or automatically maximizing the window. These hints are then
released, so the user can freely resize it. Intermediate startup geometry is not
persisted. This restores the user's saved size; enabling Hugescreen never resizes
anything.

## Prototype validation

An isolated Electron/X11 run with a 1280×800 Xvfb display verified real Ctrl key
presses and mouse movement over an embedded web view, negative window positions,
stopping on release, and unchanged dimensions, child-view bounds, and zoom.
Electron's mouse interception events can omit modifiers; cancellation follows
keyboard release and window blur instead of treating missing modifiers as release.

A separate isolated instance on the desktop verified restoring a 5650×1840 window
at (-300, -200), without fullscreen or maximization, and returning the minimum size
to 640×480 afterward. These are functional checks, not a smoothness benchmark.
