import mermaid from "mermaid";

let sequence = 0;
let pending: Promise<unknown> = Promise.resolve();

/** Mermaid owns global configuration, so render requests across panes are serialized. */
export function renderDiagram(source: string, dark: boolean): Promise<string> {
  const operation = pending.then(async () => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      theme: dark ? "dark" : "default",
      suppressErrorRendering: true,
      maxTextSize: 50000,
      maxEdges: 500,
      flowchart: { htmlLabels: false }
    });
    const { svg } = await mermaid.render(`boatyard-diagram-${++sequence}`, source);
    // Explicit intrinsic dimensions keep SVG images readable outside an inline SVG context.
    const document = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = document.documentElement;
    const bounds = (root.getAttribute("viewBox") || "").trim().split(/[ ,]+/).map(Number);
    if (bounds.length === 4 && bounds[2] > 0 && bounds[3] > 0) {
      root.setAttribute("width", String(bounds[2]));
      root.setAttribute("height", String(bounds[3]));
    }
    return new XMLSerializer().serializeToString(root);
  });
  pending = operation.catch(() => undefined);
  return operation;
}
