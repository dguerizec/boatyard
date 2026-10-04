const { ipcMain } = require('electron');
const { execFileSync } = require('node:child_process');

module.exports = async win => {
  win.setBounds({ x: 0, y: 0, width: 900, height: 650 });
  win.show();
  win.focus();
  ipcMain.handle('kanban-test:drag', async (_, { start, end, steps = 5 }) => {
    const id = String(win.getNativeWindowHandle().readUInt32LE(0));
    const bounds = win.getBounds(), content = win.getContentBounds();
    const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
    const move = point => execFileSync('xdotool', ['mousemove', '--window', id,
      String(Math.round(point.x + content.x - bounds.x)), String(Math.round(point.y + content.y - bounds.y))]);
    move(start);
    await pause(40);
    execFileSync('xdotool', ['mousedown', '1']);
    let preview;
    try {
      await pause(40);
      for (let step = 1; step <= steps; step++) {
        move({ x: start.x + (end.x - start.x) * step / steps,
          y: start.y + (end.y - start.y) * step / steps });
        await pause(50);
      }
      // Release after a stationary hover, without an extra pointer movement.
      await pause(650);
      preview = await win.webContents.executeJavaScript(`(() => {
        const element = document.querySelector('.twicc-session-flow-insertion-placeholder');
        const rect = element?.getBoundingClientRect();
        return { visible: Boolean(rect?.height), lane: element?.closest('[data-lane]')?.dataset.lane,
          trustedDragovers: window.kanbanNativeEvents.dragover,
          rect: rect ? { top: rect.top, bottom: rect.bottom } : null };
      })()`);
    } finally {
      execFileSync('xdotool', ['mouseup', '1']);
    }
    await pause(150);
    return preview;
  });
};
