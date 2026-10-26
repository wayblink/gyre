import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { describeViewAutoSwitch } from './esopTables.js';

test('the auto-switch notice names the table, the view it left and the view it moved to', () => {
  // It used to be a global toast: two record pages switching at the same time produced two identical
  // messages ("本月当前视图没有数据，已切换到「Shareworks 视图」（该视图 N 条）") with no way to tell
  // which table each belonged to — and it vanished after a few seconds although the view had changed
  // for good.
  const message = describeViewAutoSwitch({
    tableLabel: '授予记录',
    fromLabel: 'Futu 视图',
    toLabel: 'Shareworks 视图',
    rowCount: 67,
  });

  assert.match(message, /授予记录/, 'the table must be named');
  assert.match(message, /Futu 视图/);
  assert.match(message, /Shareworks 视图/);
  assert.match(message, /67 条/);
});

test('the switch is announced in place, with a way back, instead of through a toast', () => {
  const source = readFileSync(new URL('./esopTables.ts', import.meta.url), 'utf8');
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

  // No toast anywhere in the auto-select path.
  const grant = source.match(/async function autoSelectGrantView\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  const exercise = source.match(/async function autoSelectExerciseView\([\s\S]*?\n {2}\}\n/)?.[0] ?? '';
  assert.ok(grant && exercise);
  assert.doesNotMatch(grant, /deps\.notify\(/);
  assert.doesNotMatch(exercise, /deps\.notify\(/);
  assert.doesNotMatch(source, /本月当前视图没有数据/);

  // Inline notice elements exist for both tables, and the notice offers a one-click way back.
  assert.match(html, /id="grantViewNotice"/);
  assert.match(html, /id="exerciseViewNotice"/);
  assert.match(source, /data-view-notice-back=/);
  assert.match(source, /hideViewNotice\('grantViewNotice'\)/);
  assert.match(source, /hideViewNotice\('exerciseViewNotice'\)/);
});
