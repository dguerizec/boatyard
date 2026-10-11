const SVG_NS = "http://www.w3.org/2000/svg";

type IconNode = [tag: string, attrs: Record<string, string>][];

// Selected Lucide icons, kept as local data so the renderer never depends on a CDN.
const LUCIDE_TOOL_ICONS: Record<string, IconNode> = {
  users: [
    ["path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" }],
    ["circle", { cx: "9", cy: "7", r: "4" }]
  ],
  eyeOff: [["path", { d: "m3 3 18 18M10.6 10.6a2 2 0 0 0 2.8 2.8M9.9 5.2A11 11 0 0 1 12 5c7 0 10 7 10 7a16 16 0 0 1-3 4M6.5 6.5C3.5 8.5 2 12 2 12s3 7 10 7a11 11 0 0 0 5-1.2" }]],
  mousePointer: [
    ["path", { d: "M4.037 4.688a.495.495 0 0 1 .651-.651l16 6.5a.5.5 0 0 1-.063.947l-6.124 1.58a2 2 0 0 0-1.438 1.435l-1.579 6.126a.5.5 0 0 1-.947.063z" }]
  ],
  maximize: [
    ["path", { d: "M8 3H5a2 2 0 0 0-2 2v3" }],
    ["path", { d: "M21 8V5a2 2 0 0 0-2-2h-3" }],
    ["path", { d: "M3 16v3a2 2 0 0 0 2 2h3" }],
    ["path", { d: "M16 21h3a2 2 0 0 0 2-2v-3" }]
  ],
  minimize: [
    ["path", { d: "M8 3v3a2 2 0 0 1-2 2H3" }],
    ["path", { d: "M21 8h-3a2 2 0 0 1-2-2V3" }],
    ["path", { d: "M3 16h3a2 2 0 0 1 2 2v3" }],
    ["path", { d: "M16 21v-3a2 2 0 0 1 2-2h3" }]
  ],
  fullscreen: [
    ["path", { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ["path", { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ["path", { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ["path", { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
    ["rect", { width: "10", height: "8", x: "7", y: "8", rx: "1" }]
  ],
  zoomIn: [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65" }],
    ["line", { x1: "11", x2: "11", y1: "8", y2: "14" }],
    ["line", { x1: "8", x2: "14", y1: "11", y2: "11" }]
  ],
  zoomOut: [
    ["circle", { cx: "11", cy: "11", r: "8" }],
    ["line", { x1: "21", x2: "16.65", y1: "21", y2: "16.65" }],
    ["line", { x1: "8", x2: "14", y1: "11", y2: "11" }]
  ],
  keyboard: [
    ["path", { d: "M10 8h.01" }],
    ["path", { d: "M12 12h.01" }],
    ["path", { d: "M14 8h.01" }],
    ["path", { d: "M16 12h.01" }],
    ["path", { d: "M18 8h.01" }],
    ["path", { d: "M6 8h.01" }],
    ["path", { d: "M7 16h10" }],
    ["path", { d: "M8 12h.01" }],
    ["rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }]
  ],
  download: [
    ["path", { d: "M12 15V3" }],
    ["path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }],
    ["path", { d: "m7 10 5 5 5-5" }]
  ],
  unplug: [
    ["path", { d: "m19 5 3-3" }],
    ["path", { d: "m2 22 3-3" }],
    ["path", { d: "M6.3 20.3a2.4 2.4 0 0 0 3.4 0L12 18l-6-6-2.3 2.3a2.4 2.4 0 0 0 0 3.4Z" }],
    ["path", { d: "M7.5 13.5 10 11" }],
    ["path", { d: "M10.5 16.5 13 14" }],
    ["path", { d: "m12 6 6 6 2.3-2.3a2.4 2.4 0 0 0 0-3.4l-2.6-2.6a2.4 2.4 0 0 0-3.4 0Z" }]
  ],
  logOut: [
    ["path", { d: "m16 17 5-5-5-5" }],
    ["path", { d: "M21 12H9" }],
    ["path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }]
  ],
  send: [
    ["path", { d: "M14.536 21.686a.5.5 0 0 0 .937-.024l6.5-19a.496.496 0 0 0-.635-.635l-19 6.5a.5.5 0 0 0-.024.937l7.93 3.18a2 2 0 0 1 1.112 1.11z" }],
    ["path", { d: "m21.854 2.147-10.94 10.939" }]
  ],
  enter: [
    ["path", { d: "M20 4v7a4 4 0 0 1-4 4H4" }],
    ["path", { d: "m9 10-5 5 5 5" }]
  ],

  columns: [
    ["rect", { x: "3", y: "3", width: "18", height: "18", rx: "2" }],
    ["path", { d: "M12 3v18" }]
  ],
  save: [
    ["path", { d: "M15.2 3a2 2 0 0 1 1.4.6l3.8 3.8a2 2 0 0 1 .6 1.4V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z" }],
    ["path", { d: "M17 21v-7a1 1 0 0 0-1-1H8a1 1 0 0 0-1 1v7" }],
    ["path", { d: "M7 3v4a1 1 0 0 0 1 1h7" }]
  ],
  gitCompareArrows: [
    ["circle", { cx: "5", cy: "6", r: "3" }],
    ["path", { d: "M12 6h5a2 2 0 0 1 2 2v7" }],
    ["path", { d: "m15 9-3-3 3-3" }],
    ["circle", { cx: "19", cy: "18", r: "3" }],
    ["path", { d: "M12 18H7a2 2 0 0 1-2-2V9" }],
    ["path", { d: "m9 15 3 3-3 3" }]
  ],
  binary: [
    ["rect", { x: "14", y: "14", width: "4", height: "6", rx: "2" }],
    ["rect", { x: "6", y: "4", width: "4", height: "6", rx: "2" }],
    ["path", { d: "M6 20h4" }], ["path", { d: "M14 10h4" }],
    ["path", { d: "M6 14h2v6" }], ["path", { d: "M14 4h2v6" }]
  ],
  eye: [
    ["path", { d: "M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" }],
    ["circle", { cx: "12", cy: "12", r: "3" }]
  ],
  folderOpen: [
    ["path", { d: "m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2" }]
  ],
  folderTree: [
    ["path", { d: "M20 10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1h-2.5a1 1 0 0 1-.8-.4l-.9-1.2A1 1 0 0 0 15 3h-2a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" }],
    ["path", { d: "M20 21a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1h-2.9a1 1 0 0 1-.88-.55l-.42-.85a1 1 0 0 0-.92-.6H13a1 1 0 0 0-1 1v5a1 1 0 0 0 1 1Z" }],
    ["path", { d: "M3 5a2 2 0 0 0 2 2h3" }],
    ["path", { d: "M3 3v13a2 2 0 0 0 2 2h3" }]
  ],
  git: [
    ["circle", { cx: "6", cy: "3", r: "3" }],
    ["circle", { cx: "18", cy: "6", r: "3" }],
    ["circle", { cx: "6", cy: "21", r: "3" }],
    ["path", { d: "M6 6v12" }],
    ["path", { d: "M18 9a9 9 0 0 1-9 9" }]
  ],
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
  ],
  play: [
    ["polygon", { points: "6 3 20 12 6 21 6 3" }]
  ],
  square: [
    ["rect", { width: "18", height: "18", x: "3", y: "3", rx: "2" }]
  ]
};

const TOOL_ICONS: Record<string, string[]> = {
  fileEditor: [
    "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z",
    "M14 2v6h6",
    "M8 13h8",
    "M8 17h5"
  ],
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
  mail: [
    "M4 6h16v12H4z",
    "M4 7l8 6 8-6"
  ],
  navigationControls: [
    "M9 7l-5 5 5 5",
    "M15 7l5 5-5 5"
  ],
  panelLeft: [
    "M4 4h16v16H4z",
    "M9 4v16"
  ],
  panelRight: [
    "M4 4h16v16H4z",
    "M15 4v16"
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
  wrapText: [
    "M3 6h18",
    "M3 12h14a3 3 0 0 1 0 6h-4",
    "M16 15l-3 3 3 3",
    "M3 18h4"
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
  moon: [
    "M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z"
  ],
  sun: [
    "M12 2v2",
    "M12 20v2",
    "M4.93 4.93l1.42 1.42",
    "M17.66 17.66l1.41 1.41",
    "M2 12h2",
    "M20 12h2",
    "M6.34 17.66l-1.41 1.41",
    "M19.07 4.93l-1.41 1.41",
    "M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0z"
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
