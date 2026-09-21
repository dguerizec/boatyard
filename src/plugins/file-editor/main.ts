import { listEditorRoots, resolveEditorRoot } from "./roots";
import { editorGitBaseline, editorGitStatus } from "./git";
import type { FilePatch } from "./changes";
import { join } from "node:path";
import { ProjectFileIndex } from "./blockIndex";
import type { PluginContext } from "../../shared/pluginTypes";
import { listProjectDirectory, readProjectImage, saveProjectBytes } from "./service";

type EditorState = { projects?: { id: string; sourcePath?: string }[] };
type FileInput = { projectId?: string; root?: string; path?: string; text?: string; revision?: string; offset?: number; encoding?: "hex"; block?: number; patches?: FilePatch[]; size?: number };

export function activate(ctx: PluginContext<EditorState>) {
  const fileIndex = new ProjectFileIndex(join(ctx.paths.pluginData, "file-index"));
  function rootFor(projectId?: string): string {
    const project = ctx.getState().projects?.find((entry) => entry.id === projectId);
    if (!project?.sourcePath) throw new Error("This project has no local directory.");
    return project.sourcePath;
  }
  ctx.actions.handle<FileInput>("roots", (input = {}) => listEditorRoots(rootFor(input.projectId), ctx.execFileAsync));
  ctx.actions.handle<FileInput>("resolveRoot", (input = {}) => resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync));
  ctx.actions.handle<FileInput>("gitStatus", async (input = {}) => editorGitStatus(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync)));
  ctx.actions.handle<FileInput>("gitBaseline", async (input = {}) => editorGitBaseline(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || ""));
  ctx.actions.handle<FileInput>("readImage", async (input = {}) => readProjectImage(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || ""));
  ctx.actions.handle<FileInput>("read", async (input = {}) => fileIndex.read(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.block ?? 0, input.block !== undefined));
  ctx.actions.handle<FileInput>("save", async (input = {}) => input.block === undefined
    ? saveProjectBytes(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.text!, input.revision || "", input.encoding)
    : fileIndex.save(await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.block, input.revision || "", input.text!, input.encoding));
  ctx.actions.handle<FileInput>("rebaseChanges", async (input = {}) => fileIndex.rebaseChanges(
    await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.revision || "", input.patches!, input.size!
  ));
  ctx.actions.handle<FileInput>("saveChanges", async (input = {}) => fileIndex.saveChanges(
    await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.revision || "", input.patches!, input.block ?? 0
  ));
  ctx.actions.handle<FileInput>("list", async (input = {}) => listProjectDirectory(
    await resolveEditorRoot(rootFor(input.projectId), input.root, ctx.execFileAsync), input.path || "", input.offset ?? 0
  ));
}
