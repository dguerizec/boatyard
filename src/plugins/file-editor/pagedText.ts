export type TextPoint = { block: number; offset: number };
export type TextMatch = { from: TextPoint; to: TextPoint };
export type PagedTextSource = {
  count: number;
  lines?: readonly { line: number; continuation: boolean }[];
  read(block: number): Promise<string>;
  valid(): boolean;
};
export function editorLineSeparator(text: string) {
  return text.includes("\r\n") ? "\r\n" : !text.includes("\n") && text.includes("\r") ? "\r" : "\n";
}
export function editorText(text: string, block: number) {
  if (block === 0 && text.startsWith("\uFEFF")) text = text.slice(1);
  return text.split(editorLineSeparator(text)).join("\n");
}
export function comparePoints(a: TextPoint, b: TextPoint) { return a.block - b.block || a.offset - b.offset; }
function check(source: PagedTextSource) { if (!source.valid()) throw new Error("The document changed. Try the operation again."); }

/** Literal search with a rolling overlap, including matches spanning any number of blocks. */
export async function findInFile(source: PagedTextSource, query: string, origin: TextPoint, backward = false, matchCase = false): Promise<TextMatch | undefined> {
  if (!query) return;
  const expression = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), matchCase ? "gu" : "giu");
  const spans: { start: number; length: number }[] = [];
  let tail = "", total = 0, iterations = 0;
  let first: TextMatch | undefined, last: TextMatch | undefined, previous: TextMatch | undefined;
  const point = (position: number, end: boolean): TextPoint => {
    let low = 0, high = spans.length - 1;
    while (low < high) {
      const middle = Math.ceil((low + high) / 2);
      if (spans[middle].start < position || (!end && spans[middle].start === position)) low = middle;
      else high = middle - 1;
    }
    return { block: low, offset: position - spans[low].start };
  };
  for (let block = 0; block < source.count; block++) {
    check(source);
    const text = await source.read(block);
    check(source);
    spans.push({ start: total, length: text.length });
    const joined = tail + text, start = total - tail.length;
    expression.lastIndex = 0;
    for (let match = expression.exec(joined); match; match = expression.exec(joined)) {
      if (++iterations % 10000 === 0) { await new Promise(resolve => setTimeout(resolve, 0)); check(source); }
      const from = start + match.index, to = from + match[0].length;
      if (to <= total) continue;
      const result = { from: point(from, false), to: point(to, true) };
      first ??= result; last = result;
      const comparison = comparePoints(result.from, origin);
      if (!backward && comparison >= 0) return result;
      if (backward && comparison < 0) previous = result;
      // Allow overlapping occurrences without splitting a surrogate pair.
      expression.lastIndex = match.index + (joined.codePointAt(match.index)! > 0xffff ? 2 : 1);
    }
    total += text.length;
    tail = query.length > 1 ? joined.slice(-(query.length - 1)) : "";
  }
  return backward ? previous ?? last : first;
}

/** Count logical lines across fragments; edits and CRLF normalization use the same stream as Find. */
export async function lineInFile(source: PagedTextSource, line: number): Promise<TextPoint> {
  let remaining = Math.max(1, Math.floor(line));
  let last: TextPoint = { block: 0, offset: 0 };
  let first = 0;
  if (source.lines) {
    while (first + 1 < source.count && (source.lines[first + 1].line < remaining ||
      (source.lines[first + 1].line === remaining && !source.lines[first + 1].continuation))) first++;
    remaining -= source.lines[first].line - 1;
  }
  for (let block = first; block < source.count; block++) {
    check(source);
    const text = await source.read(block);
    check(source);
    let offset = 0;
    if (remaining === 1) {
      if (!text.length && block + 1 < source.count) continue;
      return { block, offset };
    }
    while ((offset = text.indexOf("\n", offset)) !== -1) {
      offset++;
      if (--remaining === 1) {
        if (offset === text.length && block + 1 < source.count) break;
        return { block, offset };
      }
    }
    last = { block, offset: text.length };
  }
  return last;
}
