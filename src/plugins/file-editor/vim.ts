import { ViewPlugin } from "@codemirror/view";
import { CodeMirror, getCM, Vim, vim } from "@replit/codemirror-vim";

type Actions = {
  save: () => void;
  close?: (mode: "quit" | "save" | "discard") => void;
  history?: (forward: boolean) => void;
  jump?: (line: number, relative: boolean) => void;
  search?: (backward: boolean, repeat: boolean) => void;
  error: (message: string) => void;
};
const actions = new WeakMap<object, Actions>();

// Keep the default motion semantics for complete documents and local operators.
Vim.defineMotion("moveToLineOrEdgeOfDocument", (cm, head, args, vim, input) => {
  const owner = actions.get(cm);
  if (owner?.jump) {
    if (input.operator || vim.visualMode) {
      owner.error("Vim selections and operators remain limited to the loaded text section.");
      return null;
    }
    owner.jump(args.repeatIsExplicit ? args.repeat : args.forward ? Infinity : 1, false);
    return head;
  }
  const line = args.repeatIsExplicit ? args.repeat - Number(cm.getOption("firstLineNumber")) : args.forward ? cm.lastLine() : cm.firstLine();
  return { line, ch: (cm.getLine(line) || "").search(/\S|$/) };
});
Vim.defineMotion("boatyardNextLine", (cm, head, args) => {
  const owner = actions.get(cm);
  if (owner?.jump) { owner.jump(args.repeat, true); return head; }
  const line = Math.min(cm.lastLine(), head.line + args.repeat);
  return { line, ch: (cm.getLine(line) || "").search(/\S|$/) };
});
Vim.mapCommand("<CR>", "motion", "boatyardNextLine", { linewise: true }, { context: "normal" });

// Search is asynchronous for paged files. Leave the library's search untouched elsewhere.
const findKey = Vim.findKey;
Vim.findKey = (cm, key, origin) => {
  const owner = actions.get(cm), state = cm.state.vim;
  if (owner?.search && state && !state.insertMode && !state.visualMode && !state.inputState.operator &&
      !state.inputState.keyBuffer.length && ["/", "?", "n", "N"].includes(key)) {
    return () => {
      state.inputState.prefixRepeat = []; state.inputState.motionRepeat = [];
      owner.search!(key === "?" || key === "N", key === "n" || key === "N");
      return true;
    };
  }
  return findKey(cm, key, origin);
};

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

for (const [name, prefix] of [["quit", "q"], ["wq", "wq"]] as const) {
  Vim.defineEx(name, prefix, (cm, params) => {
    const owner = actions.get(cm);
    if (!owner) return;
    const argument = params.argString?.trim() || "";
    if (params.lineEnd !== undefined || (argument && !(name === "quit" && argument === "!"))) {
      owner.error(`Vim :${name} does not support ranges or arguments${name === "quit" ? " other than !" : ""}.`);
      return;
    }
    owner.close?.(name === "wq" ? "save" : argument === "!" ? "discard" : "quit");
  });
}

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
