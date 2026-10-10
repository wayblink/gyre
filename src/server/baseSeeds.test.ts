import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createDb } from './db.js';
import { fileStorage } from './storage.js';
import { config } from './config.js';
import { loadBaseSeedManifest, seedBaseSeedFiles } from './baseSeeds.js';
import { extractSheetRangeAsDataFrame } from './excel.js';

/**
 * These run against a real Postgres because the point is the cold-start path: a database with no
 * `product_files` row for a base must end up with one that the consuming sub-workflow can extract.
 * Set BASE_SEED_TEST_DATABASE_URL to a throwaway database; the suite skips itself when unset so a
 * normal `npm test` does not need Postgres.
 */

/**
 * Run against a throwaway database with:
 *   BASE_SEED_TEST_DATABASE_URL='postgres://...' DATABASE_URL="$BASE_SEED_TEST_DATABASE_URL" \
 *     npx tsx --test src/server/baseSeeds.test.ts
 * `config` reads DATABASE_URL at module load, so both must point at the same database; without
 * BASE_SEED_TEST_DATABASE_URL the suite skips itself so a plain `npm test` needs no Postgres.
 */
const databaseUrl = process.env.BASE_SEED_TEST_DATABASE_URL;
const seeded =
  databaseUrl && config.databaseUrl === databaseUrl
    ? { databaseUrl }
    : { skip: 'BASE_SEED_TEST_DATABASE_URL unset (or does not match DATABASE_URL)' };

test('the committed seed set satisfies each base contract', seeded, async () => {
  const manifest = loadBaseSeedManifest();
  assert.ok(manifest, 'database/base-seeds/manifest.json must exist');
  assert.equal(manifest.seeds.length, 3);

  // The three `optionalCategory: 'inherit'` sources that need a base...
  assert.deepEqual(manifest.seeds.map((seed) => seed.sourceKey).sort(), [
    'base_cancel_restore_report',
    'base_control_book',
    'base_futu_exercises',
  ]);
  // ...and not the one that is injected at run time from the previous month's output.
  assert.ok(!manifest.seeds.some((seed) => seed.sourceKey === 'previous_capitalization_summary'));

  for (const seed of manifest.seeds) {
    const filePath = path.join(config.rootDir, 'database', 'base-seeds', seed.logicalPath);
    assert.ok(existsSync(filePath), `seed file missing: ${seed.logicalPath}`);
    const buffer = await fileStorage.read(filePath);
    const frame = extractSheetRangeAsDataFrame(buffer, seed.sheetName, {
      range: seed.contract.range,
      headerRow: seed.contract.headerRow,
      dropTrailingEmptyRows: true,
    });
    assert.equal(frame.columns.length, seed.columns.length, `${seed.logicalPath}: column count`);
    assert.equal(frame.rows.length, seed.rowCount, `${seed.logicalPath}: row count`);
    assert.ok(frame.rows.length > 0, `${seed.logicalPath}: must not be empty`);
  }
});

test('a cold-start init registers the bases and makes each one extractable', seeded, async () => {
  // The real init path: AppDb.init() applies the schema, then ensureWorkflowSeedData() seeds the
  // workflow metadata and the base seeds. Point WORKFLOW_SEED_ON_INIT at a throwaway database.
  const db = await createDb();
  try {
    for (const seed of loadBaseSeedManifest()!.seeds) {
      const row = await db.queryOne<{ id: number; file_path: string; logical_path: string }>(
        'select id, file_path, logical_path from product_files where logical_path = $1',
        [seed.logicalPath],
      );
      assert.ok(row, `${seed.logicalPath} must be registered by init`);
      // The row is only useful if the bytes behind it extract to the recorded contract — this is
      // what the merge sub-workflow's extract task will do on its first run.
      const buffer = await fileStorage.read(row.file_path);
      const frame = extractSheetRangeAsDataFrame(buffer, seed.sheetName, {
        range: seed.contract.range,
        headerRow: seed.contract.headerRow,
        dropTrailingEmptyRows: true,
      });
      assert.equal(frame.rows.length, seed.rowCount, `${seed.logicalPath}: extractable`);
      assert.equal(frame.columns.length, seed.columns.length, `${seed.logicalPath}: columns`);
    }

    // Re-running must be a no-op: an existing row is never overwritten, so a system that has
    // already run months keeps its own newer bases.
    const second = await seedBaseSeedFiles(db);
    assert.equal(second.registered.length, 0, 're-running must not re-register');
    assert.equal(second.skipped.length, 3);
  } finally {
    await db.close();
  }
});
