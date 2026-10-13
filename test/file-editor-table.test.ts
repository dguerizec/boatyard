import { test } from "node:test";
import assert from "node:assert/strict";
import { detectTableDelimiter, moveTableRow, parseTable, serializeTable, sortTable, tableWidth } from "../src/plugins/file-editor/tableData";
import { runBrowserTest } from "./helpers/browser";

test("delimited tables preserve BOM, CRLF, quoting, multiline fields and ragged rows", () => {
  const source = '\uFEFFname;value;note\r\n"Ada";00123;"a; b\r\nc"\r\nBob;"say ""hi""";\r\nshort\r\n';
  assert.equal(detectTableDelimiter(source, "example.csv"), ";");
  const data = parseTable(source, ";");
  assert.equal(serializeTable(data), source);
  assert.equal(data.rows[1][1].value, "00123");
  assert.equal(data.rows[1][2].value, "a; b\r\nc");
  assert.equal(data.rows[2][1].value, 'say "hi"');
  assert.equal(tableWidth(data), 3);
  data.rows[1][2] = { value: 'new; "value"' };
  assert.equal(parseTable(serializeTable(data), ";").rows[1][2].value, 'new; "value"');
});

test("table delimiter detection ignores quoted separators and recognizes similar formats", () => {
  assert.equal(detectTableDelimiter('a\tb\n"one,two"\tthree\n', "example.tsv"), "\t");
  assert.equal(detectTableDelimiter('a|b\n1|2\n', "example.psv"), "|");
  for (const source of ["", "\n", "a,", "a,b", "a,b\n\n", '"",b\n', 'a,b\r\nc,d\ne,f\r']) assert.equal(serializeTable(parseTable(source, ",")), source);
  const empty = parseTable("", ",");
  empty.rows.push([{ value: "" }]);
  assert.equal(parseTable(serializeTable(empty), ",").rows.length, 1);
});

test("table sorting is stable, retains raw strings and protects the header", () => {
  const data = parseTable('name,value\nB,010\nA,2\nC,2\n', ",");
  sortTable(data, 1, false, true, true);
  assert.equal(serializeTable(data), 'name,value\nA,2\nC,2\nB,010\n');
  sortTable(data, 0, true, false, true);
  assert.equal(serializeTable(data), 'name,value\nC,2\nB,010\nA,2\n');
  assert.equal(moveTableRow(data, 0, 2, true), false);
  assert.equal(moveTableRow(data, 3, 1, true), true);
  assert.equal(serializeTable(data), 'name,value\nA,2\nC,2\nB,010\n');
});

test("malformed CSV and invalid numeric sorts fail without discarding data", () => {
  assert.throws(() => parseTable('a,"unclosed', ","), /Unclosed/);
  assert.throws(() => parseTable('a,"closed"junk', ","), /Unexpected/);
  assert.throws(() => parseTable('a,b"c', ","), /Unexpected/);
  const data = parseTable('name,value\nA,no\nB,2\n', ",");
  const source = serializeTable(data);
  assert.throws(() => sortTable(data, 1, false, true, true), /finite number/);
  assert.equal(serializeTable(data), source);
});

test("table editing, sorting, row movement, undo, mode switching and recovery work in Electron", t => {
  runBrowserTest(t, "test/fixtures/file-editor-table.browser.js", {
    main: "test/fixtures/file-editor-table-input.main.cjs", preload: "test/fixtures/file-editor-table-input.preload.cjs"
  });
});
