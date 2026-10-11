import type { BoatyardBridge } from "./rendererTypes.js";

export function appendRemoteConnectionLinks(container: HTMLElement, urls: string[], api: BoatyardBridge, onError: (reason: unknown) => void, options: { hideFragment?: boolean; code?: string; showCodeButton?: boolean } = {}) {
  if (!urls.length) return;
  const row = document.createElement("div"), select = document.createElement("select"), open = document.createElement("a"), copy = document.createElement("button");
  row.className = "remote-url-selector";
  select.className = "form-control";
  select.setAttribute("aria-label", "Connection URL");
  // Keep invitation codes out of visible text and option values in the shared window.
  urls.forEach((url, index) => {
    const option = document.createElement("option"), display = new URL(url);
    if (options.hideFragment) display.hash = "";
    option.value = String(index); option.textContent = display.href; select.append(option);
  });
  open.textContent = "Open"; open.target = "_blank"; open.rel = "noopener noreferrer";
  copy.type = "button"; copy.className = "secondary-button"; copy.textContent = "Copy URL";
  const selectedUrl = () => urls[Number(select.value)];
  const update = () => { open.href = selectedUrl(); copy.textContent = "Copy URL"; };
  select.onchange = update; update();
  copy.onclick = async () => {
    try {
      if (!api.writeClipboardText) throw new Error("Clipboard access is unavailable.");
      await api.writeClipboardText(selectedUrl());
      if (copy.isConnected) copy.textContent = "Copied";
    } catch (reason) { onError(reason); }
  };
  row.append(select, open, copy);
  if (options.code || options.showCodeButton) {
    const copyCode = document.createElement("button"); copyCode.type = "button"; copyCode.className = "secondary-button"; copyCode.textContent = "Copy code";
    copyCode.dataset.copyCode = ""; copyCode.disabled = !options.code;
    if (!options.code) copyCode.title = "No code is needed for Ask to join.";
    copyCode.onclick = async () => {
      if (!options.code) return;
      try {
        if (!api.writeClipboardText) throw new Error("Clipboard access is unavailable.");
        await api.writeClipboardText(options.code!.replace(/^(\d{3})(\d{3})$/, "$1 $2"));
        if (copyCode.isConnected) copyCode.textContent = "Copied";
      } catch (reason) { onError(reason); }
    };
    row.append(copyCode);
  }
  container.append(row);
}
