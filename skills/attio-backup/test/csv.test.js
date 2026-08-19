import { test } from "node:test";
import assert from "node:assert/strict";
import { toCsv, escapeCell } from "../src/csv.js";

test("toCsv builds a header from the union of all row keys", () => {
  const csv = toCsv([{ a: 1, b: 2 }, { a: 3, c: 4 }]);
  assert.equal(csv, "a,b,c\n1,2,\n3,,4\n");
});

test("toCsv returns an empty string for no rows", () => {
  assert.equal(toCsv([]), "");
  assert.equal(toCsv(null), "");
});

test("escapeCell quotes commas, quotes and newlines", () => {
  assert.equal(escapeCell("a,b"), '"a,b"');
  assert.equal(escapeCell('say "hi"'), '"say ""hi"""');
  assert.equal(escapeCell("line1\nline2"), '"line1\nline2"');
  assert.equal(escapeCell("plain"), "plain");
});

test("escapeCell neutralises spreadsheet formula injection", () => {
  // CRM text fields are attacker-controllable in practice.
  assert.equal(escapeCell("=cmd|'/c calc'!A1"), "'=cmd|'/c calc'!A1");
  assert.equal(escapeCell("+1234"), "'+1234");
  assert.equal(escapeCell("@import"), "'@import");
  assert.equal(escapeCell("-5"), "'-5");
});

test("escapeCell renders null and undefined as empty", () => {
  assert.equal(escapeCell(null), "");
  assert.equal(escapeCell(undefined), "");
});
