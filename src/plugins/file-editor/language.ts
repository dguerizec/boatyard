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

export function language(path: string) {
  const filename = path.split(/[\\/]/).pop()?.toLowerCase() || "";
  const extension = filename.includes(".") ? filename.split(".").pop() : "";
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
