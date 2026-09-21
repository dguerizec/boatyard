import type { EditorRoot } from "./roots";
import type { EditorGitStatus } from "./git";
import { createToolIcon } from "../../renderer/toolIcons";
import type { ProjectDirectoryPage } from "./service";

type DirectoryNode = { path: string; list: HTMLUListElement; loaded: boolean; busy: boolean; offset: number | null; more?: HTMLLIElement };

export function createProjectFileBrowser({ list, openFile, openDiff, roots }: {
  roots?: { current: string; list(): Promise<EditorRoot[]>; select(path: string): Promise<void> };
  list(path: string, offset: number): Promise<ProjectDirectoryPage>;
  openFile(path: string): Promise<void>;
  openDiff(path: string, deleted: boolean): Promise<void>;
}) {
  const element = document.createElement("nav");
  element.className = "file-browser";
  element.setAttribute("aria-label", "Project files");
  const header = document.createElement("div");
  header.className = "file-browser-header";
  const title = document.createElement("select");
  title.className = "file-browser-root";
  title.setAttribute("aria-label", "Project files root");
  const rootControl = document.createElement("div");
  rootControl.className = "file-browser-root-control";
  const rootLabel = document.createElement("span");
  rootLabel.className = "file-browser-root-label";
  rootLabel.setAttribute("aria-hidden", "true");
  rootLabel.textContent = "Project files";
  rootControl.append(title, rootLabel);
  title.title = roots ? `Project files — ${roots.current}` : "Project files";
  title.add(new Option("Project files", roots?.current || ""));
  title.disabled = !roots;
  const rootMessage = document.createElement("div");
  rootMessage.className = "file-browser-message";
  rootMessage.setAttribute("role", "status");
  rootMessage.hidden = true;
  let rootsPending = false;
  async function refreshRoots() {
    if (!roots || rootsPending || disposed) return;
    rootsPending = true;
    try {
      const entries = await roots.list();
      if (disposed) return;
      title.replaceChildren(...entries.map(entry => {
        const option = new Option(`${entry.label} — ${entry.path}`, entry.path, false, entry.path === roots.current);
        option.disabled = !entry.usable;
        option.title = `${entry.label} — ${entry.path}`;
        return option;
      }));
      if (!entries.some(entry => entry.path === roots.current)) title.add(new Option("Unavailable worktree", roots.current, true, true));
      title.value = roots.current;
      const selected = entries.find(entry => entry.path === roots.current);
      rootLabel.textContent = selected?.label || "Unavailable worktree";
      title.title = `${rootLabel.textContent} — ${roots.current}`;
      rootMessage.hidden = true;
    } catch (error) {
      if (!disposed) { rootMessage.textContent = String(error instanceof Error ? error.message : error); rootMessage.hidden = false; }
    } finally { rootsPending = false; }
  }
  title.addEventListener("focus", () => void refreshRoots());
  title.addEventListener("change", async () => {
    if (!roots || title.value === roots.current) return;
    title.disabled = true;
    try { await roots.select(title.value); }
    catch (error) {
      if (!disposed) {
        title.value = roots.current;
        rootMessage.textContent = error instanceof Error ? error.message : String(error);
        rootMessage.hidden = false;
      }
    } finally { if (!disposed) title.disabled = false; }
  });
  const refreshButton = document.createElement("button");
  refreshButton.type = "button";
  refreshButton.className = "webapp-tool-button";
  refreshButton.title = "Refresh project files";
  refreshButton.setAttribute("aria-label", refreshButton.title);
  refreshButton.append(createToolIcon("refresh"));
  const tree = document.createElement("ul");
  tree.className = "file-browser-tree";
  const changesButton = document.createElement("button");
  changesButton.type = "button";
  changesButton.className = "webapp-tool-button";
  changesButton.title = "Show Git changes only";
  changesButton.setAttribute("aria-label", changesButton.title);
  changesButton.setAttribute("aria-pressed", "false");
  changesButton.append(createToolIcon("gitCompareArrows"));
  const actions = document.createElement("div");
  actions.className = "file-browser-actions";
  actions.append(changesButton, refreshButton);
  const gitMessage = document.createElement("div"); gitMessage.className = "file-browser-message"; gitMessage.hidden = true;
  header.append(rootControl, actions);
  element.append(header, rootMessage, gitMessage, tree);
  const expanded = new Set<string>();
  const directories = new Map<string, { node: DirectoryNode; toggle: HTMLButtonElement }>();
  const files = new Map<string, HTMLButtonElement[]>();
  let selected = "";
  let gitStatus: EditorGitStatus | undefined;
  let onlyChanges = false;
  let changesLimit = 100;
  const rows = new Map<string, { button: HTMLButtonElement; item: HTMLLIElement; directory: boolean }>();
  function deleted(path: string) {
    const entry = gitStatus?.changes.find((change) => change.path === path);
    return Boolean(entry && (entry.workingTreeStatus === "D" || (entry.indexStatus === "D" && entry.workingTreeStatus === ".")));
  }
  function decorate() {
    for (const [path, row] of rows) {
      const entry = gitStatus?.changes.find((change) => change.path === path);
      const child = row.directory && gitStatus?.changes.some((change) => change.path.startsWith(path + "/"));
      const signature = JSON.stringify([entry, child]);
      if (row.button.dataset.git === signature) continue;
      row.button.dataset.git = signature;
      row.button.querySelector(".file-browser-git-status")?.remove();
      row.item.querySelector(":scope > .file-browser-diff-button")?.remove();
      if (!entry && !child) continue;
      const code = child ? "●" : entry!.kind === "untracked" ? "?" : entry!.kind === "conflict" ? "U" :
        entry!.workingTreeStatus !== "." ? entry!.workingTreeStatus : entry!.indexStatus;
      const badge = document.createElement("span"); badge.className = "file-browser-git-status"; badge.textContent = code;
      badge.title = child ? "Contains Git changes" : `Git: ${entry!.indexStatus}${entry!.workingTreeStatus} (index / working tree)`;
      row.button.append(badge);
      if (!row.directory) {
        const diff = document.createElement("button"); diff.type = "button"; diff.className = "file-browser-diff-button";
        diff.title = `Open diff: ${path}`; diff.setAttribute("aria-label", diff.title); diff.append(createToolIcon("gitCompareArrows"));
        diff.addEventListener("click", () => void openDiff(path, deleted(path))); row.item.insertBefore(diff, row.button.nextSibling);
      }
    }
  }
  function renderChanges() {
    generation++; directories.clear(); files.clear(); rows.clear(); tree.replaceChildren();
    const changes = gitStatus?.changes || [];
    if (!changes.length) tree.append(message(gitStatus?.available ? "No Git changes" : "No Git working tree"));
    for (const entry of changes.slice(0, changesLimit)) {
      const item = document.createElement("li"), button = document.createElement("button");
      button.type = "button"; button.className = "file-browser-entry"; button.textContent = entry.path; button.title = entry.path;
      button.addEventListener("click", () => { void openDiff(entry.path, deleted(entry.path)); });
      item.append(button); rows.set(entry.path, { item, button, directory: false }); files.set(entry.path, [button]); tree.append(item);
    }
    if (changes.length > changesLimit) {
      const more = document.createElement("button"); more.type = "button"; more.textContent = `Load more (${changesLimit} of ${changes.length})`;
      more.addEventListener("click", () => { changesLimit += 100; renderChanges(); }); tree.append(more);
    }
    decorate(); syncSelected();
  }
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
        rows.set(entry.path, { button, item, directory: entry.kind === "directory" });
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
      decorate(); syncSelected();
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
    files.clear(); rows.clear();
    if (onlyChanges) { renderChanges(); return; }
    root = { path: "", list: tree, loaded: false, busy: false, offset: 0 };
    void load(root);
  }
  refreshButton.addEventListener("click", () => { refresh(); void refreshRoots(); });
  changesButton.addEventListener("click", () => { onlyChanges = !onlyChanges; changesButton.setAttribute("aria-pressed", String(onlyChanges)); refresh(); });
  return {
    element,
    show() { void refreshRoots(); if (onlyChanges) renderChanges(); else if (!root.loaded && !root.busy) void load(root); },
    setGitStatus(status: EditorGitStatus | undefined, error = "") {
      const changed = Boolean(status) && JSON.stringify(gitStatus) !== JSON.stringify(status);
      if (status) gitStatus = status;
      gitMessage.hidden = !error; gitMessage.textContent = error;
      changesButton.disabled = !gitStatus?.available;
      if (onlyChanges && changed) renderChanges(); else decorate();
    },
    setSelected(path: string) {
      selected = /^(?:[\\/]|[a-z]:[\\/])/i.test(path) ? "" : path;
      const parents = selected.split(/[\\/]/).slice(0, -1);
      for (let index = 1; index <= parents.length; index++) {
        const directory = parents.slice(0, index).join("/");
        expanded.add(directory);
        setExpanded(directory, true);
      }
      decorate(); syncSelected();
    },
    cleanup() { disposed = true; generation++; }
  };
}
