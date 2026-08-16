import assert from "node:assert/strict";
import test from "node:test";
import { buildPaneTypeCatalog } from "../src/renderer/paneTypeCatalog.js";
import type { WebAppDefinition } from "../src/renderer/rendererTypes.js";

test("pane type catalog preserves every dropdown entry and subtype", () => {
  const catalog = buildPaneTypeCatalog<WebAppDefinition>([
    { id: "pier", label: "Pier", paneTypeId: "pier" },
    { id: "pier:feature", label: "Feature", parentWebAppId: "pier", paneTypeId: "pier" },
    { id: "pier:review", label: "Pier: Review", paneTypeId: "pier" },
    { id: "url:docs", label: "URL: Documentation", paneTypeId: "url" },
    { id: "hidden", label: "Hidden", showInMenu: false },
    { id: "orphan", label: "Orphan", parentWebAppId: "missing", paneTypeId: "custom" }
  ]);

  assert.deepEqual(catalog.map((group) => ({
    id: group.webApp.id,
    label: group.label,
    children: group.children.map((child) => ({ id: child.webApp.id, label: child.label }))
  })), [
    {
      id: "pier",
      label: "Pier",
      children: [
        { id: "pier:feature", label: "Feature" },
        { id: "pier:review", label: "Review" }
      ]
    },
    {
      id: "menu:url",
      label: "URL",
      children: [{ id: "url:docs", label: "Documentation" }]
    },
    {
      id: "orphan",
      label: "Orphan",
      children: []
    }
  ]);
});
