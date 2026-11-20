import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveInheritedSourceFiles } from './inheritedSources.js';

/**
 * The Monthly Update page shows the file the system inherits for a source nobody binds. Two things
 * must not be confused:
 *
 * - A month that has already run is described by that run's own snapshot — the file it consumed. A
 *   later re-run of the previous month can move what a *new* run would pick, and that must not
 *   rewrite what the finished run is reported to have read.
 * - A month that has not run is described by replaying the chain lookup over the current files.
 *
 * A key the snapshot holds with no file is a real state ("no earlier snapshot"), not a reason to fall
 * back to the lookup: the run read no base, so the row keeps saying so.
 */

type HistoryRow = { runtime_parameters_json: unknown };

function fakeDb(params: { history?: HistoryRow; files?: Array<Record<string, unknown>> }) {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  return {
    calls,
    async queryOne<T>(sql: string, queryParams?: unknown[]) {
      calls.push({ sql, params: queryParams });
      assert.match(sql, /from monthly_run_history/);
      return params.history as T | undefined;
    },
    async query<T>(sql: string, queryParams?: unknown[]) {
      calls.push({ sql, params: queryParams });
      assert.match(sql, /from product_files/);
      return (params.files ?? []) as T[];
    },
  };
}

function productFileRef(key: string, sheet = 'EQ Control Book') {
  return { provider: 'product-files', key, sheet };
}

const BASE_2026_06 = 'control_book/EQ_Control_Book_Base_2026_06.xlsx';
const BASE_2026_07 = 'control_book/EQ_Control_Book_Base_2026_07.xlsx';

test('a month that has not run shows the file the chain resolves for it', async () => {
  const db = fakeDb({
    files: [
      {
        id: 755,
        original_name: 'EQ_Control_Book_Base_2026_06.xlsx',
        logical_path: BASE_2026_06,
        created_at: '2026-10-29T14:30:33Z',
      },
    ],
  });

  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2026-08',
    fileRefs: { base_control_book: productFileRef(BASE_2026_06) },
    sourceKeys: ['base_control_book'],
  });

  assert.deepEqual(sources, [
    {
      sourceKey: 'base_control_book',
      fileId: 755,
      fileName: 'EQ_Control_Book_Base_2026_06.xlsx',
      logicalPath: BASE_2026_06,
      sheetName: 'EQ Control Book',
      createdAt: '2026-10-29T14:30:33.000Z',
      resolvedFrom: 'inherited',
    },
  ]);
  const fileQuery = db.calls.find((call) => /from product_files/.test(call.sql));
  // Logical paths are compared case-insensitively, like the unique index on `product_files`.
  assert.deepEqual(fileQuery?.params, [[], [BASE_2026_06.toLowerCase()]]);
});

test('a finished run wins over a newer base the chain would pick now', async () => {
  const db = fakeDb({
    history: {
      runtime_parameters_json: JSON.stringify({
        fileRefs: { base_control_book: productFileRef(BASE_2026_06) },
      }),
    },
    files: [
      {
        id: 761,
        original_name: 'EQ_Control_Book_Base_2026_07.xlsx',
        logical_path: BASE_2026_07,
        created_at: '2026-10-30T09:00:00Z',
      },
      {
        id: 755,
        original_name: 'EQ_Control_Book_Base_2026_06.xlsx',
        logical_path: BASE_2026_06,
        created_at: '2026-10-29T14:30:33Z',
      },
    ],
  });

  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2026-08',
    // The chain would now resolve the July base (the previous month was re-run afterwards).
    fileRefs: { base_control_book: productFileRef(BASE_2026_07) },
    sourceKeys: ['base_control_book'],
  });

  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.logicalPath, BASE_2026_06);
  assert.equal(sources[0]?.fileId, 755);
  assert.equal(sources[0]?.resolvedFrom, 'run');
});

test('a run that consumed no base falls back to what the next run would inherit', async () => {
  const db = fakeDb({
    history: { runtime_parameters_json: JSON.stringify({ fileRefs: { base_control_book: {} } }) },
    files: [
      {
        id: 755,
        original_name: 'EQ_Control_Book_Base_2026_06.xlsx',
        logical_path: BASE_2026_06,
        created_at: '2026-10-29T14:30:33Z',
      },
    ],
  });

  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2025-12',
    fileRefs: { base_control_book: productFileRef(BASE_2026_06) },
    sourceKeys: ['base_control_book'],
  });

  // The page configures the run that comes next: that one would read the chain's base, not nothing.
  assert.equal(sources.length, 1);
  assert.equal(sources[0]?.fileId, 755);
  assert.equal(sources[0]?.resolvedFrom, 'inherited');
});

test('a month with no run and no chain file reports nothing, without querying files', async () => {
  const db = fakeDb({});

  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2025-12',
    fileRefs: {},
    sourceKeys: ['base_control_book'],
  });

  assert.deepEqual(sources, []);
  assert.equal(
    db.calls.some((call) => /from product_files/.test(call.sql)),
    false,
  );
});

test('an explicit binding is not reported as inherited, and no key means no query', async () => {
  const db = fakeDb({});
  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2026-08',
    fileRefs: {},
    sourceKeys: [],
  });

  assert.deepEqual(sources, []);
  assert.equal(db.calls.length, 0);
});

test('a reference by id resolves its name, and a deleted file keeps the path it used', async () => {
  const db = fakeDb({
    files: [
      {
        id: 265,
        original_name: 'Control_Books_Detail_Data_17.09.2026_15.04.xlsx',
        logical_path: 'input/2026-08/Control_Books_Detail_Data_17.09.2026_15.04.xlsx',
        created_at: '2026-10-16T08:17:19Z',
      },
    ],
  });

  const sources = await resolveInheritedSourceFiles(db, {
    monthKey: '2026-08',
    fileRefs: {
      incremental_control_book: { provider: 'product-files', id: 265, sheet: '27591' },
      previous_capitalization_summary: { provider: 'product-files', key: 'output/captable/2026-07/missing.xlsx' },
    },
    sourceKeys: ['incremental_control_book', 'previous_capitalization_summary'],
  });

  const byKey = new Map(sources.map((source) => [source.sourceKey, source]));
  assert.equal(byKey.get('incremental_control_book')?.fileId, 265);
  assert.equal(byKey.get('incremental_control_book')?.sheetName, '27591');
  const missing = byKey.get('previous_capitalization_summary');
  assert.equal(missing?.fileId, null);
  assert.equal(missing?.fileName, null);
  assert.equal(missing?.logicalPath, 'output/captable/2026-07/missing.xlsx');
});
