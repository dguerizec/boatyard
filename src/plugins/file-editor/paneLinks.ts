import type { ByteSelection } from "./selection";
type LinkGroup = { panes: string[]; path: string; paths: string[] };
type Listener = (linked: boolean, path?: string, paths?: readonly string[]) => void;

/** File navigation is shared; each pane keeps its own view mode and position. */
export class EditorPaneLinks {
  private selectionListeners = new Map<string, (path: string, selection: ByteSelection) => void>();
  private groups: LinkGroup[] = [];
  private listeners = new Map<string, Listener>();

  constructor(private save: (groups: LinkGroup[]) => void, saved: unknown = []) {
    const seen = new Set<string>();
    if (Array.isArray(saved)) for (const group of saved) {
      if (!group || !Array.isArray(group.panes) || typeof group.path !== "string") continue;
      const panes = group.panes.filter((id: unknown): id is string => typeof id === "string" && !seen.has(id));
      const unique = [...new Set<string>(panes)];
      if (unique.length < 2) continue;
      unique.forEach((id) => seen.add(id));
      const paths = Array.isArray(group.paths) ? [...new Set<string>(group.paths.filter((path: unknown): path is string => typeof path === "string" && Boolean(path)))] : group.path ? [group.path] : [];
      this.groups.push({ panes: unique, path: paths.includes(group.path) ? group.path : paths[0] || "", paths });
    }
  }

  private notify() {
    this.save(this.groups);
    for (const [pane, listener] of this.listeners) {
      const group = this.groups.find((entry) => entry.panes.includes(pane));
      listener(Boolean(group), group?.path, group ? [...group.paths] : undefined);
    }
  }

  watchSelection(pane: string, listener: (path: string, selection: ByteSelection) => void) {
    this.selectionListeners.set(pane, listener);
    return () => { if (this.selectionListeners.get(pane) === listener) this.selectionListeners.delete(pane); };
  }

  selected(pane: string, path: string, selection: ByteSelection) {
    const group = this.groups.find((entry) => entry.panes.includes(pane));
    if (!group || group.path !== path) return;
    for (const peer of group.panes) if (peer !== pane) this.selectionListeners.get(peer)?.(path, { ...selection });
  }

  peers(pane: string): string[] {
    return this.groups.find((group) => group.panes.includes(pane))?.panes || [];
  }

  attach(pane: string, listener: Listener) {
    this.listeners.set(pane, listener);
    const group = this.groups.find((entry) => entry.panes.includes(pane));
    listener(Boolean(group), group?.path, group ? [...group.paths] : undefined);
    return () => { if (this.listeners.get(pane) === listener) this.listeners.delete(pane); };
  }

  link(source: string, target: string, path: string, paths: readonly string[] = [path]) {
    if (source === target) return;
    this.remove(target);
    let group = this.groups.find((entry) => entry.panes.includes(source));
    if (!group) {
      group = { panes: [source], path, paths: [...paths] };
      this.groups.push(group);
    }
    group.panes.push(target);
    group.path = path;
    group.paths = [...paths];
    this.notify();
  }

  private remove(pane: string) {
    this.groups = this.groups.map((group) => ({ ...group, panes: group.panes.filter((id) => id !== pane) }))
      .filter((group) => group.panes.length > 1);
  }

  unlink(pane: string) {
    this.remove(pane);
    this.notify();
  }

  opened(pane: string, path: string, paths?: readonly string[]) {
    const group = this.groups.find((entry) => entry.panes.includes(pane));
    if (!group) return;
    const next = paths ? [...paths] : [...new Set([...group.paths, path].filter(Boolean))];
    if (group.path === path && JSON.stringify(group.paths) === JSON.stringify(next)) return;
    group.paths = next;
    group.path = path;
    this.notify();
  }
}
