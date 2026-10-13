import type { RendererState } from "./rendererTypes";

export type ProjectCatalog = {
  projects: RendererState["projects"];
  projectPluginConfig: NonNullable<RendererState["pluginConfig"]>["projects"];
  projectHugescreen: unknown;
};

/** Catalog updates must not replace window navigation, pane state, or settings drafts. */
function mergeCatalog(state: RendererState, catalog: ProjectCatalog): RendererState {
  return {
    ...state, projects: catalog.projects, projectHugescreen: catalog.projectHugescreen,
    pluginConfig: { ...state.pluginConfig, projects: catalog.projectPluginConfig }
  };
}

export function createProjectCatalogSync(options: {
  subscribe?: (callback: (catalog: ProjectCatalog) => void) => (() => void) | void;
  readState(): Promise<RendererState>;
  getState(): RendererState;
  setState(state: RendererState): void;
  renderProjectList(): void;
}) {
  let revision = 0, latest: ProjectCatalog | undefined;
  const unsubscribe = options.subscribe?.(catalog => {
    latest = catalog; revision++;
    options.setState(mergeCatalog(options.getState(), catalog));
    options.renderProjectList();
  });
  return {
    async readState() {
      const started = revision;
      const state = await options.readState();
      // A catalog event can arrive while the initial IPC snapshot is in flight.
      return revision !== started && latest ? mergeCatalog(state, latest) : state;
    },
    cleanup() { unsubscribe?.(); }
  };
}
