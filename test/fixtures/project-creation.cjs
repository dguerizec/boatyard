const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { join } = require('node:path');
const { app, BrowserWindow, ipcMain, screen } = require('electron');

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const handlers = new Map();
const operations = [];
const handle = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, listener) => {
  const wrapped = async (event, ...args) => {
    // Keep external TwiCC data isolated while exercising the real project,
    // settings, navigation, layout and native web-pane handlers.
    if (channel === 'plugins:invoke' && args[0] === 'boatyard.twicc') {
      if (args[1] === 'projectProcessStatuses') return {};
      if (args[1] === 'sessionFlow') return { sessions: [] };
    }
    if (channel === 'projects:inspect-source-path') return {};
    if (channel === 'navigation:update') await delay(100);
    const result = await listener(event, ...args);
    if (channel === 'projects:add') {
      const project = result.projects.at(-1);
      assert.deepEqual(result.projectHugescreen[project.id], {
        widthMultiplier: 1, heightMultiplier: 1, panMode: 'continuous', enabled: false
      }, 'new projects start at screen size before the selected layout is applied');
    }
    if (channel === 'navigation:update') operations.push(['navigation', args[0].projectId]);
    if (channel === 'layouts:apply') operations.push(['layout', args[0].projectId]);
    return result;
  };
  handlers.set(channel, wrapped);
  handle(channel, wrapped);
};
require(join(process.cwd(), 'build/main/main.js'));
const timeout = setTimeout(() => { console.error('Project creation integration timed out'); app.exit(1); }, 45000);
const server = createServer((_request, response) => {
  response.setHeader('Content-Type', 'text/html');
  response.end('<!doctype html><title>Fixture TwiCC project</title><p>TwiCC project fixture</p>');
});

