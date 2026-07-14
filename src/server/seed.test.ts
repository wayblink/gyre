import assert from 'node:assert/strict';
import test from 'node:test';
import {
  loadExerciseWorkbook,
  loadFivePercentHoldersWorkbook,
  loadShareworksGrantWorkbook,
  loadSoldSharesWorkbook,
  loadTransferPlanWorkbook,
} from './seed.js';

test('Shareworks seed rows preserve displayed dates instead of Excel serial numbers', () => {
  const rows = loadShareworksGrantWorkbook();
  const grant = rows.find((row) => row['Employee Grant Number'] === '3046');

  assert.equal(grant?.['Grant Date'], '27-May-2025');
  assert.equal(grant?.['Expire Date'], '27-May-2035');
});

test('Exercise seed rows come from the standalone Futu workbook and exclude non-data rows', () => {
  const rows = loadExerciseWorkbook();

  assert.equal(rows.length, 423);
  assert.deepEqual(rows[0], {
    name: '高媛',
    employeeNumber: 'K00385',
    futubullId: '34856867',
    userId: '12942000000',
    grantNumber: 'K00385',
    grantDate: '2023-10-31',
    grantPriceUsd: 0.75,
    exerciseDate: '2026-05-29',
    orderedQuantity: 5610,
    exercisedQuantity: 5610,
    exerciseCostUsd: 4207.5,
    deductionSellingQuantity: 1513,
    dealtQuantity: 1513,
  });
  assert.equal(rows.some((row) => row.name === 'in Total'), false);
  assert.equal(rows.some((row) => row.employeeNumber === '员工编号'), false);
});

test('Sold Shares seed rows come from the standalone Futu workbook and exclude totals and notes', () => {
  const rows = loadSoldSharesWorkbook();

  assert.equal(rows.length, 34);
  assert.deepEqual(rows[0], {
    name: '李巍',
    employeeNumber: 'K00003',
    futubullId: '26219737',
    userId: '12942000006',
    employmentStatus: '在职',
    relatedPartyIdentity: '否',
    capitalGainsTaxVisibility: '员工可见',
    soldQuantity: 9899,
    dealtQuantity: 9899,
    dealAmountUsd: 100726.68,
    taxableIncomeUsd: 0,
    taxPayableUsd: 0,
    transactionFeesUsd: 131.51,
    netDealValueUsd: 100595.17,
    grantCostUsd: 15750,
    exerciseVestingFeeUsd: 0,
    withholdingTaxUsd: 55038.4,
    withholdingTaxCny: 392271.53,
    cashNetProceedsUsd: 29806.77,
  });
  assert.equal(rows.some((row) => row.name.startsWith('Note:')), false);
  assert.equal(rows.some((row) => row.employeeNumber === ''), false);
});

test('5% Holders sheet parses header context and the >5% ownership rows', () => {
  const data = loadFivePercentHoldersWorkbook();
  assert.equal(data.fullyDiluted, 133527448);
  assert.equal(data.commonStockOs, 105916812);

  const gni = data.holders.find((h) => h.name.startsWith('GNI Group'));
  assert.ok(gni, 'GNI Group holder present');
  assert.equal(gni?.rowType, 'holder');
  assert.equal(gni?.commonStock, 72773219);
  assert.equal(gni?.totalCses, 86323015);
  assert.ok(Math.abs((gni?.pctOfClass ?? 0) - 0.6871) < 1e-9);
  assert.match(gni?.sc13Filing ?? '', /SC13D/);

  const ma = data.holders.find((h) => h.name.includes('Songjiang Ma'));
  assert.equal(ma?.commonStock, 2806084);

  const total = data.holders.find((h) => h.rowType === 'total');
  assert.equal(total?.commonStock, 75579303);
  assert.equal(total?.totalCses, 93665146);
});

test('Transfer to Futu seed data comes from the standalone workbook and preserves source totals', () => {
  const workbook = loadTransferPlanWorkbook();

  assert.equal(workbook.details.length, 451);
  assert.equal(workbook.details[0]?.employeeNumber, 'K00004');
  assert.equal(workbook.details[0]?.periodValues['2025-11'], 1175);
  assert.equal(workbook.details[0]?.periodValues['2026-05 Performance part'], 940);
  assert.equal(workbook.details[0]?.total, 4700);
  assert.equal(workbook.details.at(-1)?.employeeNumber, 'K01574');

  assert.equal(workbook.periods.length, 31);
  assert.deepEqual(workbook.periods[0], {
    period: '2025-11',
    inTotal: 518797,
    sourceCancelled: 0,
    transferToFutu: 518797,
    sortOrder: 0,
  });
  assert.deepEqual(workbook.periods.find((item) => item.period === '2026-01'), {
    period: '2026-01',
    inTotal: 31082,
    sourceCancelled: -303,
    transferToFutu: 30779,
    sortOrder: 2,
  });
  assert.deepEqual(workbook.periods.at(-1), {
    period: '2027-05 Performance part',
    inTotal: 420000,
    sourceCancelled: 0,
    transferToFutu: 420000,
    sortOrder: 30,
  });
  assert.deepEqual(workbook.totals, {
    inTotal: 2100000,
    sourceCancelled: -28171,
    transferToFutu: 2071829,
  });
});
