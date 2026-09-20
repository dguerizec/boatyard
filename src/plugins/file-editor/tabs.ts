import { createToolIcon } from "../../renderer/toolIcons";

export class FileTabs {
  paths: string[];
  active = "";
  constructor(saved?: unknown) {
    this.paths = Array.isArray(saved) ? [...new Set(saved.filter((path): path is string => typeof path === "string" && Boolean(path) && !path.includes("\0")))] : [];
  }
  open(path: string) { if (!this.paths.includes(path)) this.paths.push(path); this.active = path; }
  neighbor(path: string) {
    const index = this.paths.indexOf(path);
    return index < 0 ? "" : this.paths[index + 1] || this.paths[index - 1] || "";
  }
  close(path: string) {
    const next = this.neighbor(path);
    this.paths = this.paths.filter((entry) => entry !== path);
    if (this.active === path) this.active = next;
  }
}

export function createFileTabs(model: FileTabs, options: {
  select(path: string): Promise<void>;
  close(path: string): Promise<void>;
  dirty(path: string): boolean;
}) {
  const element = document.createElement("div");
  element.className = "file-editor-tabs";
  element.setAttribute("role", "tablist");
  element.setAttribute("aria-label", "Open files");
  const items = new Map<string, { host: HTMLElement; tab: HTMLButtonElement; label: HTMLElement; close: HTMLButtonElement }>();
  function update(disabled = false) {
    for (const [path, item] of items) if (!model.paths.includes(path)) { item.host.remove(); items.delete(path); }
    for (const path of model.paths) {
      let item = items.get(path);
      if (!item) {
        const host = document.createElement("div"); host.className = "file-editor-tab"; host.setAttribute("role", "presentation");
        const tab = document.createElement("button"); tab.type = "button"; tab.setAttribute("role", "tab");
        const label = document.createElement("span"); tab.append(label);
        const close = document.createElement("button"); close.type = "button"; close.className = "file-editor-tab-close";
        close.append(createToolIcon("close")); close.setAttribute("aria-label", `Close ${path}`);
        close.title = "Close tab · Unsaved drafts are kept";
        tab.addEventListener("click", () => void options.select(path));
        close.addEventListener("click", () => void options.close(path));
        host.addEventListener("auxclick", (event) => { if (event.button === 1 && !tab.disabled) { event.preventDefault(); void options.close(path); } });
        tab.addEventListener("keydown", (event) => {
          const index = model.paths.indexOf(path);
          const target = event.key === "ArrowRight" ? model.paths[(index + 1) % model.paths.length]
            : event.key === "ArrowLeft" ? model.paths[(index - 1 + model.paths.length) % model.paths.length]
            : event.key === "Home" ? model.paths[0] : event.key === "End" ? model.paths.at(-1) : undefined;
          if (target) { event.preventDefault(); items.get(target)?.tab.focus(); void options.select(target).then(() => items.get(target)?.tab.focus()); }
          if (event.key === "Delete") { event.preventDefault(); void options.close(path); }
        });
        host.append(tab, close); element.append(host); item = { host, tab, label, close }; items.set(path, item);
      }
      const name = path.split(/[\\/]/).pop() || path;
      const duplicate = model.paths.some((other) => other !== path && other.split(/[\\/]/).pop() === name);
      const dirty = options.dirty(path);
      item.label.textContent = `${dirty ? "● " : ""}${duplicate ? path : name}`;
      item.tab.title = `${path}${dirty ? " · Unsaved changes" : ""}`;
      item.tab.setAttribute("aria-label", item.tab.title);
      item.tab.setAttribute("aria-selected", String(path === model.active));
      item.tab.tabIndex = path === model.active || !model.active && path === model.paths[0] ? 0 : -1;
      item.host.classList.toggle("active", path === model.active);
      item.tab.disabled = item.close.disabled = disabled;
    }
  }
  return { element, update, reveal() { items.get(model.active)?.host.scrollIntoView({ block: "nearest", inline: "nearest" }); } };
}
