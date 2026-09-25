import { createWebAppMenus } from '../../src/renderer/webAppMenus.js';
import { createWebAppSurfaces } from '../../src/renderer/webAppSurfaces.js';
import '../../src/renderer/styles.css';

function check(value, message) { if (!value) throw new Error(message); }
async function waitFor(condition, message) {
  for (let i = 0; i < 100; i++) {
    if (await condition()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error(message);
}
const entries = [];
const bridge = window.nativeMenuTest;
const fixtureUrl = await bridge.invoke('fixtureUrl');
for (const [index, left] of [20, 410].entries()) {
  const pane = document.createElement('section');
  pane.className = 'webapp-pane';
  pane.style.cssText = `position:fixed;left:${left}px;top:20px;width:350px;min-width:0;height:500px;display:block`;
  const button = document.createElement('button');
  button.textContent = 'Expanded';
  button.style.cssText = 'position:absolute;right:5px;top:5px';
  const host = document.createElement('div');
  host.className = 'webapp-host';
  host.style.cssText = 'position:absolute;left:0;right:0;top:40px;bottom:0';
  pane.append(button, host);
  document.body.append(pane);
  entries.push({ host, pane, button, webApp: { key: `native-${index}`, url: `${fixtureUrl}?view=${index}` } });
}
const surfaces = createWebAppSurfaces({
  boatyard: {
    freezeWebApps: options => bridge.invoke('freezeWebApps', options),
    restoreWebApps: token => bridge.invoke('restoreWebApps', token)
  },
  getFreezeLayerHost: () => document.body,
  getSettings: () => ({}), getVisibleWebAppEntries: () => entries,
  invokeWebApp: (action, payload) => bridge.invoke(action === 'hideWebApp' ? 'hideWebApps' : action, payload),
  isWebAppAutofillEnabled: () => false, markWebAppLoaded() {}
});
const scope = surfaces.createFreezeScope();
let blockFreeze = null;
let releaseFreeze;
let freezeRect;
const menus = createWebAppMenus({
  freezeWebAppsForOverlayRect: async rect => {
    freezeRect = rect;
    await scope.freezeForMainRect(rect, { margin: 8 });
    if (blockFreeze) await blockFreeze;
  },
  restoreWebAppsAfterOverlay: () => scope.restore(), closeTerminalTabMenu() {},
  clamp: (value, min, max) => Math.min(max, Math.max(min, value))
});
entries[0].button.addEventListener('contextmenu', event => menus.openPaneExpansionMenu(event, () => {}));
await surfaces.syncWebAppView();
await waitFor(async () => (await bridge.status()).length === 2 && (await bridge.status()).every(view => view.visible && view.loaded && view.painted), 'Native views load and are visible');
const open = (x, y) => entries[0].button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: x, clientY: y }));
const menu = () => document.querySelector('[role="menu"]');
open(365, 500);
await waitFor(() => menu()?.style.visibility === '', 'Menu opens after native capture');
const box = menu().getBoundingClientRect();
const pane = entries[0].pane.getBoundingClientRect();
check(box.left >= pane.left && box.right <= pane.right && box.top >= pane.top && box.bottom <= pane.bottom, 'Measured menu stays inside its source pane');
check(box.bottom <= innerHeight && box.right <= innerWidth, 'Menu stays inside the window');
check(box.height > 48, 'Wrapped menu exercises real height rather than a fixed estimate');
check(freezeRect.x === box.x && freezeRect.y === box.y && freezeRect.width === box.width && freezeRect.height === box.height, 'Freeze uses the final menu bounds');
let status = await bridge.status();
check(!status[0].visible && status[1].visible, 'Covered native view is hidden while the adjacent native view stays visible');
check(document.querySelector('.webapp-freeze-shot'), 'Native surface capture replaces the hidden view');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
await waitFor(async () => !menu() && (await bridge.status()).every(view => view.visible), 'Closing restores native views');
// A tiny source pane falls back to the window, including bottom/right edges.
entries[0].pane.style.width = '100px';
entries[0].pane.style.height = '60px';
open(innerWidth - 1, innerHeight - 1);
await waitFor(() => menu()?.style.visibility === '', 'Fallback menu opens');
const fallback = menu().getBoundingClientRect();
check(fallback.right <= innerWidth - 11 && fallback.bottom <= innerHeight - 11, 'Fallback fits the actual menu inside the window');
window.dispatchEvent(new Event('blur'));
await waitFor(async () => !menu() && (await bridge.status()).every(view => view.visible), 'Switching windows dismisses the menu and restores native views');
// Closing during an asynchronous freeze must not resurrect the menu.
blockFreeze = new Promise(resolve => { releaseFreeze = resolve; });
open(100, 100);
check(menu()?.style.visibility === 'hidden', 'Menu is hidden while preparing its native overlay');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
releaseFreeze();
await waitFor(async () => !menu() && (await bridge.status()).every(view => view.visible), 'Cancellation during capture restores native views');
await new Promise(resolve => setTimeout(resolve, 100));
check(!menu(), 'Cancelled menu stays closed after capture');
window.browserTestResult = 'passed';
