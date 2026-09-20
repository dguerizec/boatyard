import type { FilePatch } from "./changes";
import { join } from "node:path";
import { ProjectFileIndex } from "./blockIndex";
import type { PluginContext } from "../../shared/pluginTypes";
import { listProjectDirectory, readProjectImage, saveProjectBytes } from "./service";

type EditorState = { projects?: { id: string; sourcePath?: string }[] };
type FileInput = { projectId?: string; path?: string; text?: string; revision?: string; offset?: number; encoding?: "hex"; block?: number; patches?: FilePatch[]; size?: number };

export function activate(ctx: PluginContext<EditorState>) {
  const fileIndex = new ProjectFileIndex(join(ctx.paths.pluginData, "file-index"));
  function rootFor(projectId?: string): string {
    const project = ctx.getState().projects?.find((entry) => entry.id === projectId);
    if (!project?.sourcePath) throw new Error("This project has no local directory.");
    return project.sourcePath;
  }
  ctx.actions.handle<FileInput>("readImage", (input = {}) => readProjectImage(rootFor(input.projectId), input.path || ""));
  ctx.actions.handle<FileInput>("read", (input = {}) => fileIndex.read(rootFor(input.projectId), input.path || "", input.block ?? 0, input.block !== undefined));
  ctx.actions.handle<FileInput>("save", (input = {}) => input.block === undefined
    ? saveProjectBytes(rootFor(input.projectId), input.path || "", input.text!, input.revision || "", input.encoding)
    : fileIndex.save(rootFor(input.projectId), input.path || "", input.block, input.revision || "", input.text!, input.encoding));
  ctx.actions.handle<FileInput>("rebaseChanges", (input = {}) => fileIndex.rebaseChanges(
    rootFor(input.projectId), input.path || "", input.revision || "", input.patches!, input.size!
  ));
  ctx.actions.handle<FileInput>("saveChanges", (input = {}) => fileIndex.saveChanges(
    rootFor(input.projectId), input.path || "", input.revision || "", input.patches!, input.block ?? 0
  ));
  ctx.actions.handle<FileInput>("list", (input = {}) => listProjectDirectory(
    rootFor(input.projectId), input.path || "", input.offset ?? 0
  ));
}
