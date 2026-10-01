import type { TerminalCard, TerminalTab } from "./terminalTypes.js";

export function formatTerminalMemory(bytes: number | null | undefined) {
  if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) return "RAM —";
  return bytes >= 1024 ** 3
    ? `RAM ${(bytes / 1024 ** 3).toFixed(1)} GiB`
    : `RAM ${Math.round(bytes / 1024 ** 2)} MiB`;
}

export function clearTerminalFooterMemory(card: TerminalCard) {
  const memory = card.querySelector<HTMLElement>(".terminal-status-memory");
  if (memory) memory.textContent = formatTerminalMemory(null);
}

export function updateTerminalFooter(card: TerminalCard, tab: TerminalTab, { attached = false } = {}) {
  const status = card.querySelector<HTMLElement>(".terminal-status");
  // A periodic sample must not overwrite errors or a newer attachment.
  if (!status || (!attached && status.dataset.windowId !== tab.id)) return;
  let name = status.querySelector<HTMLElement>(".terminal-status-name");
  let memory = status.querySelector<HTMLElement>(".terminal-status-memory");
  if (!name || !memory) {
    name = document.createElement("span");
    name.className = "terminal-status-name";
    memory = document.createElement("span");
    memory.className = "terminal-status-memory";
    memory.title = "RAM (RSS): shell and descendant processes across all panes; shared memory may be counted more than once.";
    status.replaceChildren(name, document.createTextNode(" · "), memory);
  }
  status.dataset.windowId = tab.id;
  name.textContent = tab.name || `shell ${tab.index}`;
  memory.textContent = formatTerminalMemory(tab.memoryBytes);
}
