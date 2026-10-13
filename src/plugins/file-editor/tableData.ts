export const tableDelimiters = [",", ";", "\t", "|"] as const;
export type TableDelimiter = typeof tableDelimiters[number];
export type TableCell = { value: string; raw?: string };
export type TableRow = TableCell[] & { ending?: string };
export type TableData = { rows: TableRow[]; delimiter: TableDelimiter; bom: string; newline: string; trailingNewline: boolean };
export const MAX_TABLE_CELLS = 200_000;

export function supportsTable(path: string) { return /\.(csv|tsv|tab|psv|ssv|dsv)$/i.test(path); }

/** Parse quoted fields strictly; malformed input stays available in the text editor. */
export function parseTable(text: string, delimiter: TableDelimiter): TableData {
  const bom = text.startsWith("\uFEFF") ? "\uFEFF" : "";
  const source = text.slice(bom.length);
  const rows: TableRow[] = [];
  let row: TableRow = [], offset = 0, cells = 0, newline = "", trailingNewline = false;
  while (offset < source.length) {
    const start = offset;
    let value = "";
    if (source[offset] === '"') {
      offset++;
      let closed = false;
      while (offset < source.length) {
        if (source[offset] !== '"') { value += source[offset++]; continue; }
        if (source[offset + 1] === '"') { value += '"'; offset += 2; continue; }
        offset++; closed = true; break;
      }
      if (!closed) throw new Error(`Unclosed quoted field in row ${rows.length + 1}. Use Text mode to correct it.`);
      if (offset < source.length && ![delimiter, "\r", "\n"].includes(source[offset])) throw new Error(`Unexpected text after a quoted field in row ${rows.length + 1}.`);
    } else {
      while (offset < source.length && ![delimiter, "\r", "\n"].includes(source[offset])) {
        if (source[offset] === '"') throw new Error(`Unexpected quote in row ${rows.length + 1}. Use Text mode to correct it.`);
        value += source[offset++];
      }
    }
    row.push({ value, raw: source.slice(start, offset) });
    if (++cells > MAX_TABLE_CELLS || row.length > 256) throw new Error("Table mode supports up to 200,000 cells and 256 columns. Use Text mode for this file.");
    trailingNewline = false;
    if (source[offset] === delimiter) {
      offset++;
      if (offset === source.length) {
        row.push({ value: "", raw: "" });
        if (++cells > MAX_TABLE_CELLS || row.length > 256) throw new Error("Table mode supports up to 200,000 cells and 256 columns. Use Text mode for this file.");
      }
    } else {
      if (source[offset] === "\r" || source[offset] === "\n") {
        const ending = source[offset] === "\r" && source[offset + 1] === "\n" ? "\r\n" : source[offset];
        newline ||= ending;
        row.ending = ending;
        offset += ending.length;
        trailingNewline = offset === source.length;
      }
      rows.push(row); row = [];
    }
  }
  if (row.length) rows.push(row);
  return { rows, delimiter, bom, newline: newline || "\n", trailingNewline };
}

export function detectTableDelimiter(text: string, path = ""): TableDelimiter {
  const preferred: TableDelimiter = /\.(tsv|tab)$/i.test(path) ? "\t" : /\.psv$/i.test(path) ? "|" : /\.ssv$/i.test(path) ? ";" : ",";
  let best = preferred, score = -1;
  for (const delimiter of [preferred, ...tableDelimiters.filter(value => value !== preferred)]) {
    try {
      const rows = parseTable(text, delimiter).rows.slice(0, 100).filter(row => row.some(cell => cell.value));
      const widths = new Map<number, number>();
      for (const row of rows) widths.set(row.length, (widths.get(row.length) || 0) + 1);
      for (const [width, count] of widths) {
        const current = width > 1 ? count / Math.max(1, rows.length) * 1000 + Math.min(width, 100) : 0;
        if (current > score) { score = current; best = delimiter; }
      }
    } catch { /* Try another delimiter; the chosen parser will explain malformed input. */ }
  }
  return best;
}

export function tableWidth(data: TableData) { return data.rows.reduce((width, row) => Math.max(width, row.length), 1); }
export function quoteTableCell(value: string, delimiter: TableDelimiter) {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}
export function serializeTable(data: TableData) {
  return data.bom + data.rows.map((row, index) => {
    const fields = row.map(cell => cell.raw ?? quoteTableCell(cell.value, data.delimiter)).join(data.delimiter);
    const ending = index < data.rows.length - 1 || data.trailingNewline ? row.ending || data.newline : "";
    // Distinguish a final empty record from an absent record.
    return (fields === "" && !ending ? '""' : fields) + ending;
  }).join("");
}

/** Stable sort; numbers affect comparison only, never the stored cell strings. */
export function sortTable(data: TableData, column: number, descending: boolean, numeric: boolean, header: boolean) {
  const first = header && data.rows.length ? [data.rows[0]] : [];
  const rows = data.rows.slice(first.length);
  const number = (value: string) => {
    if (!value.trim() || !Number.isFinite(Number(value))) throw new Error("Number sorting requires a finite number in every selected cell. Use Text sorting for other values.");
    return Number(value);
  };
  if (numeric) for (const row of rows) number(row[column]?.value || "");
  rows.sort((a, b) => {
    const left = a[column]?.value || "", right = b[column]?.value || "";
    const order = numeric ? number(left) - number(right) : left.localeCompare(right);
    return descending ? -order : order;
  });
  data.rows = first.concat(rows);
}

export function moveTableRow(data: TableData, from: number, to: number, header: boolean) {
  const first = header ? 1 : 0;
  if (from < first || to < first || from >= data.rows.length || to >= data.rows.length || from === to) return false;
  data.rows.splice(to, 0, data.rows.splice(from, 1)[0]);
  return true;
}
