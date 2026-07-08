import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');

function pageLabel(page: string): string {
  const match = html.match(new RegExp(`<div class="nav-item[^"]*" data-page="${page}"[\\s\\S]*?<span class="nav-text">([^<]+)</span>`));
  return match?.[1]?.trim() ?? '';
}

function pagePosition(page: string): number {
  return html.indexOf(`data-page="${page}"`);
}

test('primary navigation follows the product menu layout before dev tools', () => {
  const expectedPages = [
    'captable',
    'monthly',
    'esop-detail',
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'employee-management',
    'plan-summary',
    'five-percent-holders',
    'fixed-value',
  ];

  assert.deepEqual(
    expectedPages.map((page) => pageLabel(page)),
    [
      'Captable',
      'Monthly Updates',
      'ESOP Detail',
      'Grant Record',
      'Exercise to Date',
      'Sold Shares',
      '2025 Transfer to Futu',
      'Employee Management',
      'Plan Summary',
      '5% Holders',
      'Fixed Value',
    ],
  );

  const positions = expectedPages.map((page) => pagePosition(page));
  assert.equal(positions.every((position) => position >= 0), true);
  assert.deepEqual([...positions].sort((a, b) => a - b), positions);

  assert.equal(pagePosition('summary'), -1);

  const firstDevTool = Math.min(pagePosition('files'), pagePosition('workflow'));
  assert.equal(positions.every((position) => position < firstDevTool), true);
});

test('captable is the renamed Summary page and new product pages have matching sections', () => {
  [
    'captable',
    'esop-detail',
    'grant-record',
    'exercise-record',
    'sold-shares',
    'transfer-plan',
    'employee-management',
    'plan-summary',
    'five-percent-holders',
    'fixed-value',
  ].forEach((page) => {
    assert.match(html, new RegExp(`<section class="[^"]*page-section[^"]*" id="page-${page}">`));
  });

  assert.match(html, /id="page-captable"[\s\S]*Shares OS Reconciliation/);
  assert.match(html, /id="page-captable"[\s\S]*Capitalization Table \(Summary View\)/);
  assert.doesNotMatch(html, /id="page-summary"/);
});
