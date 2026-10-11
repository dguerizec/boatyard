import { normalizeShareSidebarState, type ShareSidebarState, type ShareTab } from "./shareSidebarState.js";
import { createSharePane, type SharePaneHost } from "./sharePane.js";
import { cleanupPaneLayout } from "./paneCleanup.js";
import { createToolIcon } from "./toolIcons.js";
import type { BoatyardBridge } from "./rendererTypes.js";

export function createShareSidebar(shell: HTMLElement, api: BoatyardBridge, options: {
  save(state: ShareSidebarState): Promise<unknown>;
  layoutChanged(): void;
  applyFormControls(container: HTMLElement): void;
}) {
  const sidebar = document.createElement("aside");
  sidebar.className = "share-sidebar"; sidebar.setAttribute("aria-label", "Share sidebar");
  sidebar.innerHTML = `<div class="share-sidebar-resizer" role="separator" tabindex="0" aria-label="Share sidebar width" aria-orientation="vertical"></div>
    <nav class="share-sidebar-rail" aria-label="Share sections"></nav>
    <div class="share-sidebar-content"><header class="share-sidebar-header"><strong>Share</strong></header>
      <p class="form-error" role="alert" hidden></p><div class="share-sidebar-pane"></div></div>`;
  const rail = sidebar.querySelector<HTMLElement>("nav")!;
  const content = sidebar.querySelector<HTMLElement>(".share-sidebar-content")!;
  const host = sidebar.querySelector<HTMLElement>(".share-sidebar-pane")!;
  const header = sidebar.querySelector<HTMLElement>("header")!;
  const error = sidebar.querySelector<HTMLElement>("[role=alert]")!;
  const resizer = sidebar.querySelector<HTMLElement>("[role=separator]")!;
  let state = normalizeShareSidebarState(undefined), pane: SharePaneHost | undefined;
  let restoring = false, disposed = false, pending = 0, saves = Promise.resolve();
  const pinListeners = new Set<() => void>();
  let lastPinned = state.pinned;
  const tabButtons = new Map<ShareTab, HTMLButtonElement>();

  function button(parent: HTMLElement, label: string, icon: string, action: () => void) {
    const control = document.createElement("button"); control.type = "button"; control.className = "icon-button";
    control.title = label; control.setAttribute("aria-label", label); control.append(createToolIcon(icon));
    control.onclick = action; parent.append(control); return control;
  }
  function persist() {
    const snapshot = { ...state }; pending++;
    saves = saves.then(async () => {
      if (disposed) return;
      try { await options.save(snapshot); error.hidden = true; }
      catch { error.textContent = "Could not save Share sidebar preferences. Change a sidebar setting to retry."; error.hidden = false; }
    }).finally(() => { pending--; });
  }
  function update(patch: Partial<ShareSidebarState>) {
    state = normalizeShareSidebarState({ ...state, ...patch }); render(); persist();
  }
  function open(tab: ShareTab, section?: "requests") {
    update({ collapsed: false, tab });
    pane?.selectShareTab(tab, section);
    if (!section) pane?.querySelector<HTMLElement>(`[data-share-panel="${tab}"]`)?.focus();
  }
  const collapse = button(rail, "Collapse Share sidebar", "arrowRight", () => update({ collapsed: !state.collapsed }));
  for (const [tab, label, icon] of [["session", "Session", "users"], ["chat", "Chat", "messageSquare"], ["setup", "Setup", "settingsMonitor"], ["projects", "Shared projects", "folderTree"]] as const) {
    const control = button(rail, label, icon, () => open(tab)); control.dataset.sidebarTab = tab; tabButtons.set(tab, control);
  }
  const alertButtons = new Map<string, HTMLButtonElement>();
  for (const [name, label, icon, tab, section] of [
    ["requests", "Join requests pending", "users", "session", "requests"],
    ["messages", "Unread messages", "messageSquare", "chat", undefined]
  ] as const) {
    const control = button(rail, label, icon, () => open(tab, section));
    control.classList.add("share-sidebar-alert", `share-alert-${name}`); control.dataset.alert = name; control.hidden = true;
    const count = document.createElement("span"); count.className = "share-sidebar-count"; control.append(count);
    alertButtons.set(name, control);
  }
  const unpin = button(rail, "Unpin Share sidebar", "close", () => update({ pinned: false }));
  unpin.classList.add("share-sidebar-unpin");
  shell.append(sidebar);

  function render() {
    sidebar.hidden = !state.pinned; sidebar.classList.toggle("collapsed", state.collapsed);
    shell.style.setProperty("--share-sidebar-size", state.pinned ? state.collapsed ? "48px" : `min(${state.width + 48}px, calc(100vw - 88px))` : "0px");
    content.hidden = state.collapsed; resizer.hidden = state.collapsed;
    const label = state.collapsed ? "Expand Share sidebar" : "Collapse Share sidebar";
    collapse.title = label; collapse.setAttribute("aria-label", label); collapse.setAttribute("aria-expanded", String(!state.collapsed));
    collapse.replaceChildren(createToolIcon(state.collapsed ? "arrowLeft" : "arrowRight"));
    for (const [tab, control] of tabButtons) control.setAttribute("aria-pressed", String(tab === state.tab));
    header.querySelector("strong")!.textContent = tabButtons.get(state.tab)!.title;
    resizer.setAttribute("aria-valuemin", "300"); resizer.setAttribute("aria-valuemax", "640"); resizer.setAttribute("aria-valuenow", String(state.width));
    if (state.pinned && !pane) {
      pane = createSharePane(api, true, {
        hideTabs: true,
        onTabChanged(tab) {
          if (!restoring && tab !== state.tab) { state.tab = tab; render(); persist(); }
        },
        onAlertsChanged(alerts) {
          for (const [name, count] of Object.entries(alerts)) {
            const control = alertButtons.get(name)!; control.hidden = count === 0;
            control.querySelector("span")!.textContent = count > 99 ? "99+" : String(count);
            const label = `${count} ${name === "requests" ? "join requests pending" : "unread messages"}`;
            control.title = label; control.setAttribute("aria-label", label);
          }
        }
      });
      host.append(pane); options.applyFormControls(host);
      for (const [tab, control] of tabButtons) {
        const panel = pane.querySelector<HTMLElement>(`[data-share-panel="${tab}"]`)!;
        panel.tabIndex = -1; control.setAttribute("aria-controls", panel.id);
      }
    }
    if (pane) {
      restoring = true;
      pane.selectShareTab(state.tab);
      pane.setShareVisible(state.pinned && !state.collapsed);
      restoring = false;
    }
    options.layoutChanged();
    if (lastPinned !== state.pinned) { lastPinned = state.pinned; pinListeners.forEach(callback => callback()); }
  }
  let drag: { id: number; x: number; width: number } | undefined;
  resizer.onpointerdown = event => {
    if (event.button !== 0) return;
    event.preventDefault(); drag = { id: event.pointerId, x: event.clientX, width: state.width }; resizer.setPointerCapture(event.pointerId);
  };
  resizer.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    state = normalizeShareSidebarState({ ...state, width: drag.width + drag.x - event.clientX }); render();
  };
  const finishDrag = () => { if (drag) { drag = undefined; persist(); } };
  resizer.onpointerup = finishDrag; resizer.onpointercancel = finishDrag; resizer.onlostpointercapture = finishDrag;
  resizer.onkeydown = event => {
    const width = event.key === "ArrowLeft" ? state.width + 20 : event.key === "ArrowRight" ? state.width - 20 : event.key === "Home" ? 300 : event.key === "End" ? 640 : undefined;
    if (width !== undefined) { event.preventDefault(); update({ width }); }
  };
  render();
  return {
    pinControl: {
      isPinned: () => state.pinned,
      toggle: () => update({ pinned: !state.pinned, collapsed: false }),
      subscribe(callback: () => void) { pinListeners.add(callback); return () => { pinListeners.delete(callback); }; }
    },
    restore(value: unknown) { if (pending || disposed) return; state = normalizeShareSidebarState(value); render(); },
    dispose() { disposed = true; pinListeners.clear(); cleanupPaneLayout(sidebar); sidebar.remove(); shell.style.removeProperty("--share-sidebar-size"); }
  };
}
