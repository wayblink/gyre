import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFivePercentHoldersGrid } from './persistence.js';

test('structured 5% Holders workflow output parses fixed-value rows and computed percentages', () => {
  const commonStockOs = 91_466_285 + 14_450_527;
  const workbook = parseFivePercentHoldersGrid([
    ['Row Type', 'Name', 'Common Stock', 'Total CSEs', '% of Class', '% Fully Diluted', 'SC13 Filing', 'Note', 'As Of Date', 'Fully Diluted', 'Common Stock OS'],
    ['holder', 'GNI Group Ltd.', 72_773_219, 86_323_015, 72_773_219 / commonStockOs, 86_323_015 / 133_527_448, '', 'Global Parameter maintained manually', '2026/5/31', 133_527_448, commonStockOs],
    ['holder', 'Songjiang Ma', 2_806_084, 7_342_131, 2_806_084 / commonStockOs, 7_342_131 / 133_527_448, '', 'Global Parameter maintained manually', '2026/5/31', 133_527_448, commonStockOs],
    ['total', 'Total >5%', 75_579_303, 93_665_146, 75_579_303 / commonStockOs, 93_665_146 / 133_527_448, '', 'Calculated from fixed values', '2026/5/31', 133_527_448, commonStockOs],
  ]);

  assert.equal(workbook.asOfDate, '2026/5/31');
  assert.equal(workbook.fullyDiluted, 133_527_448);
  assert.equal(workbook.commonStockOs, commonStockOs);
  assert.equal(workbook.holders.length, 3);
  assert.equal(workbook.holders[0]?.name, 'GNI Group Ltd.');
  assert.equal(workbook.holders[0]?.commonStock, 72_773_219);
  assert.ok(Math.abs((workbook.holders[0]?.pctOfClass ?? 0) - 0.6871) < 0.0001);
  assert.equal(workbook.holders[2]?.rowType, 'total');
  assert.equal(workbook.holders[2]?.totalCses, 93_665_146);
});
