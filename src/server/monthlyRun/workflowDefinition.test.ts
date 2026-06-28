import assert from 'node:assert/strict';
import test from 'node:test';
import { rowsToDataFrame } from '../excel.js';
import { executeSqlDataFrameQuery } from '../workflow/operators/sqlUtils.js';
import {
  buildMonthlyWorkflowTasks,
  MONTHLY_SUMMARY_COLUMNS,
  MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED,
} from './workflowDefinition.js';

const metricFrames = {
  control_metrics: rowsToDataFrame(
    [
      {
        eom_eq_balance_os: 111_488_849,
        bc_subplan_transfer_control_book: 695_165,
      },
    ],
    { sheetName: 'control_metrics', a1Range: '' },
  ),
  futu_metrics: rowsToDataFrame(
    [
      {
        futu_exercised_qty: 2_938_523,
        bci_shares_held_by_futu: 4_876_873,
      },
    ],
    { sheetName: 'futu_metrics', a1Range: '' },
  ),
  option_metrics: rowsToDataFrame(
    [
      {
        total_options_available: 3_639_230,
        total_options_outstanding: 14_386_058,
      },
    ],
    { sheetName: 'option_metrics', a1Range: '' },
  ),
};

test('monthly capitalization summary workflow SQL matches expected workbook structure', async () => {
  const task = buildMonthlyWorkflowTasks().find((item) => item.id === 'build_capitalization_summary');
  assert.ok(task);

  const result = await executeSqlDataFrameQuery(task, { rowsToDataFrame } as never, async (slot) => {
    const frame = metricFrames[slot as keyof typeof metricFrames];
    if (!frame) throw new Error(`Unexpected input slot ${slot}`);
    return frame;
  });

  assert.deepEqual(result.dataFrame.columns, MONTHLY_SUMMARY_COLUMNS);
  assert.equal(result.dataFrame.rows.length, 13);

  assert.deepEqual(
    result.dataFrame.rows.map((row) => row.Description),
    [
      'Issued Shares -Equity Asset Class',
      'Asset Class Summary: EOM',
      'Common Shares OS',
      'Cullgen common stock',
      'BCI Shares Held by Futu',
      '2025 BC Subplan shares transferred to Futu',
      'Derivative Equity Incentives',
      'Warrants for Convertible Preferred Stock',
      'Options Outstanding- Gyre',
      'Options Available- Gyre',
      'Options Outstanding- Cullgen',
      'Options Available- Cullgen',
      'Total Fully Diluted Shares Outstand',
    ],
  );

  const commonShares = result.dataFrame.rows.find((row) => row.Description === 'Common Shares OS');
  const transfer = result.dataFrame.rows.find((row) => row.Description === '2025 BC Subplan shares transferred to Futu');
  const optionsOutstanding = result.dataFrame.rows.find((row) => row.Description === 'Options Outstanding- Gyre');
  const total = result.dataFrame.rows.find((row) => row.Description === 'Total Fully Diluted Shares Outstand');

  assert.equal(commonShares?.['Common Shares Equivalent'], 91_466_285);
  assert.equal(transfer?.['Common Shares Equivalent'], 695_164);
  assert.equal(optionsOutstanding?.['Common Shares Equivalent'], 13_690_894);
  assert.equal(total?.['Common Shares Equivalent'], MONTHLY_SUMMARY_TOTAL_FULLY_DILUTED);
  assert.equal(total?.['% of fully diluted'], 1);
});
