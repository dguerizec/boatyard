import { dialog } from "electron";
import type { PluginContext } from "../../shared/pluginTypes";
import { readProjectFile, saveProjectFile } from "./service";

type EditorState = { projects?: { id: string; sourcePath?: string }[] };
type FileInput = { projectId?: string; path?: string; text?: string; revision?: string };

export function activate(ctx: PluginContext<EditorState>) {
  function rootFor(projectId?: string): string {
    const project = ctx.getState().projects?.find((entry) => entry.id === projectId);
    if (!project?.sourcePath) throw new Error("This project has no local directory.");
    return project.sourcePath;
  }
  ctx.actions.handle<FileInput>("read", (input = {}) => readProjectFile(rootFor(input.projectId), input.path || ""));
  ctx.actions.handle<FileInput>("save", (input = {}) => saveProjectFile(
    rootFor(input.projectId), input.path || "", input.text!, input.revision || ""
  ));
  ctx.actions.handle<FileInput>("choose", async (input = {}) => {
    const root = rootFor(input.projectId);
    const result = await dialog.showOpenDialog({ title: "Open project file", defaultPath: root, properties: ["openFile"] });
    return result.canceled ? null : readProjectFile(rootFor(input.projectId), result.filePaths[0]);
  });
}
