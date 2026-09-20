type LinkGroup = { panes: string[]; path: string };
type Listener = (linked: boolean, path?: string) => void;

/** File navigation is shared; each pane keeps its own view mode and position. */
export class EditorPaneLinks {
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
      this.groups.push({ panes: unique, path: group.path });
    }
  }

  private notify() {
    this.save(this.groups);
    for (const [pane, listener] of this.listeners) {
      const group = this.groups.find((entry) => entry.panes.includes(pane));
      listener(Boolean(group), group?.path);
    }
  }

  peers(pane: string): string[] {
    return this.groups.find((group) => group.panes.includes(pane))?.panes || [];
  }

  attach(pane: string, listener: Listener) {
    this.listeners.set(pane, listener);
    const group = this.groups.find((entry) => entry.panes.includes(pane));
    listener(Boolean(group), group?.path);
    return () => { if (this.listeners.get(pane) === listener) this.listeners.delete(pane); };
  }

  link(source: string, target: string, path: string) {
    if (source === target) return;
    this.remove(target);
    let group = this.groups.find((entry) => entry.panes.includes(source));
    if (!group) {
      group = { panes: [source], path };
      this.groups.push(group);
    }
    group.panes.push(target);
    group.path = path;
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

  opened(pane: string, path: string) {
    const group = this.groups.find((entry) => entry.panes.includes(pane));
    if (!group || group.path === path) return;
    group.path = path;
    this.notify();
  }
}
