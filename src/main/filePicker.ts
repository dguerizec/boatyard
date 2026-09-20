import type { BrowserWindow, OpenDialogOptions, OpenDialogReturnValue } from "electron";

type PickerDialog = {
  showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
  showOpenDialog(parent: BrowserWindow, options: OpenDialogOptions): Promise<OpenDialogReturnValue>;
};

export async function selectEditorFiles(dialog: PickerDialog, parent: BrowserWindow | null | undefined, currentPath: unknown): Promise<string[]> {
  const options: OpenDialogOptions = { title: "Open files", properties: ["openFile", "multiSelections"] };
  if (typeof currentPath === "string" && currentPath && !currentPath.includes("\0")) options.defaultPath = currentPath;
  const result = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
  return result.canceled ? [] : result.filePaths;
}
