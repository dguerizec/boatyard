import { createToolIcon } from "./toolIcons.js";
import type { BoatyardBridge } from "./rendererTypes.js";
import type { UnknownRecord } from "./rendererRecords.js";

export type ProjectSharing = {
  getState(id: string): boolean | undefined;
  isBusy(): boolean;
  toggle(id: string): Promise<void>;
};

export function updateProjectShareButton(button: HTMLButtonElement, sharing: ProjectSharing, id: string, name: string, menu = false) {
  const shared = sharing.getState(id);
  button.hidden = shared === undefined || !menu && !shared;
  button.disabled = sharing.isBusy();
  button.classList.toggle("project-is-shared", shared === true);
  button.setAttribute(menu ? "aria-checked" : "aria-pressed", String(shared === true));
  const action = shared ? "Mask project" : "Share project";
  button.title = `${name}: ${shared ? "Shared" : "Masked"}. ${action}.`;
  button.setAttribute("aria-label", `${action}: ${name}`);
  button.replaceChildren();
  if (shared) button.append(createToolIcon("eye"));
  if (menu) button.append("Share");
}

export function createProjectShareControls(api: BoatyardBridge, onChange: () => void) {
  let status: UnknownRecord = {}, revision = 0, disposed = false, busy = false;
  let projects = new Map<string, string>();
  let pending: Promise<void> | undefined;
  const apply = (value: UnknownRecord) => { if (!disposed) { status = value; onChange(); } };
  async function refreshProjects() {
    if (pending || disposed || !api.getShareProjects) return pending;
    pending = api.getShareProjects().then(values => {
      if (!disposed) { projects = new Map(values.map(project => [project.id, project.key])); onChange(); }
    }).catch(error => console.error("Could not load shared projects:", error)).finally(() => { pending = undefined; });
    return pending;
  }
  const unsubscribe = api.onRemoteStatusChanged?.(value => { revision++; apply(value); }, "share");
  const initialRevision = revision;
  void api.getRemoteStatus?.("share").then(value => { if (revision === initialRevision) apply(value); }).catch(error => console.error("Could not load sharing status:", error));
  void refreshProjects();
  return {
    getState(id: string) {
      if (status.listening !== true) return undefined;
      const key = projects.get(id);
      if (key === undefined) return undefined;
      return Array.isArray(status.sharedProjectIds) && status.sharedProjectIds.includes(key);
    },
    isBusy: () => busy,
    async toggle(id: string) {
      if (busy || disposed || this.getState(id) === undefined) return;
      if (!api.updateShareScreen) throw new Error("Screen controls are unavailable.");
      const shared = !this.getState(id);
      busy = true; onChange();
      try {
        const currentRevision = revision;
        const value = await api.updateShareScreen({ projectId: id, shared });
        if (revision === currentRevision) apply(value);
      } finally { busy = false; if (!disposed) onChange(); }
    },
    refreshProjects,
    dispose() { disposed = true; unsubscribe?.(); }
  };
}
