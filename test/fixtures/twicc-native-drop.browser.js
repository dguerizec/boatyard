import { registerPluginRegistry } from '../../src/renderer/pluginRegistry.js';
import { registerWidgetRegistry } from '../../src/renderer/widgetRegistry.js';
import '../../src/renderer/styles.css';
import '../../src/plugins/twicc/style.css';

function check(value, message) { if (!value) throw new Error(message); }
window.addEventListener('error', event => console.error(event.message));
window.addEventListener('unhandledrejection', event => console.error(String(event.reason)));
window.kanbanNativeEvents = { dragover: 0, drop: 0, dragend: 0 };
window.kanbanNativeTrace = [];
for (const type of ['dragstart', 'dragenter', 'dragleave', 'dragover', 'drop', 'dragend']) {
  window.addEventListener(type, event => {
    const item = { type, x: event.clientX, y: event.clientY, target: event.target.className };
    window.kanbanNativeTrace.push(item);
    setTimeout(() => Object.assign(item, { effect: event.dataTransfer?.dropEffect,
      accepted: event.defaultPrevented, connected: event.target.isConnected }));
  }, true);
}
for (const type of Object.keys(window.kanbanNativeEvents)) {
  window.addEventListener(type, event => {
    if (event.isTrusted) window.kanbanNativeEvents[type]++;
  }, true);
}
registerWidgetRegistry(window);
const registry = registerPluginRegistry(window);
let sessions = [
  { id: 'source', title: 'Drag this session', lane: 'in_progress', order: 0 },
  { id: 'anchor', title: 'Backlog anchor', lane: 'backlog', order: 0 },
  { id: 'completed', title: 'Done anchor', lane: 'done', order: 0 }
];
const writes = [];
window.boatyard = {
  onPluginEvent: () => () => {},
  invokePlugin: async (_plugin, action, payload) => {
    if (action === 'sessionFlow') return structuredClone(sessions);
    if (action === 'reorderSessionFlow') {
      writes.push(structuredClone(payload));
      const moved = payload.sessionIds.map((id, order) => ({
        ...sessions.find(session => session.id === id), lane: payload.lane, order
      }));
      sessions = sessions.filter(session => !payload.sessionIds.includes(session.id)).concat(moved);
      return { lane: payload.lane, sessionIds: payload.sessionIds };
    }
    return null;
  }
};
await import('../../src/plugins/twicc/renderer.ts');
registry.applyEnabledState({});
const pane = registry.listPanes({ scope: 'project', kind: 'dom' })
  .find(item => item.id === 'boatyard.twicc.sessionFlowPane');
const host = document.createElement('div');
host.style.cssText = 'position:fixed;left:24px;top:24px;width:850px;height:540px';
document.body.append(host);
const cleanup = pane.render(host, {
  project: { id: 'example', sourcePath: '/workspace/example' }, paneId: 'native-kanban',
  globalPluginConfig: { twiccBaseUrl: 'https://twicc.example.test' }
});
await new Promise(resolve => setTimeout(resolve, 40));
const card = id => host.querySelector(`[data-session-id="${id}"]`);
for (const orientation of ['horizontal', 'vertical']) {
  host.style.width = orientation === 'horizontal' ? '850px' : '380px';
  host.querySelector('.twicc-session-flow-pane').setOrientation(orientation);
  for (const [targetId, lane, grip] of [['anchor', 'backlog', 0.5], ['completed', 'done', 0.85]]) {
    const source = card('source').getBoundingClientRect();
    const target = card(targetId).getBoundingClientRect();
    const start = { x: source.left + source.width * grip, y: source.top + source.height * grip };
    const center = { x: target.left + target.width / 2, y: target.top + target.height / 2 };
    const end = { x: center.x - (source.width / 2 - Math.round(source.width * grip)),
      y: center.y - (source.height / 2 - Math.round(source.height * grip)) };
    const writesBefore = writes.length;
    const preview = await window.nativeKanbanTest.drag({ start, end, steps: orientation === 'vertical' ? 1 : 5 });
    check(preview.visible && preview.lane === lane && preview.trustedDragovers > 0,
      `Native drag must show the accepted insertion preview before release: ${JSON.stringify({ preview, start, end, events: window.kanbanNativeEvents })}`);
    check(center.y >= preview.rect.top && center.y <= preview.rect.bottom,
      'Native insertion preview must remain underneath the ghost center');
    check(writes.length === writesBefore + 1 && writes.at(-1).lane === lane,
      `A native mouse release over the insertion preview must persist exactly one move: ${JSON.stringify({ preview, writes, events: window.kanbanNativeEvents, trace: window.kanbanNativeTrace })}`);
    check(card('source').closest('[data-lane]').dataset.lane === lane,
      'Native drop must remain in its new lane after reconciliation');
  }
}
check(window.kanbanNativeEvents.drop === 4,
  'Every real mouse drag must deliver a trusted drop event');
cleanup();
window.browserTestResult = 'passed';
