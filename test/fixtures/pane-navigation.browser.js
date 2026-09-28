import { createPaneLayoutState } from '../../src/renderer/paneLayoutState.js';
import { createPaneLayoutView } from '../../src/renderer/paneLayoutView.js';

function check(value, message) { if (!value) throw new Error(message); }
const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
const project = { id: 'project', name: 'Example' };
const layout = { type: 'split', id: 'root', direction: 'vertical', ratio: 0.5,
  first: { type: 'pane', id: 'source', selectedWebAppId: 'overview' },
  second: { type: 'pane', id: 'other', selectedWebAppId: 'repository' } };
const saves = [];
const navigations = [];
const urls = new Map();
const state = createPaneLayoutState({ updatePaneLayout: async (_, value) => saves.push(structuredClone(value)) });
state.hydratePaneLayouts({ project: layout });
const grid = document.createElement('div');
grid.style.cssText = 'position:fixed;inset:0;display:grid';
document.body.append(grid);
const repositoryUrl = 'https://github.com/example/project';
const runUrl = `${repositoryUrl}/actions/runs/42`;
const navigation = { showAddressBar: false, items: [
  { id: 'overview', label: 'Overview', webAppId: 'overview' },
  { id: 'actions', label: 'Actions', webAppId: 'repository', url: `${repositoryUrl}/actions`,
    activeUrlPatterns: ['^https://github\\.com/example/project/actions(?:/|$)'] },
  { id: 'pullRequests', label: 'Pull requests', webAppId: 'repository', url: `${repositoryUrl}/pulls`,
    activeUrlPatterns: ['^https://github\\.com/example/project/pulls?(?:/|$)'] }
] };
let sourceProps;
const apps = paneId => [
  { id: 'overview', key: `${paneId}:overview`, kind: 'dom', label: 'GitHub', navigation,
    pluginPane: { pluginId: 'fixture', render(host, props) {
      sourceProps = props;
      const button = document.createElement('button');
      button.textContent = 'Workflow';
      button.className = 'workflow-link';
      button.onclick = () => props.openPaneWebApp('repository', runUrl);
      host.append(button);
    } } },
  { id: 'repository', key: `${paneId}:repository`, kind: 'wcv', label: 'GitHub', navigation, url: repositoryUrl }
];
const view = createPaneLayoutView({
  paneLayoutState: state, dashboardGrid: grid, webAppSplitResizerSize: 6, minWidgetRailWidth: 200,
  createToolIcon: () => document.createElement('span'),
  getProjectPaneLayout: state.getProjectPaneLayout,
  getProjectWebApps: (_, paneId) => apps(paneId),
  getSelectedWebApp: (_, paneId, webApps) => webApps.find(app => app.id === state.findPaneNode(state.getProjectPaneLayout(project), paneId).selectedWebAppId),
  isCompactPaneTabs: () => false, isGlobalWorkspace: () => false,
  getProjectPluginConfig: () => ({}), getGlobalPluginConfig: () => ({}), getAllProjectPluginConfig: () => ({}),
  setHiddenWebAppPaneIds() {}, resetVisibleWebAppHosts() {}, queueWebAppSync() {},
  persistPaneLayout: state.persistPaneLayout,
  closeWebAppTabMenu() {}, isWebAppTabMenuOpen: () => false,
  getCurrentWebAppUrl: app => urls.get(app.key) || app.url,
  setCurrentWebAppUrl: (key, url) => urls.set(key, url),
  invokeWebApp: async (...args) => navigations.push(args),
  setVisibleWebAppHost() {}, isPasswordManagerEnabled: () => false
});
grid.append(view.createPaneLayout(project, layout));
const pane = id => grid.querySelector(`.webapp-pane[data-pane-id="${id}"]`);
const other = pane('other');
check(sourceProps.openPaneWebApp('missing', runUrl) === false, 'Unavailable targets are rejected');
check(saves.length === 0, 'Unavailable target leaves layout untouched');
pane('source').querySelector('.workflow-link').click();
await frame(); await frame();
check(pane('source').dataset.webAppId === 'repository', 'Link selects repository in its source pane');
check(pane('source').querySelector('[data-navigation-item-id="actions"]').getAttribute('aria-current') === 'page', 'Workflow detail activates Actions');
check(pane('other') === other, 'Already open repository in another pane is preserved');
check(urls.get('source:repository') === runUrl && !urls.has('other:repository'), 'Only source pane URL changes');
check(JSON.stringify(navigations) === JSON.stringify([['navigateWebApp', 'source:repository', 'open', runUrl]]), 'Native navigation receives the exact run URL and source key');
check(saves.at(-1).first.selectedWebAppId === 'repository', 'Selection is persisted');
pane('source').querySelector('[data-navigation-item-id="pullRequests"]').click();
check(pane('source').querySelector('[data-navigation-item-id="pullRequests"]').getAttribute('aria-current') === 'page', 'Same-surface tab navigation still updates active section');
pane('source').querySelector('[data-navigation-item-id="overview"]').click();
check(pane('source').querySelector('.workflow-link'), 'Overview tab returns to DOM content');
check(pane('other') === other, 'Other pane remains mounted throughout navigation');
window.browserTestResult = 'passed';
