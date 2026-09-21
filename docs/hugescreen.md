# Hugescreen experiment

Hugescreen pans the entire native Boatyard window, including the sidebar and
embedded web views. It does not zoom, resize, maximize, or restore window geometry.
Only the user changes the window size, using their window manager's controls.

- Hugescreen enables automatically at startup when the restored window, including
  its native decorations, is wider or taller than the screen work area. Maximized
  and fullscreen windows are excluded. Manual activation uses the same size rule;
  a window that fits the screen cannot enable Hugescreen. Every resize recalculates
  the mode: oversized enables it, fitting disables it.
- Double-tap **Ctrl** to enable pan; double-tap again to disable it. Release each
  press within 250 ms and start the second press within 350 ms of the first release.
  No key or mouse button needs to remain held.
- The **Hugescreen** button and **Ctrl+Shift+H** toggle the same pan lock. Its button
  shows **Hugescreen on** while enabled. **Escape** always reaches the editor or
  embedded page and never changes the pan lock.
- Move the mouse toward the target. The native window moves in the opposite
  direction. Motion is amplified as the pointer approaches the screen edge and
  as more window content remains off screen in that direction. Reaching the screen
  edge can reach a distant window edge in one sweep, even for a large window,
  subject to the dead zone and edge proximity rules below.
- Slow local movements use quarter-speed travel for precision. Sensitivity blends
  progressively into full edge amplification between 120 and 900 logical pixels
  per second. Within the final 30% of the screen toward an edge, amplification
  also returns progressively regardless of speed, avoiding a catch-up jump on arrival.
- After 160 ms without movement or a mouse click, a 30-pixel dead zone anchors
  around the pointer. Leaving it pans only by the excess movement, without a jump.
  Direction reversals require 6 pixels of travel to avoid small oscillations.
  A new movement reaching the screen boundary completes alignment even inside
  these thresholds; leaving the pointer stationary never triggers a correction.
- Once a native window edge aligns with the screen edge, panning away from that
  alignment is blocked while the pointer stays within 15% of the screen's width
  or height of that edge. Arrival at alignment remains allowed, including native
  decorations. The other axis remains independent.
- A stationary pointer never scrolls the window. Clicks, wheel events, and ordinary
  keyboard shortcuts still reach the page. Panning stays active while holding a
  mouse button, so dragging can reach targets initially outside the screen.
- Switching to another window pauses panning; returning resumes the existing lock
  without jumping. Enabling or disabling pan does not change window geometry.

Panning is bounded to the screen work area selected when enabling the mode. A
window larger than that area continues covering it; a smaller window stays within
it. Maximized and fullscreen windows are left untouched: unmaximize or leave
fullscreen yourself before panning. Resizing rebases the pointer and recalculates
the pan lock from the new dimensions.
On X11, the limits include the actual native decoration sizes reported by
`_NET_FRAME_EXTENTS` (read using `xprop`), converted to logical pixels for the
screen's scale. The measurement refreshes on focus and Ctrl presses, so changing
caption size or theme does not rely on a fixed-height allowance.

Mouse and keyboard observation happens in Electron's main process for both the
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

An isolated Electron/X11 run with a 1280×800 Xvfb display verifies the double-Ctrl
lock, real pointer movement over an embedded web view, and passing ordinary mouse
operations through while panning is enabled. Regression tests cover increased gain
near screen edges, remaining travel, reaching very distant window edges in one
sweep, panning during drags, and focus changes. Child-view bounds and zoom stay fixed.

A separate isolated instance on the desktop verified restoring a 5650×1840 window
at (-300, -200), without fullscreen or maximization, and returning the minimum size
to 640×480 afterward. These are functional checks, not a smoothness benchmark.
