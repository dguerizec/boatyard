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
  ],
  link: [
    ["path", { d: "M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" }],
    ["path", { d: "M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" }]
  ]
};

const TOOL_ICONS: Record<string, string[]> = {
  alert: [
    "M12 9v4",
    "M12 17h.01",
    "M10.3 4.1 2.7 18a2 2 0 0 0 1.8 3h15a2 2 0 0 0 1.8-3L13.7 4.1a2 2 0 0 0-3.4 0z"
  ],
  arrowLeft: [
    "M19 12H5",
    "M12 5l-7 7 7 7"
  ],
  arrowRight: [
    "M5 12h14",
    "M12 5l7 7-7 7"
  ],
  check: [
    "M5 12l4 4L19 6"
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
  grid: [
    "M4 4h6v6H4z",
    "M14 4h6v6h-6z",
    "M4 14h6v6H4z",
    "M14 14h6v6h-6z"
  ],
  info: [
    "M12 11v6",
    "M12 7h.01",
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z"
  ],
  lock: [
    "M6.5 10V7.5a5.5 5.5 0 0 1 11 0V10",
    "M5.5 10h13a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 18.5 20h-13A1.5 1.5 0 0 1 4 18.5v-7A1.5 1.5 0 0 1 5.5 10z"
  ],
  pencil: [
    "M12 20h9",
    "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"
  ],
  plug: [
    "M8 12 16 4",
    "M14 4l6 6",
    "M4 14l6 6",
    "M11 9l4 4",
    "M7 17l-3 3"
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
  search: [
    "M20 20l-4.4-4.4",
    "M18 11a7 7 0 1 1-14 0 7 7 0 0 1 14 0z"
  ],
  settingsGlobe: [
    "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z",
    "M3 12h18",
    "M12 3c2.4 2.5 3.7 5.5 3.7 9S14.4 18.5 12 21c-2.4-2.5-3.7-5.5-3.7-9S9.6 5.5 12 3z"
  ],
  settingsMonitor: [
    "M3 4h18v13H3z",
    "M8 21h8",
    "M12 17v4"
  ],
  settingsShield: [
    "M12 3 4.5 6v5.5c0 4.5 3.2 7.8 7.5 9.5 4.3-1.7 7.5-5 7.5-9.5V6z",
    "M9 12l2 2 4-4"
  ],
  sliders: [
    "M4 6h10",
    "M18 6h2",
    "M4 12h3",
    "M11 12h9",
    "M4 18h8",
    "M16 18h4",
    "M16 4v4",
    "M9 10v4",
    "M14 16v4"
  ],
  shrinkPane: [
    "M10 3v7H3",
    "M10 10L3 3",
    "M14 21v-7h7",
    "M14 14l7 7"
  ],
  smartphone: [
    "M8 2.5h8A2.5 2.5 0 0 1 18.5 5v14A2.5 2.5 0 0 1 16 21.5H8A2.5 2.5 0 0 1 5.5 19V5A2.5 2.5 0 0 1 8 2.5z",
    "M10 18.5h4"
  ],
  splitHorizontal: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M4 12h16"
  ],
  splitVertical: [
    "M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v13c0 .83-.67 1.5-1.5 1.5h-13C4.67 20 4 19.33 4 18.5z",
    "M12 4v16"
  ],
  terminal: [
    "M3 4h18v16H3z",
    "M7 9l3 3-3 3",
    "M13 15h4"
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

export function hasToolIcon(name: string) {
  return Boolean(LUCIDE_TOOL_ICONS[name]?.length || TOOL_ICONS[name]?.length);
}
