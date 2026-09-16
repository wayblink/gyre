import { readFileSync } from 'node:fs';
import path from 'node:path';
import XLSX from 'xlsx';
import { config } from './config.js';
import type { AppDb, DbClient } from './db.js';
import {
  parseFivePercentHoldersGrid,
  type FivePercentHoldersWorkbook,
} from './fivePercentHolders/persistence.js';
import { FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS } from './dataManagementWorkflow/workflowDefinitions.js';
import { workflowOperatorDefinitions } from './workflow/operators/registry.js';
import { loadWorkflowSeedDefinitionsFromDisk } from './workflow/workflowSeedLoader.js';
import type { WorkflowRuntimeParameters, WorkflowRuntimeParametersSchema, WorkflowTask } from '../shared/types.js';

export type WorkflowSeedDefinition = {
  code: string;
  name: string;
  description: string;
  status: 'active';
  version: number;
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
};

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '--') return null;
  return text;
}

type GrantSheetRow = Record<string, unknown>;
type ExerciseWorkbookRow = {
  name: string;
  employeeNumber: string;
  futubullId: string;
  userId: string;
  grantNumber: string;
  grantDate: string;
  grantPriceUsd: number;
  exerciseDate: string;
  orderedQuantity: number;
  exercisedQuantity: number;
  exerciseCostUsd: number;
  deductionSellingQuantity: number;
  dealtQuantity: number;
};
export type SoldSharesWorkbookRow = {
  name: string;
  employeeNumber: string;
  futubullId: string;
  userId: string;
  employmentStatus: string;
  relatedPartyIdentity: string;
  capitalGainsTaxVisibility: string;
  soldQuantity: number;
  dealtQuantity: number;
  dealAmountUsd: number;
  taxableIncomeUsd: number;
  taxPayableUsd: number;
  transactionFeesUsd: number;
  netDealValueUsd: number;
  grantCostUsd: number;
  exerciseVestingFeeUsd: number;
  withholdingTaxUsd: number;
  withholdingTaxCny: number;
  cashNetProceedsUsd: number;
};
export type TransferPlanWorkbookDetail = {
  employeeNumber: string;
  periodValues: Record<string, number>;
  total: number;
};
export type TransferPlanWorkbookPeriod = {
  period: string;
  inTotal: number;
  sourceCancelled: number;
  transferToFutu: number;
  sortOrder: number;
};
export type TransferPlanWorkbookData = {
  details: TransferPlanWorkbookDetail[];
  periods: TransferPlanWorkbookPeriod[];
  totals: {
    inTotal: number;
    sourceCancelled: number;
    transferToFutu: number;
  };
};

function readSeedWorkbook(workbookPath: string): XLSX.WorkBook {
  return XLSX.read(readFileSync(workbookPath), { type: 'buffer' });
}

export function loadShareworksGrantWorkbook(): GrantSheetRow[] {
  const workbookPath = path.join(config.rootDir, 'database', '!!Gyre Cap Table 05.31.26【新】.xlsx');
  const workbook = readSeedWorkbook(workbookPath);
  const sheet = workbook.Sheets['Options OS Detail'];
  if (!sheet) throw new Error(`Missing Options OS Detail sheet in ${workbookPath}`);
  return XLSX.utils
    .sheet_to_json<GrantSheetRow>(sheet, { defval: '', range: 1, raw: false })
    .filter((row) => asText(row['Employee Grant Number']));
}

export function loadFivePercentHoldersWorkbook(): FivePercentHoldersWorkbook {
  const workbookPath = path.join(config.rootDir, 'database', '!!Gyre Cap Table 05.31.26【新】.xlsx');
  const workbook = readSeedWorkbook(workbookPath);
  const sheet = workbook.Sheets['5% Holders'];
  if (!sheet) throw new Error(`Missing 5% Holders sheet in ${workbookPath}`);
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null, raw: false });
  return parseFivePercentHoldersGrid(grid);
}

function workbookNumber(value: unknown, column: string): number {
  const normalized = String(value ?? '')
    .replace(/,/g, '')
    .trim();
  const parsed = Number(normalized);
  if (!normalized || !Number.isFinite(parsed)) {
    throw new Error(`Invalid ${column} value in Futu BCI Exercises to Date: ${String(value)}`);
  }
  return parsed;
}

