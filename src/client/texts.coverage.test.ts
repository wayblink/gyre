import assert from 'node:assert/strict';
import test from 'node:test';

import { TEXTS } from './texts.js';

/**
 * The bilingual copy table is the only place client strings should come from, so a half-filled entry
 * is a visible bug: English mode falls back to Chinese and nobody notices until a user reports it.
 *
 * The check is deliberately strict about "English that is still Chinese" — copying the Chinese into
 * `en-US` passes a presence check while leaving the UI untranslated, which is exactly the drift this
 * table was created to stop.
 */

const HAN = /\p{Script=Han}/u;

/** Entries where the Chinese glyph is the point: the language's own name in the switcher. */
const INTENTIONALLY_CHINESE = new Set(['中文']);

test('every copy entry has both languages filled in', () => {
  const gaps: string[] = [];
  for (const [namespace, table] of Object.entries(TEXTS)) {
    for (const [key, entry] of Object.entries(table as Record<string, { 'zh-CN'?: string; 'en-US'?: string }>)) {
      const zh = String(entry['zh-CN'] ?? '').trim();
      const en = String(entry['en-US'] ?? '').trim();
      if (!zh) gaps.push(`${namespace}.${key}: missing zh-CN`);
      if (!en) gaps.push(`${namespace}.${key}: missing en-US`);
    }
  }
  assert.deepEqual(gaps, []);
});

test('no English entry is left as Chinese copy', () => {
  const untranslated: string[] = [];
  for (const [namespace, table] of Object.entries(TEXTS)) {
    for (const [key, entry] of Object.entries(table as Record<string, { 'en-US'?: string }>)) {
      const en = String(entry['en-US'] ?? '').trim();
      if (!en || INTENTIONALLY_CHINESE.has(en)) continue;
      if (HAN.test(en)) untranslated.push(`${namespace}.${key}: ${en}`);
    }
  }
  assert.deepEqual(untranslated, []);
});

test('placeholders survive translation', () => {
  const placeholders = /\{(\w+)\}/g;
  const mismatched: string[] = [];
  for (const [namespace, table] of Object.entries(TEXTS)) {
    for (const [key, entry] of Object.entries(table as Record<string, { 'zh-CN'?: string; 'en-US'?: string }>)) {
      const zh = [...String(entry['zh-CN'] ?? '').matchAll(placeholders)].map((match) => match[1]).sort();
      const en = [...String(entry['en-US'] ?? '').matchAll(placeholders)].map((match) => match[1]).sort();
      if (zh.join(',') !== en.join(',')) mismatched.push(`${namespace}.${key}: zh={${zh.join(',')}} en={${en.join(',')}}`);
    }
  }
  assert.deepEqual(mismatched, []);
});
