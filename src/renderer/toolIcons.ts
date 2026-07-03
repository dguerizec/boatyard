const SVG_NS = "http://www.w3.org/2000/svg";

type IconNode = [tag: string, attrs: Record<string, string>][];

// KeyRound from Lucide, kept as local icon data so the renderer never depends on a CDN.
const LUCIDE_TOOL_ICONS: Record<string, IconNode> = {
  key: [
    [
      "path",
      {
        d: "M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"
      }
    ],
    ["circle", { cx: "16.5", cy: "7.5", r: ".5", fill: "currentColor" }]
  ]
};

const TOOL_ICONS: Record<string, string[]> = {
  arrowLeft: [
    "M19 12H5",
    "M12 5l-7 7 7 7"
  ],
  arrowRight: [
    "M5 12h14",
    "M12 5l7 7-7 7"
  ],
  close: [
    "M6 6l12 12",
    "M18 6L6 18"
  ],
  expandPane: [
    "M8 3H3v5",
    "M3 3l7 7",
    "M16 21h5v-5",
    "M21 21l-7-7"
  ],
  home: [
    "M4 11.5L12 5l8 6.5",
    "M6.5 10v9h11v-9",
    "M10 19v-5h4v5"
  ],
  lock: [
    "M6.5 10V7.5a5.5 5.5 0 0 1 11 0V10",
    "M5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-7A1.5 1.5 0 0 1 5.5 10z"
  ],
  pencil: [
    "M12 20h9",
    "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
  ],
  plus: [
    "M12 5v14",
    "M5 12h14"
  ],
  refresh: [
    "M20 6v5h-5",
    "M4 18v-5h5",
    "M18 11a6.5 6.5 0 0 0-11.42-4.24L4 9",
    "M6 13a6.5 6.5 0 0 0 11.42 4.24L20 15"
  ],
  shrinkPane: [
    "M10 3v7H3",
    "M10 10L3 3",
    "M14 21v-7h7",
    "M14 14l7 7"
  ],
  splitHorizontal: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M4 12h16"
  ],
  splitVertical: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M12 4v16"
  ],
  trash: [
    "M3 6h18",
    "M8 6V4h8v2",
    "M6 6l1 14h10l1-14",
    "M10 11v5",
    "M14 11v5"
  ]
};

export function createToolIcon(name: string) {
  const icon = document.createElementNS(SVG_NS, "svg");
  icon.classList.add("webapp-tool-icon");
  icon.setAttribute("viewBox", "0 0 24 24");
  icon.setAttribute("aria-hidden", "true");
  icon.setAttribute("focusable", "false");

  for (const [tag, attrs] of LUCIDE_TOOL_ICONS[name] || []) {
    const element = document.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      element.setAttribute(key, value);
    }
    icon.append(element);
  }

  for (const d of TOOL_ICONS[name] || []) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    icon.append(path);
  }

  return icon;
}