export function loadExerciseWorkbook(): ExerciseWorkbookRow[] {
  const workbookPath = path.join(
    config.rootDir,
    'database',
    'extracted-sheets',
    'Futu BCI Exercises to Date.xlsx',
  );
  const workbook = readSeedWorkbook(workbookPath);
  const sheet = workbook.Sheets['Futu BCI Exercises to Date'];
  if (!sheet) throw new Error(`Missing Futu BCI Exercises to Date sheet in ${workbookPath}`);

  return XLSX.utils
    .sheet_to_json<GrantSheetRow>(sheet, { defval: '', raw: false })
    .filter((row) => {
      const employeeNumber = asText(row['Employee No.']);
      return employeeNumber !== null && employeeNumber !== '员工编号';
    })
    .map((row) => ({
      name: asText(row.Name) ?? '',
      employeeNumber: asText(row['Employee No.']) ?? '',
      futubullId: asText(row['Futubull ID']) ?? '',
      userId: asText(row['User ID']) ?? '',
      grantNumber: asText(row['Grant No.']) ?? '',
      grantDate: asText(row['Grant Date']) ?? '',
      grantPriceUsd: workbookNumber(row['Grant Price(USD)'], 'Grant Price(USD)'),
      exerciseDate: asText(row['Exercise Date']) ?? '',
      orderedQuantity: workbookNumber(row['Ordered Qty'], 'Ordered Qty'),
      exercisedQuantity: workbookNumber(row['Exercised Qty'], 'Exercised Qty'),
      exerciseCostUsd: workbookNumber(row['Exercise Cost(USD)'], 'Exercise Cost(USD)'),
      deductionSellingQuantity: workbookNumber(row['Deduction/Selling Qty.'], 'Deduction/Selling Qty.'),
      dealtQuantity: workbookNumber(row['Dealt Qty.'], 'Dealt Qty.'),
    }));
}

export function loadSoldSharesWorkbook(): SoldSharesWorkbookRow[] {
  const workbookPath = path.join(config.rootDir, 'database', 'extracted-sheets', 'Futu sold shares.xlsx');
  const workbook = readSeedWorkbook(workbookPath);
  const sheet = workbook.Sheets['Futu sold shares'];
  if (!sheet) throw new Error(`Missing Futu sold shares sheet in ${workbookPath}`);

  return XLSX.utils
    .sheet_to_json<GrantSheetRow>(sheet, { defval: '', raw: false })
    .filter((row) => asText(row['工号']) !== null)
    .map((row) => ({
      name: asText(row['姓名']) ?? '',
      employeeNumber: asText(row['工号']) ?? '',
      futubullId: asText(row['牛牛号']) ?? '',
      userId: asText(row['用户ID']) ?? '',
      employmentStatus: asText(row['在职状态']) ?? '',
      relatedPartyIdentity: asText(row['关联人士身份']) ?? '',
      capitalGainsTaxVisibility: asText(row['财产转让所得税']) ?? '',
      soldQuantity: workbookNumber(row['出售总数量'], '出售总数量'),
      dealtQuantity: workbookNumber(row['成交总数量'], '成交总数量'),
      dealAmountUsd: workbookNumber(row['成交总金额（美元）'], '成交总金额（美元）'),
      taxableIncomeUsd: workbookNumber(row['财产转让所得总应税收入（美元）'], '财产转让所得总应税收入（美元）'),
      taxPayableUsd: workbookNumber(row['财产转让所得总应纳税额（美元）'], '财产转让所得总应纳税额（美元）'),
      transactionFeesUsd: workbookNumber(row['交易总费用（美元）'], '交易总费用（美元）'),
      netDealValueUsd: workbookNumber(row['成交净值（美元）'], '成交净值（美元）'),
      grantCostUsd: workbookNumber(row['授予成本（美元）'], '授予成本（美元）'),
      exerciseVestingFeeUsd: workbookNumber(row['行权/归属手续费（美元）'], '行权/归属手续费（美元）'),
      withholdingTaxUsd: workbookNumber(row['本期合计代扣税额（美元）'], '本期合计代扣税额（美元）'),
      withholdingTaxCny: workbookNumber(row['本期合计代扣税额（人民币）'], '本期合计代扣税额（人民币）'),
      cashNetProceedsUsd: workbookNumber(row['现金净收益(美元)'], '现金净收益(美元)'),
    }));
}

