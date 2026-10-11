import { createProjectSidebar } from '../../src/renderer/projectSidebar.js';
import { createProjectShareControls } from '../../src/renderer/projectShareControls.js';
import { normalizeProjectSearchText, projectMatchesSearch } from '../../src/renderer/projectUtils.js';
import '../../src/renderer/styles.css';
const check = (value, message) => { if (!value) throw new Error(message); };
const tick = () => new Promise(resolve => setTimeout(resolve, 20));
const projects = [{ id: 'one', name: 'One', slug: 'one' }, { id: 'two', name: 'Two', slug: 'two' }];
const elements = {};
for (const name of ['addProjectButton', 'globalNav', 'globalNavRow', 'pinnedProjects', 'projectCount', 'projectList', 'projectSearchInput', 'sidebarRail', 'sidebarToggleButton']) {
  elements[name] = document.createElement(name === 'projectSearchInput' ? 'input' : 'div');
  document.body.append(elements[name]);
}
elements.projectList.style.width = '300px';
const listeners = new Set();
let status = { listening: false, sharedProjectIds: ['context:one', 'other:two'] };
const emit = patch => { status = { ...status, ...patch }; listeners.forEach(listener => listener(status)); };
let resolveMutation;
let staleInitial;
const calls = [];
const api = {
  getShareProjects: async () => projects.map(project => ({ ...project, key: `context:${project.id}` })),
  getRemoteStatus: () => new Promise(resolve => { staleInitial = resolve; }),
  onRemoteStatusChanged: (listener, mode) => { check(mode === 'share', 'Only Share status is observed'); listeners.add(listener); return () => listeners.delete(listener); },
  updateShareScreen: patch => { calls.push(patch); return new Promise(resolve => { resolveMutation = () => {
    const key = `context:${patch.projectId}`;
    emit({ sharedProjectIds: [...status.sharedProjectIds.filter(id => id !== key), ...(patch.shared ? [key] : [])] });
    resolve(status);
  }; }); }
};
let selected = null;
let controls;
let deferFreeze = false;
const freezeScopes = [];
const sidebar = createProjectSidebar({
  createProjectMenuFreezeScope: () => {
    const scope = { restores: 0, requests: [],
      freezeForMainRect(rect, options) {
        scope.requests.push({ rect, options });
        return deferFreeze ? new Promise(resolve => { scope.resolve = resolve; }) : Promise.resolve();
      },
      async restore() { scope.restores++; }
    };
    freezeScopes.push(scope); return scope;
  },
  elements, projectSharing: { getState: id => controls?.getState(id), isBusy: () => controls?.isBusy() || false, toggle: async id => controls.toggle(id) },
  getProjects: () => projects, getProjectGroups: () => [], getProjectGroupsByName: () => new Map(),
  getCollapsedProjectGroups: () => new Set(), getPinnedProjectIds: () => ['one', 'two'],
  getViewState: () => ({ currentView: 'project', currentProjectId: 'one' }), isSidebarCollapsed: () => false,
  freezeWebAppsForRect: async () => {}, queueWebAppSync() {}, restoreWebAppsAfterOverlay: async () => {},
  normalizeProjectSearchText, projectMatchesSearch, renderSidebarUpdateNotice() {}, renderProjectNavBadges() {},
  selectProject: id => { selected = id; }, selectEditProject() {}, clamp: (value, min, max) => Math.max(min, Math.min(value, max)),
  applyFormControl() {}, showOverlayDialog: async () => false, isOnboardingDemoProjectVisible: () => false,
  ensureOnboardingDemoProject() {}, updateNavigation: async () => {}, updateProject: async () => {}, reorderProjectIds: async () => {}, renderApp() {}
});
controls = createProjectShareControls(api, () => sidebar.refreshSharing());
sidebar.renderProjectList(); await tick();
const eye = id => elements.projectList.querySelector(`[data-project-share-id="${id}"]`);
const shortcut = id => elements.pinnedProjects.querySelector(`[data-project-id="${id}"]`);
check(eye('one').hidden && !shortcut('one').classList.contains('project-sharing-active'), 'Stopped Share hides all project indicators');
emit({ listening: true });
staleInitial({ listening: false, sharedProjectIds: [] }); await tick();
check(!eye('one').hidden && eye('one').querySelector('svg') && eye('one').classList.contains('project-is-shared'), 'Live Share shows a shared project eye and rejects stale initial status');
check(eye('two').hidden && !eye('two').querySelector('svg'), 'Masked projects have no eye icon');
check(shortcut('one').classList.contains('project-is-shared') && shortcut('two').classList.contains('project-sharing-active') && !shortcut('two').classList.contains('project-is-shared'), 'Shortcuts distinguish shared and masked projects in the current context');
check(getComputedStyle(shortcut('one')).borderStyle === 'dashed' && getComputedStyle(shortcut('two')).borderStyle === 'solid' && getComputedStyle(shortcut('one')).borderColor !== getComputedStyle(shortcut('two')).borderColor, 'Only shared shortcuts have dashed red borders');
eye('one').click();
check(calls.at(-1).projectId === 'one' && calls.at(-1).shared === false && selected === null, 'Eye masks its project without navigating');
check(eye('one').disabled, 'Pending sharing changes disable controls');
resolveMutation(); await tick();
check(eye('one').hidden && getComputedStyle(shortcut('one')).borderStyle === 'solid' && status.sharedProjectIds.includes('other:two'), 'Masking updates indicators and preserves other contexts');
shortcut('two').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 40 }));
await tick();
let item = document.querySelector('.project-share-menu-item');
const firstMenu = item.closest('[role=menu]');
const frozen = freezeScopes.at(-1).requests[0];
check(frozen.options.margin === 8 && frozen.rect.width === firstMenu.getBoundingClientRect().width && frozen.rect.height === firstMenu.getBoundingClientRect().height, 'Freeze targets the complete measured menu with its margin');
check(firstMenu.style.visibility === '', 'Menu becomes visible after the targeted freeze');
check(item && !item.hidden && !item.querySelector('svg') && item.textContent === 'Share' && item.getAttribute('aria-checked') === 'false', 'Masked shortcut menu offers Share without an icon');
item.click(); resolveMutation(); await tick();
check(freezeScopes[0].restores > 0, 'Selecting a menu action restores its own freeze scope');
check(!eye('two').hidden && shortcut('two').classList.contains('project-is-shared'), 'Context menu shares a masked project');
shortcut('two').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 40 }));
item = document.querySelector('.project-share-menu-item');
check(item.querySelector('svg') && item.getAttribute('aria-checked') === 'true', 'Shared context menu has a state eye');
emit({ listening: false });
check(item.hidden && eye('two').hidden && getComputedStyle(shortcut('two')).borderStyle === 'solid', 'Stopping Share removes indicators including an open menu');
emit({ listening: true });
check(!eye('two').hidden && !item.hidden, 'Restarting Share restores saved project permissions');
sidebar.closeProjectGroupMenu();
deferFreeze = true;
shortcut('two').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 40 }));
const pendingMenu = document.querySelector('.project-group-context-menu');
const pendingScope = freezeScopes.at(-1);
check(pendingMenu.style.visibility === 'hidden', 'Menu stays hidden while native captures are pending');
document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
check(!pendingMenu.isConnected && pendingScope.restores === 1, 'Escape closes and restores even during a pending freeze');
shortcut('one').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 100, clientY: 40 }));
const nextMenu = document.querySelector('.project-group-context-menu');
const nextScope = freezeScopes.at(-1);
pendingScope.resolve(); await Promise.resolve(); await Promise.resolve();
check(pendingScope.restores === 2 && nextScope.restores === 0 && nextMenu.style.visibility === 'hidden', `Late completion releases only the old menu freeze: ${pendingScope.restores}, ${nextScope.restores}, ${nextMenu.style.visibility}`);
nextScope.resolve(); await Promise.resolve(); await Promise.resolve();
check(nextMenu.style.visibility === '', 'Replacement menu reveals after its own freeze');
window.dispatchEvent(new Event('resize')); await tick();
check(!nextMenu.isConnected && nextScope.restores === 1, 'Resize closes the menu and restores native views');
controls.dispose();
check(listeners.size === 0, 'Sharing status subscription is cleaned up');
window.browserTestResult = 'passed';
