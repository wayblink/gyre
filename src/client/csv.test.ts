import assert from 'node:assert/strict';
import test from 'node:test';
import { csvRow, escapeCsvCell } from './csv.js';

test('escapeCsvCell follows CSV quoting rules for quotes commas and newlines', () => {
  assert.equal(escapeCsvCell('plain'), 'plain');
  assert.equal(escapeCsvCell('a,b'), '"a,b"');
  assert.equal(escapeCsvCell('say "hello"'), '"say ""hello"""');
  assert.equal(escapeCsvCell('line 1\nline 2'), '"line 1\nline 2"');
  assert.equal(csvRow(['a,b', 'say "hello"', 42, null]), '"a,b","say ""hello""",42,');
});
test('escapeCsvCell neutralizes spreadsheet formulas including leading whitespace', () => {
  for (const value of ['=1+1', '+cmd', '-2+3', '@SUM(A1:A2)', '  =HYPERLINK("https://example.test")']) {
    const escaped = escapeCsvCell(value);
    const unquoted = escaped.startsWith('"') ? escaped.slice(1, -1).replace(/""/g, '"') : escaped;
    assert.ok(unquoted.startsWith("'"), `${value} must be exported as text`);
  }
});