export function loadTransferPlanWorkbook(
  workbookPath = path.join(
    config.rootDir,
    'database',
    'extracted-sheets',
    '2025 BC Subplan Transfer.xlsx',
  ),
): TransferPlanWorkbookData {
  const workbook = readSeedWorkbook(workbookPath);
  const sheet = workbook.Sheets['2025 BC Subplan Transfer'];
  if (!sheet) throw new Error(`Missing 2025 BC Subplan Transfer sheet in ${workbookPath}`);

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    raw: true,
  });
  const headerIndex = rows.findIndex((row) => asText(row[0]) === '行标签');
  if (headerIndex < 0) throw new Error(`Missing 行标签 header in ${workbookPath}`);

  const header = rows[headerIndex];
  const periodColumns = header
    .map((value, column) => ({ period: asText(value), column }))
    .filter(
      (item): item is { period: string; column: number } =>
        item.column > 0 && item.period !== null && !['(空白)', '总计'].includes(item.period),
    );
  const totalColumn = header.findIndex((value) => asText(value) === '总计');
  const totalRows = rows.filter((row) => asText(row[0]) === '总计');
  if (totalColumn < 0 || totalRows.length < 2) {
    throw new Error(`Missing source and adjusted total rows in ${workbookPath}`);
  }

  const numberAt = (row: unknown[], column: number) => Number(row[column] ?? 0);
  const sourceTotalRow = totalRows[0];
  const adjustedTotalRow = totalRows[1];
  const periods = periodColumns.map(({ period, column }, sortOrder) => {
    const inTotal = numberAt(sourceTotalRow, column);
    const transferToFutu = numberAt(adjustedTotalRow, column);
    return {
      period,
      inTotal,
      sourceCancelled: transferToFutu - inTotal,
      transferToFutu,
      sortOrder,
    };
  });
  const details = rows
    .filter((row) => /^K\d+$/.test(asText(row[0]) ?? ''))
    .map((row) => ({
      employeeNumber: asText(row[0]) ?? '',
      periodValues: Object.fromEntries(
        periodColumns.map(({ period, column }) => [period, numberAt(row, column)]),
      ),
      total: numberAt(row, totalColumn),
    }));
  const inTotal = numberAt(sourceTotalRow, totalColumn);
  const transferToFutu = numberAt(adjustedTotalRow, totalColumn);

  return {
    details,
    periods,
    totals: {
      inTotal,
      sourceCancelled: transferToFutu - inTotal,
      transferToFutu,
    },
  };
}

export async function seedTransferPlanData(
  db: Pick<DbClient, 'queryOne' | 'execute'>,
  workbook = loadTransferPlanWorkbook(),
  sourceFileId?: number | null,
) {
  let resolvedSourceFileId = sourceFileId;
  if (resolvedSourceFileId === undefined) {
    const sourceFile = await db.queryOne<{ id: number }>(
      `select id
       from product_files
       where original_name = $1
       order by created_at desc, id desc
       limit 1`,
      ['2025 BC Subplan Transfer.xlsx'],
    );
    resolvedSourceFileId = sourceFile?.id ?? null;
  }

  for (const item of workbook.periods) {
    await db.execute(
      `insert into transfer_plan_periods (
        source_file_id, period, in_total, source_cancelled, cancelled_quantity,
        manually_edited, sort_order, raw_json
      ) values ($1, $2, $3, $4, $4, false, $5, $6::jsonb)
      on conflict (period) do update set
        source_file_id = excluded.source_file_id,
        in_total = excluded.in_total,
        source_cancelled = excluded.source_cancelled,
        cancelled_quantity = case
          when transfer_plan_periods.manually_edited then transfer_plan_periods.cancelled_quantity
          else excluded.cancelled_quantity
        end,
        sort_order = excluded.sort_order,
        raw_json = excluded.raw_json,
        updated_at = current_timestamp`,
      [
        resolvedSourceFileId,
        item.period,
        item.inTotal,
        item.sourceCancelled,
        item.sortOrder,
        JSON.stringify(item),
      ],
    );
  }
}

const GLOBAL_PARAMETER_SEEDS: Array<[string, string, number]> = [
  ['cullgen_common_stock', 'Cullgen common stock（母公司普通股，固定值可修改）', 14_450_527],
  ['gyre_2023_china_subplan_total', 'Gyre 2023 China SubPlan Total（Futu 侧已归属总数，固定值可修改）', 7_815_396],
  ['warrants_convertible_preferred', 'Warrants for Convertible Preferred Stock（固定值，可修改）', 540_666],
  ['series_b_preferred_stock', 'Series B Preferred Stock（固定值，可修改）', 18_486_180],
  ['options_outstanding_cullgen', 'Options Outstanding - Cullgen（母公司口径固定值）', 4_156_815],
  ['options_available_cullgen', 'Options Available - Cullgen（母公司口径固定值）', 10_994],
  // 5% Holders holder counts default to 0; admins maintain them from the 5% Holders page.
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniCommonStock, '5% Holders - GNI Group Ltd. Common Stock', 0],
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.gniTotalCses, '5% Holders - GNI Group Ltd. Total CSEs', 0],
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaCommonStock, '5% Holders - Songjiang Ma Common Stock', 0],
  [FIVE_PERCENT_HOLDER_GLOBAL_PARAMETER_KEYS.songjiangMaTotalCses, '5% Holders - Songjiang Ma Total CSEs', 0],
];