app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const twiccUrl = `http://127.0.0.1:${server.address().port}/project/example`;
  while (!BrowserWindow.getAllWindows().length || !handlers.has('layouts:apply')) await delay(25);
  const win = BrowserWindow.getAllWindows()[0];
  const invoke = (channel, ...args) => handlers.get(channel)({ sender: win.webContents }, ...args);
  const evaluate = source => win.webContents.executeJavaScript(source);
  const waitFor = async (source, message) => {
    for (let attempt = 0; attempt < 200; attempt++) {
      if (await evaluate(source)) return;
      await delay(25);
    }
    throw new Error(message);
  };
  await waitFor(`!!document.querySelector('#add-project') && !!document.querySelector('.project-nav-row')`, 'Workspace did not load');
  await invoke('navigation:update', { view: 'project', projectId: 'existing' });
  await invoke('hugescreen:resize', 1.5, 1.5, 'continuous');
  await invoke('layouts:save', {
    id: 'twicc-layout', name: 'TwiCC workspace', projectId: null,
    paneLayout: { type: 'pane', id: 'template-pane', paneTypeId: 'twicc-plugin' }
  });
  const original = await invoke('state:get');

  for (const view of ['project', 'global']) {
    await invoke('navigation:update', { view, projectId: view === 'project' ? 'existing' : null });
    await delay(150);
    await evaluate(`document.querySelector('#add-project').click()`);
    await waitFor(`!!document.querySelector('.project-form [name=twiccProjectUrl]')`, 'Creation form did not load');
    await evaluate(`(() => {
      const form = document.querySelector('.project-form');
      form.elements.sourcePath.value = '/workspace/example';
      form.elements.name.value = 'Created from ${view}';
      form.elements.slug.value = 'created-from-${view}';
      form.elements.twiccProjectUrl.value = ${JSON.stringify(twiccUrl)};
      form.requestSubmit();
    })()`);
    await waitFor(`!!document.querySelector('.workspace-layout-dialog[open] .workspace-layout-list-item')`, 'Initial layout picker did not open');
    await evaluate(`(() => {
      const dialog = document.querySelector('.workspace-layout-dialog[open]');
      [...dialog.querySelectorAll('.workspace-layout-list-item')].find(item => item.textContent.includes('TwiCC workspace')).click();
      [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Use this layout').click();
    })()`);
    await waitFor(`!!document.querySelector('.workspace-layout-toast') || !!document.querySelector('.project-form .form-error:not([hidden])')`, 'Project creation did not finish');
    const current = await invoke('state:get');
    const project = current.projects.find(project => project.slug === 'created-from-' + view);
    assert.ok(project, 'project is persisted');
    assert.equal(current.navigation.projectId, project.id, 'new project becomes active');
    assert.equal(current.pluginConfig.projects[project.id]['boatyard.twicc'].twiccProjectUrl, twiccUrl);
    assert.equal(current.paneLayouts[project.id].selectedWebAppId, 'twicc-plugin', 'initial TwiCC pane is installed');
    const navigationIndex = operations.findIndex(([type, id]) => type === 'navigation' && id === project.id);
    const layoutIndex = operations.findIndex(([type, id]) => type === 'layout' && id === project.id);
    assert.ok(navigationIndex >= 0 && layoutIndex > navigationIndex, 'navigation finishes before layout application');
    await waitFor(`!!document.querySelector('.webapp-pane-header') && !document.querySelector('.project-form')`, 'Project dashboard did not render');
    for (let attempt = 0; attempt < 200; attempt++) {
      if (win.contentView.children.some(view => view.webContents?.getURL() === twiccUrl && !view.webContents.isLoadingMainFrame())) break;
      await delay(25);
    }
    assert.ok(win.contentView.children.some(view => view.webContents?.getURL() === twiccUrl), 'native TwiCC web pane opens the configured URL');
    assert.deepEqual(current.paneLayouts.existing, original.paneLayouts.existing, 'previous project layout is unchanged');
    assert.equal(await evaluate(`document.querySelectorAll('#project-list .project-nav-row').length`), current.projects.length, 'all grouped and ungrouped projects remain in the sidebar');
    const display = screen.getDisplayMatching(win.getBounds()).workArea;
    const visibleBottom = display.y + display.height - win.getContentBounds().y;
    await waitFor(`document.querySelector('.sidebar').getBoundingClientRect().bottom <= ${visibleBottom} + 1`, 'Sidebar height did not settle within the screen');
    const sidebar = await evaluate(`(() => {
      const sidebar = document.querySelector('.sidebar');
      sidebar.scrollTop = sidebar.scrollHeight;
      const row = document.querySelector('#project-list .project-nav-row[data-project-id="${project.id}"]');
      return { bottom: sidebar.getBoundingClientRect().bottom, rowBottom: row.getBoundingClientRect().bottom,
        visibleBottom: ${visibleBottom},
        workspaceBottom: document.querySelector('.workspace').getBoundingClientRect().bottom };
    })()`);
    assert.ok(sidebar.bottom <= sidebar.visibleBottom + 1, `sidebar ends within the physical display: ${JSON.stringify(sidebar)}`);
    assert.ok(sidebar.rowBottom <= sidebar.bottom, 'new ungrouped project is reachable by scrolling');
    assert.ok(sidebar.workspaceBottom > sidebar.visibleBottom, 'Hugescreen workspace stays enlarged');
    await evaluate(`document.querySelector('.workspace-layout-toast')?.remove()`);
    await evaluate(`document.querySelector('.project-nav-row[data-project-id="existing"] .nav-item').click()`);
    await delay(250);
    const operationIndex = operations.length;
    await evaluate(`(() => {
      document.querySelector('.project-nav-row[data-project-id="${project.id}"] .nav-item').click();
      window.paneBeforeNavigationAck = document.querySelector('.webapp-host');
    })()`);
    while (!operations.slice(operationIndex).some(([type, id]) => type === 'navigation' && id === project.id)) await delay(25);
    await delay(100);
    assert.equal(await evaluate(`window.paneBeforeNavigationAck === document.querySelector('.webapp-host')`),
      true, 'navigation acknowledgement preserves the already mounted TwiCC pane');
  }
  // A blank layout and no plugin settings must still retain the created project
  // and its fitting geometry, even when creation starts in an oversized window.
  await evaluate(`(() => {
    const registry = window.BoatyardPluginRegistry;
    registry.applyEnabledState(Object.fromEntries(registry.listProjectSettingsSections().map(section => [section.pluginId, false])));
    document.querySelector('#add-project').click();
    const form = document.querySelector('.project-form');
    form.elements.sourcePath.value = '/workspace/blank';
    form.elements.name.value = 'Blank project';
    form.elements.slug.value = 'blank-project';
    form.requestSubmit();
  })()`);
  await waitFor(`!!document.querySelector('.workspace-layout-dialog[open] .workspace-layout-list-item')`, 'Blank project layout picker did not open');
  await evaluate(`(() => {
    const dialog = document.querySelector('.workspace-layout-dialog[open]');
    [...dialog.querySelectorAll('.workspace-layout-list-item')].find(item => item.textContent.includes('Blank')).click();
    [...dialog.querySelectorAll('button')].find(button => button.textContent === 'Use this layout').click();
  })()`);
  await waitFor(`!!document.querySelector('.workspace-layout-toast')`, 'Blank project creation did not finish');
  const blankState = await invoke('state:get');
  const blankProject = blankState.projects.find(project => project.slug === 'blank-project');
  assert.ok(blankProject);
  assert.equal(blankState.navigation.projectId, blankProject.id);
  assert.equal(blankState.paneLayouts[blankProject.id].selectedWebAppId, 'empty');
  assert.equal(blankState.pluginConfig.projects[blankProject.id], undefined);
  assert.equal(await evaluate(`document.querySelectorAll('#project-list .project-nav-row').length`), blankState.projects.length);
  const fitting = await invoke('hugescreen:settings');
  assert.ok(Math.abs(fitting.widthMultiplier - 1) < 0.01 && Math.abs(fitting.heightMultiplier - 1) < 0.01, 'blank project fits the screen');
  assert.equal(fitting.active, false);
  // Stale requests must remain rejected rather than applying to another project.
  await assert.rejects(invoke('layouts:apply', {
    projectId: 'existing', paneLayout: { type: 'pane', id: 'stale-pane' }
  }), /active project changed/);
  console.log('PROJECT_CREATION_PASSED');
  clearTimeout(timeout);
  server.close();
  app.exit(0);
}).catch(error => { console.error(error); server.close(); clearTimeout(timeout); app.exit(1); });
