import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { css } from "@codemirror/lang-css";
import { html } from "@codemirror/lang-html";
import { markdown } from "@codemirror/lang-markdown";
import { python } from "@codemirror/lang-python";
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";

// Legacy modes expose ESM-only types; NodeNext otherwise treats the identical
// StringStream class in our CommonJS test build as a different private type.
const tomlLanguage = StreamLanguage.define(toml as unknown as StreamParser<unknown>);
const dockerLanguage = StreamLanguage.define(dockerFile as unknown as StreamParser<unknown>);

function lineLanguage(jsonLines: boolean, continuation: boolean) {
  return StreamLanguage.define({
    startState: () => ({ first: true }),
    blankLine(state) { state.first = false; },
    token(stream, state) {
      if (state.first) {
        state.first = false;
        if (continuation) { stream.skipToEnd(); return null; }
      }
      if (stream.eatSpace()) return null;
      if (jsonLines) {
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return /^\s*:/.test(stream.string.slice(stream.pos)) ? "propertyName" : "string";
        if (stream.match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)) return "number";
        if (stream.match(/^(?:true|false|null)\b/)) return "atom";
        if (stream.match(/^[{}\[\],:]/)) return "punctuation";
      } else {
        if (stream.match(/^(?:ERROR|FATAL|CRITICAL)\b/i)) return "invalid";
        if (stream.match(/^(?:WARN(?:ING)?|INFO|DEBUG|TRACE)\b/i)) return "keyword";
        if (stream.match(/^\d{4}-\d\d-\d\d(?:[T ][\d:.+-]+Z?)?/)) return "number";
        if (stream.match(/^"(?:[^"\\]|\\.)*"/)) return "string";
        if (stream.match(/^\d+(?:\.\d+)?/)) return "number";
      }
      stream.next(); return null;
    }
  });
}

export function language(path: string, paged?: { continuation: boolean }) {
  const filename = path.split(/[\\/]/).pop()?.toLowerCase() || "";
  const extension = filename.includes(".") ? filename.split(".").pop() : "";
  if (extension === "jsonl" || extension === "ndjson") return lineLanguage(true, paged?.continuation ?? false);
  if (extension === "log") return lineLanguage(false, paged?.continuation ?? false);
  if (paged) return [];
  if (/^(?:dockerfile|containerfile)(?:\..+)?$/.test(filename) || extension === "dockerfile" || extension === "containerfile") return dockerLanguage;
  if (extension === "toml") return tomlLanguage;
  if (["js", "jsx", "mjs", "cjs", "ts", "tsx"].includes(extension || "")) {
    return javascript({ jsx: extension === "jsx" || extension === "tsx", typescript: extension === "ts" || extension === "tsx" });
  }
  if (extension === "json") return json();
  if (extension === "css") return css();
  if (extension === "html" || extension === "htm") return html();
  if (extension === "md" || extension === "markdown") return markdown();
  if (extension === "py") return python();
  return [];
}
