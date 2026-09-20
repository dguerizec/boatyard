import type { PluginContext } from "../../shared/pluginTypes";
import { listProjectDirectory, readProjectImage, readProjectEditableFile, saveProjectBytes } from "./service";

type EditorState = { projects?: { id: string; sourcePath?: string }[] };
type FileInput = { projectId?: string; path?: string; text?: string; revision?: string; offset?: number; encoding?: "hex" };

export function activate(ctx: PluginContext<EditorState>) {
  function rootFor(projectId?: string): string {
    const project = ctx.getState().projects?.find((entry) => entry.id === projectId);
    if (!project?.sourcePath) throw new Error("This project has no local directory.");
    return project.sourcePath;
  }
  ctx.actions.handle<FileInput>("readImage", (input = {}) => readProjectImage(rootFor(input.projectId), input.path || ""));
  ctx.actions.handle<FileInput>("read", (input = {}) => readProjectEditableFile(rootFor(input.projectId), input.path || ""));
  ctx.actions.handle<FileInput>("save", (input = {}) => saveProjectBytes(
    rootFor(input.projectId), input.path || "", input.text!, input.revision || "", input.encoding
  ));
  ctx.actions.handle<FileInput>("list", (input = {}) => listProjectDirectory(
    rootFor(input.projectId), input.path || "", input.offset ?? 0
  ));
}
