import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { createTexts, TEXTS, type TextNamespace } from './texts.js';

const NAMESPACES = Object.keys(TEXTS) as TextNamespace[];

test('every namespace is non-empty and every entry is bilingual', () => {
  assert.ok(NAMESPACES.length >= 7, `expected the merged namespaces, got ${NAMESPACES.join(', ')}`);
  for (const namespace of NAMESPACES) {
    const group = TEXTS[namespace] as Record<string, Record<string, string>>;
    const keys = Object.keys(group);
    assert.ok(keys.length > 0, `${namespace} has no entries`);
    for (const [key, entry] of Object.entries(group)) {
      assert.ok(entry['zh-CN'], `${namespace}.${key} is missing Chinese`);
      assert.ok(entry['en-US'], `${namespace}.${key} is missing English`);
      // An English entry that is still Chinese (or vice versa) means the row was never translated.
      assert.ok(
        !/[\u4e00-\u9fff]/.test(entry['en-US']),
        `${namespace}.${key} still has Chinese text in its English entry`,
      );
    }
  }
});

test('createTexts reads the requested language and falls back to Chinese', () => {
  const t = createTexts('filePicker');
  assert.equal(t('cancel', 'en-US'), 'Cancel');
  assert.equal(t('cancel', 'zh-CN'), '取消');
  // An unknown language must not blank the label.
  assert.equal(t('cancel', 'fr-FR' as 'en-US'), '取消');
});

test('namespaces keep their own keys so shared names do not collide', () => {
  // `cancel` is declared in several namespaces with the same wording; reading it through the
  // namespace accessor must return that namespace's own entry, not another module's.
  const withCancel = NAMESPACES.filter((namespace) => 'cancel' in (TEXTS[namespace] as Record<string, unknown>));
  assert.ok(withCancel.length >= 3, `expected several namespaces to declare cancel, got ${withCancel.join(', ')}`);
  for (const namespace of withCancel) {
    assert.equal(createTexts(namespace)('cancel' as never, 'zh-CN'), '取消');
  }
  // `save` and `confirm` are genuinely different buttons, and must stay so.
  assert.notEqual(
    (TEXTS.files as Record<string, Record<'zh-CN', string>>).save['zh-CN'],
    (TEXTS.filePicker as Record<string, Record<'zh-CN', string>>).confirm['zh-CN'],
  );
});

test('the merged table is the only place client copy is declared', () => {
  // Modules must read the table, not redeclare their own bilingual objects. A `{ 'zh-CN': … }`
  // object literal outside texts.ts means a new parallel table crept back in.
  const modules = ['main.ts', 'filePickerModal.ts', 'filesPage.ts', 'fileMoveDialog.ts', 'uploadProgress.ts'];
  for (const module of modules) {
    const source = readFileSync(new URL(`./${module}`, import.meta.url), 'utf8');
    const inlineTables = source.match(/\{\s*'zh-CN':[ ]*'/g) ?? [];
    assert.equal(inlineTables.length, 0, `${module} still declares bilingual copy inline; move it into texts.ts`);
  }

  // Two documented exceptions, checked narrowly:
  //  - monthlyRunPage.MONTHLY_FIXED_VALUE_DEFS is workflow constant metadata (key/label/description)
  //    that ships with the monthly workflow definition, not UI chrome.
  //  - workflowUpdateModal builds status/step messages with interpolation, so they stay functions
  //    next to the code that formats them.
  const monthlyRun = readFileSync(new URL('./monthlyRunPage.ts', import.meta.url), 'utf8');
  const outsideMetadata = monthlyRun.replace(/export const MONTHLY_FIXED_VALUE_DEFS[\s\S]*$/, '');
  assert.equal(
    (outsideMetadata.match(/\{\s*'zh-CN':[ ]*'/g) ?? []).length,
    0,
    'monthlyRunPage.ts declares inline copy outside the fixed-value metadata',
  );

  const modal = readFileSync(new URL('./workflowUpdateModal.ts', import.meta.url), 'utf8');
  const withoutBuilders = modal.replace(/function (statusMessage|stepStatusText)\([\s\S]*?\n {2}\}/g, '');
  assert.equal(
    (withoutBuilders.match(/\{\s*'zh-CN':[ ]*'/g) ?? []).length,
    0,
    'workflowUpdateModal.ts declares inline copy outside its message builders',
  );
});
