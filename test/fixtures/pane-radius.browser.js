import "../../src/renderer/styles.css";
import { createWebAppSurfaces } from "../../src/renderer/webAppSurfaces.ts";

const check = (condition, message) => { if (!condition) throw new Error(message); };
const pane = document.createElement("section");
pane.className = "webapp-pane";
pane.style.cssText = "width:600px;height:400px;position:absolute;left:20px;top:20px";
pane.innerHTML = `<header class="webapp-pane-header"><button class="webapp-tool-button">Tool</button></header><div class="webapp-host"><div class="webapp-view-host" style="width:100%;height:100%"></div></div>`;
document.body.append(pane);
const host = pane.querySelector(".webapp-view-host");
const calls = [];
const surfaces = createWebAppSurfaces({
  boatyard: { async freezeWebApps() { return { token: 1, captures: [{ bounds: { x: 22, y: 60, width: 598, height: 358 }, borderRadius: 10, dataUrl: "data:image/png;base64," }] }; }, async restoreWebApps() {} },
  getFreezeLayerHost: () => document.body,
  getSettings: () => ({}),
  getVisibleWebAppEntries: () => [{ host, webApp: { key: "example", url: "https://example.test" } }],
  async invokeWebApp(action, payload) { if (action === "showWebApp") calls.push(payload); },
  isWebAppAutofillEnabled: () => false,
  markWebAppLoaded() {}
});
const geometry = () => [pane, ...pane.querySelectorAll(".webapp-pane-header,button,.webapp-host")].map(node => {
  const rect = node.getBoundingClientRect();
  return [rect.x, rect.y, rect.width, rect.height];
});
(async () => {
  const initial = JSON.stringify(geometry());
  for (const theme of ["dark", "light"]) {
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.removeProperty("--pane-radius");
    check(getComputedStyle(pane).borderRadius === "12px", "Default frame radius");
    check(getComputedStyle(pane).borderTopColor === "rgba(0, 0, 0, 0)", "Idle pane border remains visible");
    check(getComputedStyle(pane.querySelector("header")).borderBottomColor === "rgba(0, 0, 0, 0)", "Idle topbar divider remains visible");
    pane.classList.add("pane-expand-preview");
    check(getComputedStyle(pane).borderTopColor !== "rgba(0, 0, 0, 0)", "Expansion preview border disappeared");
    check(getComputedStyle(pane).outlineWidth === "3px", "Expansion preview outline disappeared");
    check(JSON.stringify(geometry()) === initial, "Expansion highlighting changed layout");
    pane.classList.remove("pane-expand-preview");
    for (const radius of [12, 18, 0]) {
      document.documentElement.style.setProperty("--pane-radius", `${radius}px`);
      await surfaces.syncWebAppView();
      check(getComputedStyle(pane).borderRadius === `${radius}px`, "Global frame token");
      check(calls.at(-1).borderRadius === Math.max(0, radius - 2), "Native radius follows frame token");
      check(JSON.stringify(geometry()) === initial, "Rounding moved pane controls or content");
      check(pane.querySelector("header").offsetHeight === 37, "Compact topbar height changed");
    }
  }
  const freeze = surfaces.createFreezeScope();
  await freeze.freeze();
  const layer = document.querySelector(".webapp-freeze-layer");
  check(layer.querySelector("img").style.borderRadius === "10px", "Frozen native content lost its corners");
  await freeze.restore();
  check(!document.querySelector(".webapp-freeze-layer"), "Frozen frame survived restore");
  window.browserTestResult = "passed";
})().catch(error => { console.error(error); });
