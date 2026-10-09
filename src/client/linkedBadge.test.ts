import assert from 'node:assert/strict';
import test from 'node:test';
import { buildLinkedBadge } from './linkedBadge.js';

// A DOM-free stand-in for main.ts's escapeHtml, with the same &<> semantics, so we can observe that
// the title is passed through escaping without pulling in the browser `document` API.
const escape = (text: unknown): string =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

test('no linked identities renders nothing', () => {
  assert.equal(buildLinkedBadge(undefined, 'zh-CN', escape), '');
  assert.equal(buildLinkedBadge([], 'zh-CN', escape), '');
});

test('a linked identity renders the zh-CN 关联 badge with a leading space', () => {
  const html = buildLinkedBadge([{ source: 'futu', employeeId: 'K01447', name: '王涛' }], 'zh-CN', escape);
  assert.match(html, /^ <span class="linked-badge"/); // leading space so it sits after the name
  assert.match(html, />关联<\/span>$/);
  assert.match(html, /title="futu:K01447 王涛"/);
});

test('non-zh language renders the English Linked label', () => {
  const html = buildLinkedBadge([{ source: 'shareworks', employeeId: 'SW-1', name: 'Alice' }], 'en-US', escape);
  assert.match(html, />Linked<\/span>$/);
  assert.match(html, /title="shareworks:SW-1 Alice"/);
});

test('multiple identities join with the full-width semicolon in the tooltip', () => {
  const html = buildLinkedBadge(
    [
      { source: 'futu', employeeId: 'K00926', name: '李瑞瑞' },
      { source: 'shareworks', employeeId: 'SW-9', name: '李瑞瑞' },
    ],
    'zh-CN',
    escape,
  );
  assert.match(html, /title="futu:K00926 李瑞瑞；shareworks:SW-9 李瑞瑞"/);
});

test('the tooltip title is passed through escape', () => {
  const html = buildLinkedBadge([{ source: 'futu', employeeId: 'K1', name: '<b>&' }], 'zh-CN', escape);
  assert.match(html, /title="futu:K1 &lt;b&gt;&amp;"/);
});
