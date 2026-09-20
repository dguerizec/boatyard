import { parseEnv } from "node:util";

export const CODEX_MCP_TOKEN_VARIABLE = "BOATYARD_MCP_TOKEN";

export function readCodexMcpToken(source: string): string | undefined {
  return parseEnv(source)[CODEX_MCP_TOKEN_VARIABLE];
}

export function updateCodexMcpEnv(source: string, token?: string): string {
  // Match complete assignments, including multiline quoted values, so text inside
  // another variable is never mistaken for the Boatyard token assignment.
  const assignment = /^[\t ]*(?:export[\t ]+)?([\w.-]+)[\t ]*=[\t ]*(?:"(?:\\[\s\S]|[^"\\])*"|'[^']*'|`[^`]*`|[^\r\n]*)(?:[^\r\n]*)/gm;
  const edits: { start: number; end: number }[] = [];
  for (const match of source.matchAll(assignment)) {
    if (match[1] === CODEX_MCP_TOKEN_VARIABLE) {
      let end = match.index + match[0].length;
      if (source[end] === "\r") end++;
      if (source[end] === "\n") end++;
      edits.push({ start: match.index, end });
    }
  }
  let next = source;
  for (const edit of edits.reverse()) next = next.slice(0, edit.start) + next.slice(edit.end);
  if (token !== undefined) {
    // Managed tokens are URL-safe random values; reject values requiring dotenv escaping.
    if (!/^[A-Za-z0-9_-]+$/.test(token)) throw new Error("Invalid Boatyard MCP token format.");
    const newline = source.includes("\r\n") ? "\r\n" : "\n";
    next += `${next && !next.endsWith("\n") ? newline : ""}${CODEX_MCP_TOKEN_VARIABLE}=${token}${newline}`;
  }
  const parsed = readCodexMcpToken(next);
  if (parsed !== token) throw new Error("Could not safely update the Boatyard token in Codex .env.");
  return next;
}
