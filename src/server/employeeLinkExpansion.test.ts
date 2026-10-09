import assert from 'node:assert/strict';
import test from 'node:test';
import { expandByLinkedGroup } from './employeeLinkExpansion.js';

type Row = { employeeNumber: string; label: string };

const rows: Row[] = [
  { employeeNumber: 'FUTU-1', label: 'a' },
  { employeeNumber: 'SW-1', label: 'b' },
  { employeeNumber: 'FUTU-2', label: 'c' },
];
// FUTU-1 与 SW-1 关联为同一人（canonical id 10）；FUTU-2 独立（canonical id 20）。
const canonical = new Map<string, number>([
  ['FUTU-1', 10],
  ['SW-1', 10],
  ['FUTU-2', 20],
]);

test('empty query returns matched rows unchanged, no group expansion', () => {
  const result = expandByLinkedGroup(rows, '', canonical, () => true);
  assert.deepEqual(
    result.map((r) => r.employeeNumber),
    ['FUTU-1', 'SW-1', 'FUTU-2'],
  );
});

test('matching one linked 工号 brings out every record in the same canonical group', () => {
  // 搜 FUTU-1 命中 → 带出同组 SW-1，但不含独立的 FUTU-2。
  const result = expandByLinkedGroup(rows, 'futu-1', canonical, (r) => r.employeeNumber === 'FUTU-1');
  assert.deepEqual(result.map((r) => r.employeeNumber).sort(), ['FUTU-1', 'SW-1']);
});

test('matching the other 工号 of the group expands symmetrically', () => {
  const result = expandByLinkedGroup(rows, 'sw-1', canonical, (r) => r.employeeNumber === 'SW-1');
  assert.deepEqual(result.map((r) => r.employeeNumber).sort(), ['FUTU-1', 'SW-1']);
});

test('a 工号 absent from employees falls back to itself (no accidental grouping)', () => {
  const result = expandByLinkedGroup(rows, 'futu-2', new Map(), (r) => r.employeeNumber === 'FUTU-2');
  assert.deepEqual(
    result.map((r) => r.employeeNumber),
    ['FUTU-2'],
  );
});
