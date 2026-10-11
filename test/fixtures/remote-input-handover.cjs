const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { BrowserWindow } = require('electron');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

module.exports = async ({ target, native, client, service, connection, until }) => {
  const c = connection();
  const send = message => client.webContents.executeJavaScript(`window.fixtureChannel.send(${JSON.stringify(JSON.stringify(message))})`);
  const pointer = (action, x = .5625, y = .25) => send({ kind: 'pointer', action, x, y,
    revision: c.viewport.revision, button: 'left', deltaX: 0, deltaY: 0 });
  const following = 'document.getElementById("followMouse").getAttribute("aria-pressed") === "true"';
  const resume = async () => {
    await client.webContents.executeJavaScript('document.getElementById("followMouse").click()');
    await until(`!(${following})`, 'explicit remote control');
    for (let i = 0; i < 50 && c.following; i++) await sleep(20);
    assert.equal(c.following, false);
  };
  const focusWindow = window => execFileSync('xdotool', ['windowfocus', String(window.getNativeWindowHandle().readUInt32LE(0))]);
  const move = (x, y) => execFileSync('xdotool', ['mousemove', '--window', String(target.getNativeWindowHandle().readUInt32LE(0)), String(x), String(y)]);

  await pointer('down'); await pointer('up');
  await send({ kind: 'text', text: 'remote' });
  await sleep(150);
  assert.equal(await native.webContents.executeJavaScript('document.getElementById("native").value'), 'remote');
  assert.equal(c.following, false, 'Injected clicks, focus and text never trigger local takeover');

  // A parked viewer mouse must not keep injecting movement on video frames.
  await client.webContents.executeJavaScript(`(() => {
    const s = document.getElementById('surface'), r = s.getBoundingClientRect();
    s.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse',
      clientX: r.left + 100, clientY: r.top + 100 }));
  })()`);
  await until('sentControls.some(message => message.kind === "pointer" && message.action === "move")', 'the actual viewer move is dispatched');
  const count = () => client.webContents.executeJavaScript('sentControls.filter(message => message.kind === "pointer" && message.action === "move").length');
  const moves = await count(); await sleep(600);
  assert.equal(await count(), moves, 'Idle video frames do not resend pointer movement');

  const other = new BrowserWindow({ width: 300, height: 200, show: true, webPreferences: { sandbox: true } });
  try {
    other.webContents.setAudioMuted(true);
    await other.loadURL('data:text/html,<input autofocus>');
    focusWindow(other);
    execFileSync('xdotool', ['key', 'b']);
    await sleep(100);
    assert.equal(c.following, false, 'Typing in an unrelated window leaves Remote in control');
  } finally { other.destroy(); }

  await pointer('down');
  await send({ kind: 'key', action: 'down', key: 'Shift', modifiers: ['shift'] });
  await sleep(100);
  assert.equal(c.buttons.size, 1); assert.equal(c.keys.size, 1);
  const revision = c.followRevision;
  // The first physical move in the native pane must release the remote drag
  // before any later local click can combine with it.
  focusWindow(target); move(470, 170);
  await until(following, 'local pointer takeover reaches the Remote toolbar');
  assert.equal(c.following, true); assert.equal(c.followRevision, revision + 1);
  assert.equal(c.buttons.size, 0); assert.equal(c.keys.size, 0); assert.equal(c.drag, null);
  const text = await native.webContents.executeJavaScript('document.getElementById("native").value');
  await send({ kind: 'text', text: 'blocked' });
  await pointer('down'); await pointer('up');
  await send({ kind: 'key', action: 'down', key: 'Enter', modifiers: [] });
  await send({ kind: 'follow-cursor', enabled: false, revision });
  await sleep(150);
  assert.equal(c.following, true, 'A delayed toggle cannot undo local takeover');
  assert.equal(c.buttons.size, 0); assert.equal(c.keys.size, 0);
  assert.equal(await native.webContents.executeJavaScript('document.getElementById("native").value'), text);

  execFileSync('xdotool', ['click', '1']);
  await sleep(100);
  assert.equal(await native.webContents.executeJavaScript('getSelection().toString()'), '', 'A local click does not extend the cancelled remote drag');
  await resume();
  await pointer('down'); await pointer('up');
  await send({ kind: 'text', text: 'resumed' }); await sleep(150);
  assert.equal(c.following, false, 'Explicit resume keeps remote events separate from local events');
  assert.ok((await native.webContents.executeJavaScript('document.getElementById("native").value')).includes('resumed'));

  execFileSync('xdotool', ['click', '1']);
  await until(following, 'a stationary local click forces following');
  await resume();
  execFileSync('xdotool', ['key', 'Left']);
  await until(following, 'physical key in the native pane forces following');
  await resume();
  await pointer('down', .08, .16); await pointer('up', .08, .16);
  await sleep(100);
  execFileSync('xdotool', ['key', 'Left']);
  await until(following, 'physical key in the main renderer forces following');
  assert.ok(service.inputObservers.size > 0);
};