// Global Parameter defaults are product configuration, not demo business data, so they are
// seeded during service initialization (see ensureWorkflowSeedData) even when demo seeding
// is disabled. The upsert only refreshes label/editable and never overwrites an edited value.
export async function seedGlobalParameters(db: DbClient) {
  for (const [key, label, value] of GLOBAL_PARAMETER_SEEDS) {
    await db.execute(
      `insert into global_parameters (key, label, value, effective_from, editable)
       values ($1, $2, $3, $4, true)
       on conflict (key, effective_from) do update set
         label = excluded.label,
         editable = true`,
      [key, label, value, '2026-05'],
    );
  }
}

// Workflow definitions are database-owned. Code only bootstraps missing built-ins
// for a fresh database and must never overwrite an existing row.
export async function insertWorkflowDefinitionIfMissing(
  db: Pick<DbClient, 'execute'>,
  workflow: WorkflowSeedDefinition,
): Promise<void> {
  await db.execute(
    `insert into workflow_definitions (
        code, name, description, status, version, tasks_json,
        runtime_params_schema_json, runtime_params_defaults_json
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      on conflict (code) do nothing`,
    [
      workflow.code,
      workflow.name,
      workflow.description,
      workflow.status,
      workflow.version,
      JSON.stringify(workflow.tasks),
      JSON.stringify(workflow.runtimeParamsSchema),
      JSON.stringify(workflow.runtimeParamsDefaults),
    ],
  );
}

async function seedWorkflowData(db: DbClient) {
  const operatorCodes = workflowOperatorDefinitions.map((operator) => `'${operator.code}'`).join(', ');
  await db.execute(`delete from workflow_operators where code not in (${operatorCodes})`);
  await db.execute(
    `delete from workflow_definitions
      where code in ($1, $2)`,
    ['captable-import', 'default-workflow'],
  );
  await db.execute(
    `update workflow_definitions
        set code = $2
      where code = $1
        and not exists (select 1 from workflow_definitions where code = $2)`,
    ['gyre-captable-summary-draft', 'gyre-captable-summary-v2'],
  );
  await db.execute(
    `update workflow_definitions
        set code = code || '-duplicate-' || id
      where code = $2
        and exists (select 1 from workflow_definitions where code = $1)`,
    ['gyre-captable-summary-draft', 'gyre-captable-summary-v2'],
  );
  await db.execute(
    `update workflow_definitions
        set code = $2
      where code = $1`,
    ['gyre-captable-summary-draft', 'gyre-captable-summary-v2'],
  );

  for (const operator of workflowOperatorDefinitions) {
    await db.execute(
      `insert into workflow_operators (
        code, name, version, category, description, input_slots_json, output_slots_json, params_schema_json, documentation_json
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, $9::jsonb)
      on conflict (code, version) do update set
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        input_slots_json = excluded.input_slots_json,
        output_slots_json = excluded.output_slots_json,
        params_schema_json = excluded.params_schema_json,
        documentation_json = excluded.documentation_json,
        updated_at = current_timestamp`,
      [
        operator.code,
        operator.name,
        operator.version,
        operator.category,
        operator.description,
        JSON.stringify(operator.inputSlots),
        JSON.stringify(operator.outputSlots),
        JSON.stringify(operator.paramsSchema),
        JSON.stringify(operator.documentation ?? {}),
      ],
    );
  }

  // Workflow definitions are DB-owned and seeded from database/workflows/*.json
  // (exported via scripts/export-workflows.ts). insert-if-missing never overwrites
  // an existing row, so the DB remains the source of truth after first boot.
  for (const workflow of loadWorkflowSeedDefinitionsFromDisk()) {
    await insertWorkflowDefinitionIfMissing(db, workflow);
  }
}

export async function ensureWorkflowSeedData(db: AppDb) {
  await db.transaction(async (client) => {
    await seedWorkflowData(client);
    await seedGlobalParameters(client);
  });
}
