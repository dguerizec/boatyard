import { ViewPlugin } from "@codemirror/view";
import { CodeMirror, getCM, Vim, vim } from "@replit/codemirror-vim";

type Actions = {
  save: () => void;
  history?: (forward: boolean) => void;
  error: (message: string) => void;
};
const actions = new WeakMap<object, Actions>();

// Vim commands are global, but their effects must belong to the invoking pane.
Vim.defineEx("write", "w", (cm, params) => {
  const owner = actions.get(cm);
  if (!owner) return;
  if (params.argString?.trim() || params.lineEnd !== undefined) {
    owner.error("Vim :write saves the current file only. Ranges, file arguments, and ! are not supported.");
    return;
  }
  owner.save();
});

for (const [name, forward] of [["undo", false], ["redo", true]] as const) {
  const original = CodeMirror.commands[name];
  const command = (cm: CodeMirror) => {
    const history = actions.get(cm)?.history;
    if (history) history(forward);
    else original(cm);
  };
  CodeMirror.commands[name] = command;
  Vim.defineEx(name, undefined, command);
}

export function editorVim(owner: Actions) {
  return [vim({ status: true }), ViewPlugin.define((view) => {
    const cm = getCM(view);
    if (cm) actions.set(cm, owner);
    return { destroy() { if (cm) actions.delete(cm); } };
  })];
}
