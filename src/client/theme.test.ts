import assert from 'node:assert/strict';
import { test } from 'node:test';

import { installDom } from '../../test/dom-env.mjs';
import { COLOR_OPTIONS, createThemeControls } from './theme.js';

function setup() {
  const { window } = installDom({ url: 'http://localhost/captable' });
  window.document.body.innerHTML = '<div id="themeColorOptions"></div>';
  const store = new Map<string, string>();
  Object.defineProperty(window, 'localStorage', {
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    },
  });
  const controls = createThemeControls({
    el: ((id: string) => window.document.getElementById(id)) as never,
    escapeHtml: (text) => String(text),
    text: (key) => `copy:${key}`,
  });
  return { window, store, controls };
}

test('the stored selection is applied to the document and persisted', () => {
  const { window, store, controls } = setup();

  controls.apply();

  assert.equal(window.document.documentElement.dataset.themeColor, 'blue');
  assert.equal(window.document.documentElement.dataset.themeStyle, 'flat');
  assert.equal(store.get('captable.theme.color'), 'blue');
  assert.equal(store.get('captable.theme.style'), 'flat');
});

test('the picker renders one card per color with exactly one marked current', () => {
  const { window, controls } = setup();

  controls.renderCards();

  const html = window.document.getElementById('themeColorOptions')!.innerHTML;
  for (const option of COLOR_OPTIONS) {
    assert.match(html, new RegExp(`data-theme-color="${option.name}"`), `${option.name} card missing`);
  }
  assert.equal((html.match(/theme-card active/g) ?? []).length, 1, 'exactly one card is active');
  assert.match(html, /copy:blueDesc/);
  assert.match(html, /copy:current/);
});

test('choosing another color persists it and moves the active marker', () => {
  const { window, store, controls } = setup();

  controls.setColor('teal');

  assert.equal(window.document.documentElement.dataset.themeColor, 'teal');
  assert.equal(store.get('captable.theme.color'), 'teal');
  const html = window.document.getElementById('themeColorOptions')!.innerHTML;
  assert.equal((html.match(/theme-card active/g) ?? []).length, 1);
  assert.match(html, /data-theme-color="teal"[^]*theme-card active|theme-card active[^]*data-theme-color="teal"/);
});

test('re-applying after a reload keeps the stored color', () => {
  const { window, controls } = setup();

  controls.setColor('amber');
  assert.equal(window.document.documentElement.dataset.themeColor, 'amber');

  // A fresh controls instance reads the same storage, like a page reload would.
  const reloaded = createThemeControls({
    el: ((id: string) => window.document.getElementById(id)) as never,
    escapeHtml: (text) => String(text),
    text: (key) => `copy:${key}`,
  });
  reloaded.apply();
  assert.equal(window.document.documentElement.dataset.themeColor, 'amber');
});
