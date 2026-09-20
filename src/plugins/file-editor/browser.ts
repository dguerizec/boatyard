import type { ProjectDirectoryPage } from "./service";

type DirectoryNode = { path: string; list: HTMLUListElement; loaded: boolean; busy: boolean; offset: number | null; more?: HTMLLIElement };

export function createProjectFileBrowser({ list, openFile }: {
  list(path: string, offset: number): Promise<ProjectDirectoryPage>;
  openFile(path: string): Promise<void>;
}) {
  const element = document.createElement("nav");
  element.className = "file-browser";
  element.setAttribute("aria-label", "Project files");
  const header = document.createElement("div");
  header.className = "file-browser-header";
  const title = document.createElement("strong");
  title.textContent = "Project files";
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.textContent = "Refresh";
  const tree = document.createElement("ul");
  tree.className = "file-browser-tree";
  header.append(title, refreshButton);
  element.append(header, tree);
  const expanded = new Set<string>();
  const directories = new Map<string, { node: DirectoryNode; toggle: HTMLButtonElement }>();
  const files = new Map<string, HTMLButtonElement[]>();
  let selected = "";
  let disposed = false;
  let generation = 0;
  let root: DirectoryNode = { path: "", list: tree, loaded: false, busy: false, offset: 0 };

  function message(text: string) {
    const item = document.createElement("li");
    item.className = "file-browser-message";
    item.textContent = text;
    item.setAttribute("role", "status");
    return item;
  }
  function syncSelected() {
    for (const [path, buttons] of files) {
      for (const button of buttons) {
        if (path === selected) button.setAttribute("aria-current", "page");
        else button.removeAttribute("aria-current");
      }
    }
  }
  function setExpanded(path: string, open: boolean) {
    const entry = directories.get(path);
    if (!entry) return;
    if (open) expanded.add(path);
    else expanded.delete(path);
    entry.toggle.setAttribute("aria-expanded", String(open));
    entry.toggle.querySelector("span")!.textContent = open ? "▾" : "▸";
    entry.node.list.hidden = !open;
    if (open && !entry.node.loaded) void load(entry.node);
  }
  async function load(node: DirectoryNode, more = false) {
    if (disposed || node.busy || (more && node.offset === null)) return;
    node.busy = true;
    const version = generation;
    node.more?.remove();
    if (!more) node.list.replaceChildren();
    const loading = message("Loading…");
    node.list.append(loading);
    try {
      const page = await list(node.path, more ? node.offset || 0 : 0);
      if (disposed || version !== generation) return;
      loading.remove();
      node.loaded = true;
      node.offset = page.nextOffset;
      if (!page.total) node.list.append(message("Empty folder"));
      for (const entry of page.entries) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        button.className = "file-browser-entry";
        button.title = entry.kind === "unavailable" ? `${entry.path} — unavailable or outside this project` : entry.path;
        const icon = document.createElement("span");
        icon.className = "file-browser-entry-icon";
        icon.setAttribute("aria-hidden", "true");
        icon.textContent = entry.kind === "directory" ? "▸" : "·";
        const name = document.createElement("span");
        name.className = "file-browser-entry-name";
        name.textContent = entry.name;
        button.append(icon, name);
        item.append(button);
        if (entry.kind === "directory") {
          const children = document.createElement("ul");
          children.hidden = true;
          item.append(children);
          const child: DirectoryNode = { path: entry.path, list: children, loaded: false, busy: false, offset: 0 };
          directories.set(entry.path, { node: child, toggle: button });
          button.setAttribute("aria-expanded", "false");
          button.addEventListener("click", () => setExpanded(entry.path, !expanded.has(entry.path)));
          button.addEventListener("keydown", (event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault();
              setExpanded(entry.path, event.key === "ArrowRight");
            }
          });
          if (expanded.has(entry.path)) setExpanded(entry.path, true);
        } else {
          button.disabled = entry.kind === "unavailable";
          files.set(entry.path, [...files.get(entry.path) || [], button]);
          button.addEventListener("click", () => void openFile(entry.path));
        }
        node.list.append(item);
      }
      if (page.nextOffset !== null) {
        const item = document.createElement("li");
        const moreButton = document.createElement("button");
        moreButton.type = "button";
        moreButton.className = "file-browser-more";
        moreButton.textContent = `Load more (${page.nextOffset} of ${page.total})`;
        moreButton.addEventListener("click", () => void load(node, true));
        item.append(moreButton);
        node.more = item;
        node.list.append(item);
      }
      syncSelected();
    } catch (error) {
      if (disposed || version !== generation) return;
      loading.textContent = error instanceof Error ? error.message : String(error);
      const retry = document.createElement("button");
      retry.type = "button";
      retry.textContent = "Retry";
      retry.addEventListener("click", () => { loading.remove(); void load(node, more); });
      loading.append(retry);
    } finally {
      node.busy = false;
    }
  }
  function refresh() {
    generation++;
    directories.clear();
    files.clear();
    root = { path: "", list: tree, loaded: false, busy: false, offset: 0 };
    void load(root);
  }
  refreshButton.addEventListener("click", refresh);
  return {
    element,
    show() { if (!root.loaded && !root.busy) void load(root); },
    setSelected(path: string) {
      selected = /^(?:[\\/]|[a-z]:[\\/])/i.test(path) ? "" : path;
      const parents = selected.split(/[\\/]/).slice(0, -1);
      for (let index = 1; index <= parents.length; index++) {
        const directory = parents.slice(0, index).join("/");
        expanded.add(directory);
        setExpanded(directory, true);
      }
      syncSelected();
    },
    cleanup() { disposed = true; generation++; }
  };
}
