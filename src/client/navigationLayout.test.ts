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

test('new product pages expose real data containers instead of placeholder-only shells', () => {
  assert.match(html, /id="page-grant-record"[\s\S]*id="grantTable-futu"/);
  assert.match(html, /id="page-grant-record"[\s\S]*id="holdingsBody"/);
  assert.match(html, /id="page-employee-management"[\s\S]*id="employeesPageTable"/);
  assert.match(html, /id="page-employee-management"[\s\S]*id="employeesPageBody"/);
  assert.match(html, /id="page-plan-summary"[\s\S]*id="planSummaryBody"/);
  assert.match(html, /id="page-five-percent-holders"[\s\S]*id="fivePercentHoldersBody"/);
  assert.match(html, /id="page-fixed-value"[\s\S]*id="fixedValuePageBody"/);
  assert.doesNotMatch(html, /id="page-grant-record"[\s\S]*待接入[\s\S]*id="page-exercise-record"/);
});

test('Grant Record exposes Futu, Shareworks, and Merge tabs with source-specific tables', () => {
  const grantPage = html.match(/id="page-grant-record"[\s\S]*?id="page-exercise-record"/)?.[0] ?? '';

  for (const view of ['futu', 'shareworks', 'merge']) {
    assert.match(grantPage, new RegExp(`data-grant-view="${view}"`));
    assert.match(grantPage, new RegExp(`id="grantPanel-${view}"`));
    assert.match(grantPage, new RegExp(`id="grantTable-${view}"`));
  }

  assert.match(grantPage, /Employee Portal Visibility/);
  assert.match(grantPage, /Participant Type @ Report Date/);
  assert.match(grantPage, /Shares Cancelled\/Expired/);
  assert.match(grantPage, /Data Source/);
});

test('Exercise to Date exposes file-backed filters, table, and pagination', () => {
  const exercisePage = html.match(/id="page-exercise-record"[\s\S]*?id="page-sold-shares"/)?.[0] ?? '';

  assert.match(exercisePage, /id="searchExercises"/);
  assert.match(exercisePage, /id="filterExerciseGrantYear"/);
  assert.match(exercisePage, /id="exerciseTable"/);
  assert.match(exercisePage, /id="exerciseBody"/);
  assert.match(exercisePage, /Futubull ID/);
  assert.match(exercisePage, /Exercise Cost \(USD\)/);
  assert.match(exercisePage, /Deduction\/Selling Qty\./);
  assert.match(exercisePage, /id="exercisePaginationSummary"/);
  assert.match(exercisePage, /id="btnExercisesPrevPage"/);
  assert.match(exercisePage, /id="btnExercisesNextPage"/);
});

test('Sold Shares exposes file-backed filters, nineteen-column table, and pagination', () => {
  const soldSharesPage = html.match(/id="page-sold-shares"[\s\S]*?id="page-transfer-plan"/)?.[0] ?? '';

  assert.match(soldSharesPage, /id="searchSoldShares"/);
  assert.match(soldSharesPage, /id="filterSoldSharesEmploymentStatus"/);
  assert.match(soldSharesPage, /id="soldSharesTable"/);
  assert.match(soldSharesPage, /id="soldSharesBody"/);
  assert.match(soldSharesPage, /Futubull ID/);
  assert.match(soldSharesPage, /Deal Amount \(USD\)/);
  assert.match(soldSharesPage, /Withholding Tax \(CNY\)/);
  assert.match(soldSharesPage, /Cash Net Proceeds \(USD\)/);
  assert.match(soldSharesPage, /id="soldSharesPaginationSummary"/);
  assert.match(soldSharesPage, /id="btnSoldSharesPrevPage"/);
  assert.match(soldSharesPage, /id="btnSoldSharesNextPage"/);
});

test('Transfer to Futu exposes file-backed monthly summary, cancellation editing, and workbook actions', () => {
  const transferPage = html.match(/id="page-transfer-plan"[\s\S]*?id="page-employee-management"/)?.[0] ?? '';

  assert.match(transferPage, /2025 BC Subplan Transfer\.xlsx/);
  assert.match(transferPage, /id="transferPlanSummaryTable"/);
  assert.match(transferPage, /id="transferPlanSummaryHead"/);
  assert.match(transferPage, /id="transferPlanSummaryBody"/);
  assert.match(transferPage, /Options cancelled\/forfeited/);
  assert.match(transferPage, /data-transfer-cancelled/);
  assert.match(transferPage, /id="btnImportTransferPlan"/);
  assert.match(transferPage, /id="btnExportTransferPlan"/);
  assert.match(transferPage, /id="transferPlanFileInput"/);
});
