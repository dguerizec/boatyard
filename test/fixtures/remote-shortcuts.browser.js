import { createProjectSidebar } from '../../src/renderer/projectSidebar.js';

const detached = tag => document.createElement(tag);
const sidebar = createProjectSidebar({
  elements: {
    pinnedProjects: document.getElementById('shortcuts'),
    addProjectButton: detached('button'), globalNav: detached('button'), globalNavRow: detached('div'),
    projectCount: detached('span'), projectList: detached('div'), projectSearchInput: detached('input'),
    sidebarRail: detached('button'), sidebarToggleButton: detached('button')
  },
  getViewState: () => ({ currentView: 'global' }),
  getProjects: () => [{ id: 'fixture', name: 'Fixture' }],
  getPinnedProjectIds: () => ['fixture'], getProjectGroups: () => [],
  getProjectGroupsByName: () => new Map(), getCollapsedProjectGroups: () => new Set(),
  isSidebarCollapsed: () => false, isOnboardingDemoProjectVisible: () => false,
  selectProject(id) { window.selectedProject = id; window.clicks = (window.clicks || 0) + 1; },
  selectEditProject() {}, renderProjectNavBadges() {}, renderSidebarUpdateNotice() {}, renderApp() {},
  applyFormControl() {}, clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  normalizeProjectSearchText: value => String(value), projectMatchesSearch: () => true,
  ensureOnboardingDemoProject() {}, queueWebAppSync() {},
  async freezeWebAppsForRect() {}, async restoreWebAppsAfterOverlay() {},
  async updateNavigation() {}, async updateProject() {}, async reorderProjectIds() {},
  async showOverlayDialog() { return false; }
});
sidebar.renderPinnedProjects();
