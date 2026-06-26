export type WebAppMiniLayoutPaneNode = {
  id?: string;
  selectedWebAppId?: string | null;
  type: "pane";
};

export type WebAppMiniLayoutNode = WebAppMiniLayoutPaneNode | {
  direction?: string;
  first?: WebAppMiniLayoutNode;
  id?: string;
  ratio?: number;
  second?: WebAppMiniLayoutNode;
  type: "split";
};

type WebAppMiniPaneRenderOptions = {
  classNames?: string[];
  disabled?: boolean;
  input?: {
    checked?: boolean;
    disabled?: boolean;
    name: string;
    onChange?: () => void;
    onFocus?: () => void;
    type?: "radio";
    value: string;
  };
  label: string;
  onClick?: () => void;
  onPointerEnter?: () => void;
  onPointerLeave?: () => void;
  title?: string;
};

type WebAppMiniLayoutOptions = {
  layout: WebAppMiniLayoutNode;
  paneClassName?: string;
  renderPane: (pane: WebAppMiniLayoutPaneNode, index: number) => WebAppMiniPaneRenderOptions;
  title: string;
};

export function isWebAppMiniLayoutNode(node: unknown): node is WebAppMiniLayoutNode {
  return Boolean(node && typeof node === "object" && ["pane", "split"].includes(String((node as { type?: string }).type)));
}

export function findWebAppMiniLayoutPaneNode(
  node: WebAppMiniLayoutNode | null | undefined,
  paneId?: string
): WebAppMiniLayoutPaneNode | null {
  if (!node || !paneId) {
    return null;
  }

  if (node.type === "pane") {
    return node.id === paneId ? node : null;
  }

  return findWebAppMiniLayoutPaneNode(node.first, paneId) || findWebAppMiniLayoutPaneNode(node.second, paneId);
}

export function createWebAppMiniLayout({
  layout,
  paneClassName = "",
  renderPane,
  title
}: WebAppMiniLayoutOptions) {
  const shell = document.createElement("section");
  shell.className = "webapp-open-mini-layout";

  const titleElement = document.createElement("span");
  titleElement.className = "webapp-open-mini-title";
  titleElement.textContent = title;

  const surface = document.createElement("div");
  surface.className = "webapp-open-mini-surface";

  function createNode(node: WebAppMiniLayoutNode, paneIndex = { value: 0 }): HTMLElement {
    if (node.type === "pane") {
      const paneOptions = renderPane(node, paneIndex.value);
      const pane = document.createElement(paneOptions.input ? "label" : "div");
      pane.className = ["webapp-open-mini-pane", paneClassName, ...(paneOptions.classNames || [])]
        .filter(Boolean)
        .join(" ");
      pane.classList.toggle("disabled", paneOptions.disabled === true);
      pane.dataset.paneId = node.id || "";
      pane.title = paneOptions.title || paneOptions.label;

      if (paneOptions.input) {
        const input = document.createElement("input");
        input.type = paneOptions.input.type || "radio";
        input.name = paneOptions.input.name;
        input.value = paneOptions.input.value;
        input.checked = paneOptions.input.checked === true;
        input.disabled = paneOptions.input.disabled === true;
        if (paneOptions.input.onChange) {
          input.addEventListener("change", paneOptions.input.onChange);
        }
        if (paneOptions.input.onFocus) {
          input.addEventListener("focus", paneOptions.input.onFocus);
        }
        pane.append(input);
      }

      const name = document.createElement("span");
      name.textContent = paneOptions.label;
      pane.append(name);

      if (paneOptions.onPointerEnter) {
        pane.addEventListener("pointerenter", paneOptions.onPointerEnter);
      }
      if (paneOptions.onPointerLeave) {
        pane.addEventListener("pointerleave", paneOptions.onPointerLeave);
      }
      if (paneOptions.onClick) {
        pane.addEventListener("click", paneOptions.onClick);
      }

      paneIndex.value += 1;
      return pane;
    }

    const split = document.createElement("div");
    split.className = `webapp-open-mini-split ${node.direction === "horizontal" ? "horizontal" : "vertical"}`;
    const ratio = Math.min(0.85, Math.max(0.15, Number(node.ratio) || 0.5));
    if (node.direction === "horizontal") {
      split.style.gridTemplateRows = `${ratio}fr ${(1 - ratio)}fr`;
    } else {
      split.style.gridTemplateColumns = `${ratio}fr ${(1 - ratio)}fr`;
    }
    if (node.first) {
      split.append(createNode(node.first, paneIndex));
    }
    if (node.second) {
      split.append(createNode(node.second, paneIndex));
    }
    return split;
  }

  surface.append(createNode(layout));
  shell.append(titleElement, surface);
  return shell;
}
