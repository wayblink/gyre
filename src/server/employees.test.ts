import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assembleShareworksName,
  normalizeEmployeeSourceFilter,
  normalizeExternalNumber,
  upsertEmployeeByEmployeeId,
  type EmployeeStore,
} from './employees.js';

test('normalizeExternalNumber trims, folds width, collapses spaces and uppercases', () => {
  assert.equal(normalizeExternalNumber('  k00385 '), 'K00385');
  assert.equal(normalizeExternalNumber('ｋ００３８５'), 'K00385');
  assert.equal(normalizeExternalNumber('10 015'), '10 015');
  assert.equal(normalizeExternalNumber(''), '');
});

test('assembleShareworksName joins first middle last and skips empty segments', () => {
  assert.equal(assembleShareworksName('Han', 'Lin', null), 'Lin Han');
  assert.equal(assembleShareworksName('Smith', 'John', 'A'), 'John A Smith');
  assert.equal(assembleShareworksName('  Han ', '', '  '), 'Han');
  assert.equal(assembleShareworksName(null, null, null), '');
});

test('normalizeEmployeeSourceFilter accepts known employee sources only', () => {
  assert.equal(normalizeEmployeeSourceFilter('shareworks'), 'shareworks');
  assert.equal(normalizeEmployeeSourceFilter(' Futu '), 'futu');
  assert.equal(normalizeEmployeeSourceFilter('manual'), 'manual');
  assert.equal(normalizeEmployeeSourceFilter('unknown'), '');
  assert.equal(normalizeEmployeeSourceFilter(undefined), '');
});

type FakeRow = { id: number; employeeId: string; source: string; name: string; hasFileEvidence: boolean };

function createFakeStore() {
  const rows: FakeRow[] = [];
  let nextId = 1;
  const store: EmployeeStore = {
    async upsertByEmployeeId(input) {
      const existing = rows.find((r) => r.employeeId === input.employeeId);
      if (existing) {
        existing.name = input.name;
        existing.hasFileEvidence = existing.hasFileEvidence || input.hasFileEvidence;
        return existing.id;
      }
      const id = nextId++;
      rows.push({ id, employeeId: input.employeeId, source: input.source, name: input.name, hasFileEvidence: input.hasFileEvidence });
      return id;
    },
  };
  return { store, rows };
}

test('upsertEmployeeByEmployeeId creates a row keyed on the normalized employee number', async () => {
  const { store, rows } = createFakeStore();
  const id = await upsertEmployeeByEmployeeId(store, { employeeId: 'k00385', source: 'futu', name: '高媛' });
  assert.equal(id, 1);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].employeeId, 'K00385');
  assert.equal(rows[0].hasFileEvidence, true);
});

test('re-importing the same employee number is idempotent (no duplicate row)', async () => {
  const { store, rows } = createFakeStore();
  const first = await upsertEmployeeByEmployeeId(store, { employeeId: 'K00385', source: 'futu', name: '高媛' });
  const again = await upsertEmployeeByEmployeeId(store, { employeeId: ' k00385 ', source: 'futu', name: '高媛' });
  assert.equal(first, again);
  assert.equal(rows.length, 1);
});

test('Futu and Shareworks numbers create independent rows (linked later by merge)', async () => {
  const { store, rows } = createFakeStore();
  const f = await upsertEmployeeByEmployeeId(store, { employeeId: 'K01447', source: 'futu', name: '韩林' });
  const s = await upsertEmployeeByEmployeeId(store, { employeeId: '100010', source: 'shareworks', name: 'Han Lin' });
  assert.notEqual(f, s);
  assert.equal(rows.length, 2);
});

test('a manual employee later seen in a file upgrades evidence, keeps the same row', async () => {
  const { store, rows } = createFakeStore();
  const manualId = await upsertEmployeeByEmployeeId(store, { employeeId: 'K7', source: 'manual', name: '李四', hasFileEvidence: false });
  assert.equal(rows[0].hasFileEvidence, false);
  const seen = await upsertEmployeeByEmployeeId(store, { employeeId: 'K7', source: 'futu', name: '李四' });
  assert.equal(seen, manualId);
  assert.equal(rows[0].hasFileEvidence, true);
  assert.equal(rows.length, 1);
});

test('upsertEmployeeByEmployeeId returns null when the employee number is blank', async () => {
  const { store, rows } = createFakeStore();
  const id = await upsertEmployeeByEmployeeId(store, { employeeId: '   ', source: 'futu', name: '无号' });
  assert.equal(id, null);
  assert.equal(rows.length, 0);
});
