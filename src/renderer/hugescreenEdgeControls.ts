import { DEFAULT_HUGESCREEN_ZONES, HUGESCREEN_EDGES, MAX_HUGESCREEN_ZONE, effectiveHugescreenZones,
  normalizeHugescreenZones, type HugescreenEdgeName, type HugescreenZones } from "./hugescreenZones.js";

/** Edits a draft; the caller owns Apply and Cancel. */
export function setupHugescreenEdgeControls(preview: HTMLElement) {
  const svg = preview.querySelector("svg")!;
  const layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
  layer.classList.add("hugescreen-edge-zones");
  svg.append(layer);
  const editor = document.createElement("fieldset");
  editor.className = "hugescreen-edge-editor";
  editor.disabled = true;
  editor.innerHTML = `<p class="hugescreen-size-hint">Click a screen edge to adjust its trigger zone.</p>
    <label class="field"><span class="hugescreen-slider-label"><span data-zone-label></span><output></output></span>
    <input type="range" min="1" max="${MAX_HUGESCREEN_ZONE}" step="1" value="3"></label>
    <p class="hugescreen-size-hint">Measured inward from the usable screen edge, beside desktop bars.</p>`;
  preview.after(editor);
  const input = editor.querySelector("input")!;
  const label = editor.querySelector<HTMLElement>("[data-zone-label]")!;
  const output = editor.querySelector("output")!;
  let zones = { ...DEFAULT_HUGESCREEN_ZONES };
  let selected: HugescreenEdgeName = "bottom";
  let visible = false;
  let area = { x: 0, y: 0, width: 0, height: 0 };
  const rectangles = HUGESCREEN_EDGES.map(edge => {
    const zone = document.createElementNS(svg.namespaceURI, "rect") as SVGRectElement;
    zone.classList.add("hugescreen-edge-zone");
    const hit = document.createElementNS(svg.namespaceURI, "rect") as SVGRectElement;
    hit.classList.add("hugescreen-edge-hit");
    hit.dataset.edge = edge;
    hit.setAttribute("role", "button");
    const choose = () => {
      if (editor.disabled) return;
      selected = edge;
      render();
      input.focus();
    };
    hit.addEventListener("click", choose);
    hit.addEventListener("keydown", event => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); choose(); }
    });
    layer.append(zone, hit);
    return { edge, zone, hit };
  });
  const render = () => {
    editor.hidden = !visible;
    preview.classList.toggle("editing-edges", visible);
    layer.style.display = visible ? "" : "none";
    svg.setAttribute("role", visible ? "group" : "img");
    label.textContent = `${selected[0]!.toUpperCase()}${selected.slice(1)} trigger zone`;
    output.value = `${zones[selected]} px`;
    input.value = String(zones[selected]);
    input.setAttribute("aria-label", `${selected} trigger zone width`);
    input.setAttribute("aria-valuetext", `${zones[selected]} pixels`);
    const effective = effectiveHugescreenZones(zones, area.width, area.height);
    for (const { edge, zone, hit } of rectangles) {
      const horizontal = edge === "top" || edge === "bottom";
      const rect = { x: area.x + (edge === "right" ? area.width - effective.right : 0),
        y: area.y + (edge === "bottom" ? area.height - effective.bottom : 0),
        width: horizontal ? area.width : effective[edge], height: horizontal ? effective[edge] : area.height };
      for (const element of [zone, hit]) {
        for (const [key, value] of Object.entries(rect)) element.setAttribute(key, String(value));
      }
      zone.classList.toggle("selected", edge === selected);
      hit.setAttribute("tabindex", editor.disabled || !visible ? "-1" : "0");
      hit.setAttribute("aria-label", `${edge} trigger zone: ${zones[edge]} pixels`);
      hit.setAttribute("aria-pressed", String(edge === selected));
      hit.setAttribute("aria-disabled", String(editor.disabled));
    }
  };
  input.addEventListener("input", () => { zones[selected] = input.valueAsNumber; render(); });
  render();
  return {
    get zones(): HugescreenZones { return { ...zones }; },
    setZones(value: HugescreenZones) { zones = normalizeHugescreenZones(value); render(); },
    setDisabled(disabled: boolean) { editor.disabled = disabled; render(); },
    update(screen: typeof area, enabled: boolean) { area = screen; visible = enabled; render(); }
  };
}
