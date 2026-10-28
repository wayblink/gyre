import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';

/**
 * The inherited bases are a chain: a run writes `<prefix><yyyy_MM>.xlsx`, and the next month reads it.
 *
 * Two things must hold for that to be true in practice. The trigger has to look for the newest snapshot
 * strictly older than the month being run (a month nobody ran produces no file, so "exactly M-1" would drop
 * the history), and the seed must not pin one particular month, because a pinned default silently wins over
 * the lookup whenever a month has no explicit binding — that is how a 2026-08 run ended up reading a
 * September base, and how January read its own output.
 */

const monthlySeedPath = path.join(process.cwd(), 'database', 'workflows', 'gyre-captable-summary-v2.json');
const monthlyRunsSourcePath = path.join(process.cwd(), 'src', 'server', 'routes', 'monthlyRuns.ts');
const manifestPath = path.join(process.cwd(), 'database', 'base-seeds', 'manifest.json');

type ManifestEntry = {
  sourceKey: string;
  logicalPath: string;
  baseMonth: string | null;
  rowCount: number;
};

test('the seed pins no month for an inherited base, so the chain lookup decides', () => {
  const seed = JSON.parse(readFileSync(monthlySeedPath, 'utf8')) as {
    runtimeParamsDefaults: { fileRefs: Record<string, { key?: string; provider?: string; sheet?: string }> };
  };
  for (const key of ['base_control_book', 'base_futu_exercises', 'base_cancel_restore_report']) {
    const entry = seed.runtimeParamsDefaults.fileRefs[key];
    assert.ok(entry, `${key} must still declare its sheet`);
    assert.equal(entry.key, undefined, `${key} must not pin a file identity`);
    assert.equal(entry.provider, undefined, `${key} must not pin a provider`);
    assert.ok(entry.sheet, `${key} must keep its sheet default`);
  }
});

test('the trigger injects the newest snapshot strictly older than the month being run', () => {
  const source = readFileSync(monthlyRunsSourcePath, 'utf8');
  // The lookup compares logical paths so a month that was never run cannot break the chain, and the
  // explicit-binding-wins rule keeps a deliberate manual swap working.
  assert.match(source, /where logical_path like \$1 and logical_path < \$2/);
  assert.match(source, /order by logical_path desc/);
  for (const sourceKey of ['base_cancel_restore_report', 'base_futu_exercises', 'base_control_book']) {
    assert.match(source, new RegExp(`injectLatestEarlierBase\\([\\s\\S]{0,200}'${sourceKey}'`));
  }
});

test('every inherited base ships a 2025-12 chain-head seed', () => {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { seeds: ManifestEntry[] };
  const byKey = new Map(manifest.seeds.map((seed) => [seed.sourceKey, seed]));
  for (const [sourceKey, expectedPath] of [
    ['base_control_book', 'control_book/EQ_Control_Book_Base_2025_12.xlsx'],
    ['base_futu_exercises', 'futu_exercises/Futu_Exercises_Base_2025_12.xlsx'],
    ['base_cancel_restore_report', 'cancel_restore/Gyre_Therapeutics_Cancel_Restore_Base_2025_12.xlsx'],
  ] as const) {
    const seed = byKey.get(sourceKey);
    assert.ok(seed, `${sourceKey} must have a chain-head seed`);
    assert.equal(seed.logicalPath, expectedPath);
    assert.equal(seed.baseMonth, '2025-12');
    assert.ok(seed.rowCount > 0);
  }
});
