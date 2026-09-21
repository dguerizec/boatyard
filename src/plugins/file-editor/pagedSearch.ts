/** Persistent pane-owned search controls survive editor block replacements. */
export function createPagedSearch(run: (backward?: boolean) => void, changed: () => void, closed: () => void) {
  const dom = document.createElement("div");
  dom.className = "file-editor-toolbar file-editor-paged-search";
  dom.hidden = true; dom.setAttribute("role", "search");
  const input = document.createElement("input");
  input.placeholder = "Find in entire file"; input.title = "Literal text search across the entire file, including unsaved changes"; input.setAttribute("aria-label", "Find in entire file");
  const matchCase = document.createElement("input"); matchCase.type = "checkbox";
  const label = document.createElement("label"); label.append(matchCase, "Match case");
  const status = document.createElement("span"); status.setAttribute("role", "status");
  const action = (name: string, callback: () => void) => {
    const button = document.createElement("button"); button.type = "button"; button.textContent = name;
    button.addEventListener("click", callback); return button;
  };
  const close = () => { if (dom.hidden) return; dom.hidden = true; changed(); closed(); };
  input.addEventListener("input", () => { status.textContent = ""; changed(); });
  matchCase.addEventListener("change", () => { status.textContent = ""; changed(); });
  dom.addEventListener("keydown", (event) => {
    if (event.key === "Escape") { event.preventDefault(); close(); }
    if (event.key === "Enter") { event.preventDefault(); run(event.shiftKey ? true : undefined); }
  });
  dom.append(input, action("Previous", () => run(true)), action("Next", () => run(false)), label, action("Close", close), status);
  return { dom, input, matchCase, status, close,
    open() { dom.hidden = false; input.focus(); input.select(); },
    get visible() { return !dom.hidden; }
  };
}
