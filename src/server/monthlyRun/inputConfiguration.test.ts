import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveMonthlyRunInputConfiguration } from './inputConfiguration.js';
import type { MonthlyRunDb } from './store.js';

class FakeDb implements MonthlyRunDb {
  plan: Record<string, unknown> | undefined = {
    id: 12,
    operator: 'Gu',
    month_key: '2026-06',
  };

  metrics: Record<string, unknown>[] = [
    { id: 1, source_group: 'shareworks', label: 'EQ Control Book', required: 'Required', product_file_id: 101, uploaded_file: 'control.xlsx' },
    { id: 2, source_group: 'shareworks', label: 'Option Plans Summary', required: 'Required', product_file_id: 202, uploaded_file: 'options.xlsx' },
    { id: 3, source_group: 'futu', label: 'Futu BCI Exercises to Date', required: 'Required', product_file_id: 303, uploaded_file: 'futu.xlsx' },
  ];
  sourceFiles: Record<number, Record<string, unknown>> = {
    9001: { id: 9001, original_name: 'legacy-control.xlsx', file_path: 'source/legacy-control.xlsx' },
  };
  updates: Array<{ productFileId: number; metricId: number }> = [];

  async query<T>(text: string, params?: unknown[]): Promise<T[]> {
    assert.match(text, /from source_metrics/i);
    assert.deepEqual(params, [12]);
    return this.metrics as T[];
  }

  async queryOne<T>(text: string, params?: unknown[]): Promise<T | undefined> {
    if (/from update_plans/i.test(text)) {
      assert.deepEqual(params, [12]);
      return this.plan as T | undefined;
    }
    if (/from source_files/i.test(text)) {
      const id = Number(params?.[0]);
      return this.sourceFiles[id] as T | undefined;
    }
    throw new Error(`Unexpected queryOne: ${text}`);
  }

  async execute(text: string, params?: unknown[]): Promise<void> {
    assert.match(text, /update source_metrics set product_file_id/i);
    this.updates.push({ productFileId: Number(params?.[0]), metricId: Number(params?.[1]) });
  }
}

test('resolveMonthlyRunInputConfiguration builds workflow runtime fileIds from Input Configuration metrics', async () => {
  const result = await resolveMonthlyRunInputConfiguration(new FakeDb(), 12);

  assert.deepEqual(result, {
    updatePlanId: 12,
    month: '2026-06',
    operator: 'Gu',
    runtimeParameters: {
      month: '2026-06',
      fileIds: {
        control_book: 101,
        futu_exercises: 303,
        option_plans: 202,
      },
    },
    primarySourceFileId: 101,
  });
});

test('resolveMonthlyRunInputConfiguration fails clearly when a required Input Configuration file is missing', async () => {
  const db = new FakeDb();
  db.metrics = db.metrics.filter((row) => row.label !== 'Option Plans Summary');

  await assert.rejects(() => resolveMonthlyRunInputConfiguration(db, 12), /Missing Input Configuration file: Option Plans Summary/);
});

test('resolveMonthlyRunInputConfiguration treats cleared product_file_id as missing even if uploaded_file still has text', async () => {
  const db = new FakeDb();
  db.metrics = db.metrics.map((row) => (row.label === 'EQ Control Book' ? { ...row, product_file_id: null } : row));

  await assert.rejects(() => resolveMonthlyRunInputConfiguration(db, 12), /Input Configuration is incomplete: missing file for EQ Control Book/);
});

test('resolveMonthlyRunInputConfiguration blocks execution when required Input Configuration rows are not complete', async () => {
  const db = new FakeDb();
  db.metrics.push({
    id: 4,
    source_group: 'futu',
    label: 'GYRE 2025 BC Subplan canceled',
    required: 'Required',
    uploaded_file: 'Not uploaded',
    product_file_id: null,
    source_file_id: null,
    status: '',
  });

  await assert.rejects(async () => resolveMonthlyRunInputConfiguration(db, 12), (error: unknown) => {
    assert.match((error as Error).message, /Input Configuration is incomplete: missing file for GYRE 2025 BC Subplan canceled/);
    assert.equal((error as Error & { statusCode?: number }).statusCode, 400);
    return true;
  });
});

test('resolveMonthlyRunInputConfiguration backfills product file id for legacy source file uploads', async () => {
  const db = new FakeDb();
  db.metrics = db.metrics.map((row) =>
    row.label === 'EQ Control Book' ? { ...row, product_file_id: null, source_file_id: 9001 } : row,
  );
  const backfilled: unknown[] = [];

  const result = await resolveMonthlyRunInputConfiguration(db, 12, async (params) => {
    backfilled.push(params);
    return 777;
  });

  assert.deepEqual(backfilled, [
    {
      originalName: 'legacy-control.xlsx',
      filePath: 'source/legacy-control.xlsx',
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      uploadedBy: 'Input Configuration',
      folderPrefix: 'sources/12',
    },
  ]);
  assert.equal((result.runtimeParameters.fileIds as Record<string, number>).control_book, 777);
  assert.deepEqual(db.updates, [{ productFileId: 777, metricId: 1 }]);
});

test('resolveMonthlyRunInputConfiguration resolves legacy uploaded_file text against product files', async () => {
  const db = new FakeDb();
  db.metrics = db.metrics.map((row) =>
    row.label === 'EQ Control Book'
      ? {
          ...row,
          label: 'EOM',
          raw_value: { fileName: 'EQ Control Book', item: 'EOM' },
          product_file_id: null,
          source_file_id: null,
          uploaded_file: 'Control_Books_Detail_Data_02.06.2026_16.42.xlsx',
        }
      : row,
  );
  const lookups: unknown[] = [];

  const result = await resolveMonthlyRunInputConfiguration(db, 12, undefined, async (params) => {
    lookups.push(params);
    return params.uploadedFile.includes('Control_Books_Detail_Data') ? 888 : params.currentProductFileId ?? null;
  });

  assert.deepEqual(lookups, [
    {
      sourceKey: 'input_metric_1',
      label: 'EQ Control Book',
      uploadedFile: 'Control_Books_Detail_Data_02.06.2026_16.42.xlsx',
      defaultSheetName: null,
      currentProductFileId: null,
    },
    {
      sourceKey: 'control_book',
      label: 'EQ Control Book',
      uploadedFile: 'Control_Books_Detail_Data_02.06.2026_16.42.xlsx',
      defaultSheetName: 'EQ Control Book',
      currentProductFileId: 888,
    },
    {
      sourceKey: 'futu_exercises',
      label: 'Futu BCI Exercises',
      uploadedFile: 'futu.xlsx',
      defaultSheetName: 'Futu BCI Exercises to Date',
      currentProductFileId: 303,
    },
    {
      sourceKey: 'option_plans',
      label: 'Option Plans Summary',
      uploadedFile: 'options.xlsx',
      defaultSheetName: 'Option Plans Summary',
      currentProductFileId: 202,
    },
  ]);
  assert.equal((result.runtimeParameters.fileIds as Record<string, number>).control_book, 888);
  assert.deepEqual(db.updates, [{ productFileId: 888, metricId: 1 }]);
});
