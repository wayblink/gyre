import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const FILE_IDENTITY_KEYS = ['provider', 'id', 'key'];

function readSeed(workflowCode: string) {
  return JSON.parse(readFileSync(path.join(process.cwd(), 'database/workflows', `${workflowCode}.json`), 'utf8')) as {
    runtimeParamsDefaults?: { fileRefs?: Record<string, Record<string, unknown>> };
  };
}

/**
 * Child workflows whose file inputs are optional for the monthly run.
 *
 * The monthly workflow passes `{ sheet }` down for a source the operator left empty. If such a
 * definition still pins a file in its own `runtimeParamsDefaults`, the parent's "not supplied"
 * becomes "read this historical workbook" — that is exactly how a monthly run failed with
 * `Product file not found: input/series-b/Control_Books_Detail_Data_16.09.2026_19.31.xlsx` while the
 * page showed SERIES B Control Book as an optional, unconfigured input.
 */
const OPTIONAL_FILE_WORKFLOWS = [
  'read-series-b',
  'futu-exercises-incremental-merge',
  'gyre-therapeutics-cancel-restore-incremental-merge',
  'plan-summary-sync',
];

test('no workflow seed pins a file from a specific month folder in its runtime defaults', () => {
  // A default that points into `input/<yyyy-mm>/` is a snapshot of one month's upload. Merging it in
  // can only ever read the wrong month's workbook, so every such default belongs in the caller's
  // binding (or in `injectPreviousMonthBase` for the chained bases).
  const offenders: string[] = [];
  for (const file of readdirSync(path.join(process.cwd(), 'database/workflows'))) {
    if (!file.endsWith('.json')) continue;
    const seed = readSeed(file.replace(/\.json$/, ''));
    for (const [sourceKey, fileRef] of Object.entries(seed.runtimeParamsDefaults?.fileRefs ?? {})) {
      const key = String(fileRef.key ?? '');
      if (/input\/\d{4}-\d{2}\//.test(key)) offenders.push(`${file}:fileRefs.${sourceKey}=${key}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('optional-input child workflows never pin a file in their runtime defaults', () => {
  for (const workflowCode of OPTIONAL_FILE_WORKFLOWS) {
    const seed = readSeed(workflowCode);
    for (const [sourceKey, fileRef] of Object.entries(seed.runtimeParamsDefaults?.fileRefs ?? {})) {
      const identity = Object.keys(fileRef).filter((key) => FILE_IDENTITY_KEYS.includes(key));
      assert.deepEqual(
        identity,
        [],
        `${workflowCode}.runtimeParamsDefaults.fileRefs.${sourceKey} pins a file (${identity.join(', ')}); ` +
          'the caller binding must stay authoritative, so the default may only carry the sheet',
      );
    }
  }
});
