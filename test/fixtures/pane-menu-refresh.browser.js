import { createWebAppMenus } from '../../src/renderer/webAppMenus.js';
import { registerPluginRegistry } from '../../src/renderer/pluginRegistry.js';
import { registerWidgetRegistry } from '../../src/renderer/widgetRegistry.js';
import '../../src/renderer/styles.css';

function check(value, message) { if (!value) throw new Error(message); }
async function tick() { await new Promise(resolve => setTimeout(resolve, 20)); }
registerWidgetRegistry(window);
const registry = registerPluginRegistry(window);
await import('../../src/plugins/pier/renderer.ts');
registry.applyEnabledState({});
const project = { id: 'example', name: 'Example', sourcePath: '/workspace/example' };
const otherProject = { id: 'other', name: 'Other', sourcePath: '/workspace/other' };
const projectConfig = {};
const globalPluginConfig = { pierUrl: 'http://pier.example' };
const pending = [];
const calls = [];
window.fetch = (url) => {
  calls.push(url);
  return new Promise((resolve, reject) => pending.push({ resolve, reject }));
};
function reply(data) {
  check(pending.length, 'A discovery request is pending');
  pending.shift().resolve({ ok: true, json: async () => data });
}
const manual = { id: 'manual', key: 'manual', label: 'Manual', kind: 'dom' };
function entries(current) {
  const pier = registry.listPanes().find(pane => pane.webAppId === 'pier');
  return [manual, ...(pier?.resolveWebApps({ project: current, projectConfig, globalPluginConfig }) || [])];
}
const pane = document.createElement('section');
pane.className = 'webapp-pane';
pane.style.cssText = 'height:500px;width:400px';
const button = document.createElement('button');
button.textContent = 'Select pane';
pane.append(button);
document.body.append(pane);
let opened = 0;
let reads = 0;
const menus = createWebAppMenus({
  getWebAppFavicon: () => '', isWebAppLoaded: () => false,
  freezeWebAppsForOverlay: async () => {}, restoreWebAppsAfterOverlay() {}, closeTerminalTabMenu() {},
  getProjectById: id => id === project.id ? project : otherProject,
  getProjectWebApps: current => { reads++; return entries(current); },
  onPaneMenuOpened: current => {
    opened++;
    registry.emit('boatyard.paneMenu.opened', { project: current, projectConfig, globalPluginConfig });
  }
});
const open = (current = project) => menus.openWebAppTabMenuFromButton(button, current, { id: 'pane' }, manual, entries(current));
const menu = () => document.querySelector('.webapp-tab-menu');
await open();
check(menu() && opened === 1 && calls.length === 1, 'Menu opens before discovery finishes');
check(!menu().querySelector('[data-web-app-id="pier:main"]'), 'Uncached workload is absent initially');
await open();
check(calls.length === 1, 'Repeated openings share the pending discovery request');
const retainedMenu = menu();
menu().querySelector('[data-web-app-id="manual"]').focus();
reply([{ name: 'example', repo_path: '/workspace/example' }]);
await tick();
check(calls[1] === 'http://pier.example/api/v1/projects/example/worktrees', 'Plugin queries configured Pier API');
reply([{ slug: 'main', path: '/workspace/example', has_workload: true, workload: {
  slug: 'main', status: 'running', running: true, urls: [{ default: true, url: 'http://main.example.test' }]
} }]);
await tick();
check(menu() === retainedMenu, 'Background refresh keeps the same menu open');
check(menu().querySelector('[data-web-app-id="pier:main"]'), 'Manually started workload appears when discovery completes');
check(document.activeElement.dataset.webAppId === 'manual', 'Menu focus survives discovery');
const before = reads;
window.dispatchEvent(new CustomEvent('boatyard:pane-contributions-changed', { detail: { projectId: 'unrelated' } }));
check(reads === before, 'Other project contributions do not refresh this menu');
await open();
pending.shift().reject(new Error('Offline'));
await tick();
check(menu().querySelector('[data-web-app-id="pier:main"]'), 'Failed discovery preserves cached entries');
await open();
menus.closeWebAppTabMenu();
await open(otherProject);
reply([]);
await tick();
check(!menu().querySelector('[data-web-app-id="pier:main"]'), 'Late reply does not contaminate a different project menu');
reply([]);
await tick();
menus.closeWebAppTabMenu();
const closedReads = reads;
window.dispatchEvent(new CustomEvent('boatyard:pane-contributions-changed'));
check(!menu() && reads === closedReads, 'Closed menus unsubscribe from contribution updates');
await open();
reply([{ name: 'example', repo_path: '/workspace/example' }]);
await tick();
let changes = 0;
window.addEventListener('boatyard:pane-contributions-changed', () => changes++);
registry.setEnabled('boatyard.pier', false);
reply([{ slug: 'late', path: '/workspace/example/late', has_workload: true, workload: {
  slug: 'late', status: 'running', running: true, urls: [{ default: true, url: 'http://late.example.test' }]
} }]);
await tick();
check(changes === 0, 'Discovery started before disable cannot publish late cache changes');
menus.closeWebAppTabMenu();
registry.emit('boatyard.paneMenu.opened', { project, projectConfig, globalPluginConfig });
check(pending.length === 0, 'Disabled plugin does not discover workloads');
window.browserTestResult = 'passed';
