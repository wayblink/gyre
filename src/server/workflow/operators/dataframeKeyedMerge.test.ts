import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../../excel.js';
import { mergeKeyedDataFrames } from './dataframeKeyedMerge.js';

const keyColumns = ['entity_id', 'effective_date', 'amount'];
const outputColumns = ['entity_id', 'effective_date', 'amount', 'balance', 'comment'];
const keyNormalization = {
  dateColumns: ['effective_date'],
  numericColumns: ['amount'],
  caseInsensitive: true,
  collapseWhitespace: true,
};

test('keyed merge is idempotent when the same increment is applied repeatedly', () => {
  const base = rowsToDataFrame(
    [
      { entity_id: 'A', effective_date: '2026-05-01', amount: 10, balance: 100, comment: 'old' },
      { entity_id: 'B', effective_date: '2026-05-02', amount: 20, balance: 120, comment: 'base' },
    ],
    { sheetName: 'Base', a1Range: '' },
  );
  const increment = rowsToDataFrame(
    [
      { entity_id: ' a ', effective_date: '2026/05/01', amount: '10.0', balance: 100, comment: 'corrected' },
      { entity_id: 'C', effective_date: '2026-05-03', amount: 30, balance: 150, comment: 'new' },
    ],
    { sheetName: 'Increment', a1Range: '' },
  );

  const first = mergeKeyedDataFrames({
    base,
    increment,
    keyColumns,
    outputColumns,
    keyNormalization,
    conflictPolicy: 'increment-wins',
    incomingBlankPolicy: 'preserve',
    sortColumns: ['effective_date'],
  });
  const second = mergeKeyedDataFrames({
    base: first.dataframe,
    increment,
    keyColumns,
    outputColumns,
    keyNormalization,
    conflictPolicy: 'increment-wins',
    incomingBlankPolicy: 'preserve',
    sortColumns: ['effective_date'],
  });

  assert.equal(first.dataframe.rows.length, 3);
  assert.equal(second.dataframe.rows.length, 3);
  assert.deepEqual(second.dataframe.rows, first.dataframe.rows);
  assert.equal(first.dataframe.rows[0]?.comment, 'corrected');
  assert.equal(first.stats.insertedRowCount, 1);
  assert.equal(first.stats.replacedRowCount, 1);
  assert.equal(second.stats.insertedRowCount, 0);
  assert.equal(second.stats.replacedRowCount, 2);
});

test('keyed merge keeps prior non-blank values when an increment field is blank', () => {
  const base = rowsToDataFrame(
    [{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, balance: 100, comment: 'keep me' }],
    { sheetName: 'Base', a1Range: '' },
  );
  const increment = rowsToDataFrame(
    [{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, balance: 110, comment: null }],
    { sheetName: 'Increment', a1Range: '' },
  );

  const result = mergeKeyedDataFrames({
    base,
    increment,
    keyColumns,
    outputColumns,
    keyNormalization,
    incomingBlankPolicy: 'preserve',
  });

  assert.deepEqual(result.dataframe.rows[0], {
    entity_id: 'A',
    effective_date: '2026-05-01',
    amount: 10,
    balance: 110,
    comment: 'keep me',
  });
});

test('keyed merge can expose generic audit columns for downstream checks', () => {
  const base = rowsToDataFrame([{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, balance: 100 }], {
    sheetName: 'Base',
    a1Range: '',
  });
  const increment = rowsToDataFrame([{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, balance: 101 }], {
    sheetName: 'Increment',
    a1Range: '',
  });

  const result = mergeKeyedDataFrames({
    base,
    increment,
    keyColumns,
    outputColumns,
    keyNormalization,
    emitAuditColumns: true,
  });

  assert.equal(result.dataframe.columns.includes('__merge_key'), true);
  assert.equal(result.dataframe.rows[0]?.__merge_action, 'replaced');
  assert.equal(result.dataframe.rows[0]?.__merge_source, 'increment');
});

test('keyed merge can treat blank numeric key values as zero', () => {
  const base = rowsToDataFrame(
    [{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, optional: null, balance: 100 }],
    { sheetName: 'Base', a1Range: '' },
  );
  const increment = rowsToDataFrame(
    [{ entity_id: 'A', effective_date: '2026-05-01', amount: 10, optional: 0, balance: 101 }],
    { sheetName: 'Increment', a1Range: '' },
  );

  const result = mergeKeyedDataFrames({
    base,
    increment,
    keyColumns: keyColumns.concat('optional'),
    outputColumns: outputColumns.concat('optional'),
    keyNormalization: {
      ...keyNormalization,
      nullAsZeroColumns: ['optional'],
    },
  });

  assert.equal(result.dataframe.rows.length, 1);
});
