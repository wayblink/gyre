import type { AppDb, DbClient } from '../db.js';
import { assembleShareworksName, createDbEmployeeStore, upsertEmployeeByEmployeeId } from '../employees.js';
import type { WorkflowDataFrame } from '../../shared/types.js';
import type { EsopPageKey } from './workflowDefinitions.js';

export type EsopPagePersistInput = {
  pageKey: EsopPageKey;
  input1: WorkflowDataFrame;
  input2?: WorkflowDataFrame | null;
  sourceFileIds: Record<string, number>;
};

export type EsopPagePersistResult = {
  pageKey: EsopPageKey;
  rowsWritten: number;
};

function text(value: unknown): string | null {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized : null;
}

export function parseEsopNumber(value: unknown, label: string, nullable = true): number | null {
  if (value === null || value === undefined || ['', '--'].includes(String(value).trim())) {
    if (nullable) return null;
    throw new Error(`Missing ${label}`);
  }
  const normalized = String(value).replace(/,/g, '').trim();
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) throw new Error(`Invalid ${label}: ${String(value)}`);
  return parsed;
}

export function parseEsopDateText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(Date.UTC(1899, 11, 30) + Math.round(value) * 86_400_000).toISOString().slice(0, 10);
  }
  return text(value);
}

async function persistGrantRecords(client: DbClient, input: EsopPagePersistInput): Promise<number> {
  if (!input.input2) throw new Error('Grant Record workflow requires Shareworks input2');
  const futuSourceFileId = input.sourceFileIds.futu_grants ?? null;
  const shareworksSourceFileId = input.sourceFileIds.shareworks_grants ?? null;
  const employeeStore = createDbEmployeeStore(client);

  await client.execute('delete from equity_grants');
  await client.execute('delete from shareworks_grants');

  let rowsWritten = 0;
  for (const row of input.input1.rows) {
    const employeeNumber = text(row['工号']);
    const grantNumber = text(row['授予编号']);
    if (!employeeNumber || !grantNumber) continue;
    const employeeId = await upsertEmployeeByEmployeeId(employeeStore, {
      employeeId: employeeNumber,
      source: 'futu',
      name: text(row['姓名']) ?? employeeNumber,
      hasFileEvidence: true,
    });
    if (!employeeId) continue;
    const userId = text(row['用户ID']);
    if (userId) {
      await client.execute(
        'update employees set user_id = coalesce(user_id, $1), updated_at = current_timestamp where id = $2',
        [userId, employeeId],
      );
    }
    await client.execute(
      `insert into equity_grants (
        source_file_id, employee_id, grant_number, incentive_type, grant_date, grant_quantity, grant_price_usd,
        expire_date, plan_name, condition_rule, employee_portal_visibility, closing_price_usd,
        withholding_cost, tax_calculation, tax_withholding, fx_settlement, tax_rule,
        cancellation_confirm_date, data_source, vesting_rule_name, vesting_start_date,
        vested_quantity, effective_vested_quantity, unvested_quantity, vested_cancelled_quantity,
        unvested_cancelled_quantity, exercised_quantity, pending_exercise_quantity,
        outstanding_quantity, sellable_quantity, related_sale_order_number, agreement_info, raw_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33::jsonb
      )`,
      [
        futuSourceFileId,
        employeeId,
        grantNumber,
        text(row['激励类型']) ?? '',
        text(row['授予日期']),
        parseEsopNumber(row['授予数量'], '授予数量'),
        parseEsopNumber(row['授予价(USD)'], '授予价(USD)'),
        text(row['失效日期']),
        text(row['所属计划']),
        text(row['条件规则']),
        text(row['员工端']),
        parseEsopNumber(row['登记日收盘价(USD)'], '登记日收盘价(USD)'),
        text(row['代扣成本']),
        text(row['代算税款']),
        text(row['代扣税款']),
        text(row['授予统一结汇']),
        text(row['授予计税规则']),
        text(row['确认取消日期']),
        text(row['数据来源']),
        text(row['归属规则名称']),
        text(row['归属起算日期']),
        parseEsopNumber(row['已归属'], '已归属'),
        parseEsopNumber(row['有效已归属'], '有效已归属'),
        parseEsopNumber(row['待归属'], '待归属'),
        parseEsopNumber(row['已归属取消'], '已归属取消'),
        parseEsopNumber(row['待归属取消'], '待归属取消'),
        parseEsopNumber(row['已行权'], '已行权'),
        parseEsopNumber(row['待行权'], '待行权'),
        parseEsopNumber(row.Outstanding, 'Outstanding'),
        parseEsopNumber(row['可出售数量'], '可出售数量'),
        text(row['关联出售订单编号']),
        text(row['协议信息']),
        JSON.stringify(row),
      ],
    );
    rowsWritten += 1;
  }

  for (const row of input.input2.rows) {
    const employeeGrantNumber = text(row['Employee Grant Number']);
    if (!employeeGrantNumber) continue;
    await client.execute(
      `insert into shareworks_grants (
        source_file_id, cost_center, participant_type, employee_number, last_name, first_name, middle_name,
        plan_name, grant_name, grant_type, employee_grant_number, grant_date,
        vesting_start_date, service_start_date, original_vesting_start_date, expire_date,
        participant_expire_date, earliest_expire_cancel_date, latest_expire_cancel_date,
        shares_granted, exercise_price_per_share, vesting_schedule, early_exercise_allowed,
        shares_vested, shares_unvested, shares_exercised_released, shares_subject_to_repurchase,
        shares_cancelled_expired, shares_outstanding, outstanding_unvested,
        outstanding_vested_exercisable, raw_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32::jsonb
      )`,
      [
        shareworksSourceFileId,
        text(row['Cost Center']),
        text(row['Participant Type @ Report Date']),
        text(row['Employee Number']),
        text(row['Last Name']),
        text(row['First Name']),
        text(row['Middle Name']),
        text(row['Plan Name']),
        text(row['Grant Name']),
        text(row['Grant Type']),
        employeeGrantNumber,
        parseEsopDateText(row['Grant Date']),
        parseEsopDateText(row['Vesting Start Date']),
        parseEsopDateText(row['Service Start Date']),
        parseEsopDateText(row['Original VCD (migrated grants)']),
        parseEsopDateText(row['Expire Date']),
        parseEsopDateText(row['Expire Date (participant view)']),
        parseEsopDateText(row['Earliest Expire Cancel Date']),
        parseEsopDateText(row['Latest Expire Cancel Date']),
        parseEsopNumber(row['No. of Shares Granted'], 'No. of Shares Granted'),
        parseEsopNumber(row['Exercise Price per Share'], 'Exercise Price per Share'),
        text(row['Vesting Schedule']),
        text(row['Early Exercise Allowed']),
        parseEsopNumber(row['No. of Shares Vested'], 'No. of Shares Vested'),
        parseEsopNumber(row['No. of Shares Unvested'], 'No. of Shares Unvested'),
        parseEsopNumber(row['Shares Exercised / Released'], 'Shares Exercised / Released'),
        parseEsopNumber(row['Shares Subject To Repurchase'], 'Shares Subject To Repurchase'),
        parseEsopNumber(row['Shares Cancelled/Expired'], 'Shares Cancelled/Expired'),
        parseEsopNumber(row['Shares Outstanding'], 'Shares Outstanding'),
        parseEsopNumber(row['Outstanding Unvested'], 'Outstanding Unvested'),
        parseEsopNumber(row['Outstanding Vested/Exercisable'], 'Outstanding Vested/Exercisable'),
        JSON.stringify(row),
      ],
    );
    const employeeNumber = text(row['Employee Number']);
    if (employeeNumber) {
      await upsertEmployeeByEmployeeId(employeeStore, {
        employeeId: employeeNumber,
        source: 'shareworks',
        name: assembleShareworksName(text(row['Last Name']), text(row['First Name']), text(row['Middle Name'])) || employeeNumber,
        hasFileEvidence: true,
      });
    }
    rowsWritten += 1;
  }
  return rowsWritten;
}

async function persistExercises(client: DbClient, input: EsopPagePersistInput): Promise<number> {
  const sourceFileId = input.sourceFileIds.futu_exercises ?? null;
  await client.execute('delete from exercise_records');
  let rowsWritten = 0;
  for (const row of input.input1.rows) {
    const employeeNumber = text(row['Employee No.']);
    if (!employeeNumber || employeeNumber === '员工编号') continue;
    await client.execute(
      `insert into exercise_records (
        source_file_id, name, employee_number, futubull_id, user_id, grant_number,
        grant_date, grant_price_usd, exercise_date, ordered_quantity, exercised_quantity,
        exercise_cost_usd, deduction_selling_quantity, dealt_quantity, raw_json
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15::jsonb)`,
      [
        sourceFileId,
        text(row.Name) ?? '',
        employeeNumber,
        text(row['Futubull ID']) ?? '',
        text(row['User ID']) ?? '',
        text(row['Grant No.']) ?? '',
        text(row['Grant Date']) ?? '',
        parseEsopNumber(row['Grant Price(USD)'], 'Grant Price(USD)', false),
        text(row['Exercise Date']) ?? '',
        parseEsopNumber(row['Ordered Qty'], 'Ordered Qty', false),
        parseEsopNumber(row['Exercised Qty'], 'Exercised Qty', false),
        parseEsopNumber(row['Exercise Cost(USD)'], 'Exercise Cost(USD)', false),
        parseEsopNumber(row['Deduction/Selling Qty.'], 'Deduction/Selling Qty.', false),
        parseEsopNumber(row['Dealt Qty.'], 'Dealt Qty.', false),
        JSON.stringify(row),
      ],
    );
    rowsWritten += 1;
  }
  return rowsWritten;
}

async function persistSoldShares(client: DbClient, input: EsopPagePersistInput): Promise<number> {
  const sourceFileId = input.sourceFileIds.futu_sold_shares ?? null;
  await client.execute('delete from sold_shares');
  let rowsWritten = 0;
  for (const row of input.input1.rows) {
    const employeeNumber = text(row['工号']);
    if (!employeeNumber) continue;
    const numericColumns = [
      ['出售总数量', 'sold_quantity'],
      ['成交总数量', 'dealt_quantity'],
      ['成交总金额（美元）', 'deal_amount_usd'],
      ['财产转让所得总应税收入（美元）', 'taxable_income_usd'],
      ['财产转让所得总应纳税额（美元）', 'tax_payable_usd'],
      ['交易总费用（美元）', 'transaction_fees_usd'],
      ['成交净值（美元）', 'net_deal_value_usd'],
      ['授予成本（美元）', 'grant_cost_usd'],
      ['行权/归属手续费（美元）', 'exercise_vesting_fee_usd'],
      ['本期合计代扣税额（美元）', 'withholding_tax_usd'],
      ['本期合计代扣税额（人民币）', 'withholding_tax_cny'],
      ['现金净收益(美元)', 'cash_net_proceeds_usd'],
    ] as const;
    const numericValues = numericColumns.map(([header]) => parseEsopNumber(row[header], header, false));
    await client.execute(
      `insert into sold_shares (
        source_file_id, name, employee_number, futubull_id, user_id, employment_status,
        related_party_identity, capital_gains_tax_visibility, sold_quantity, dealt_quantity,
        deal_amount_usd, taxable_income_usd, tax_payable_usd, transaction_fees_usd,
        net_deal_value_usd, grant_cost_usd, exercise_vesting_fee_usd, withholding_tax_usd,
        withholding_tax_cny, cash_net_proceeds_usd, raw_json
      ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21::jsonb)`,
      [
        sourceFileId,
        text(row['姓名']) ?? '',
        employeeNumber,
        text(row['牛牛号']) ?? '',
        text(row['用户ID']) ?? '',
        text(row['在职状态']) ?? '',
        text(row['关联人士身份']) ?? '',
        text(row['财产转让所得税']) ?? '',
        ...numericValues,
        JSON.stringify(row),
      ],
    );
    rowsWritten += 1;
  }
  return rowsWritten;
}

async function persistTransferPlan(client: DbClient, input: EsopPagePersistInput): Promise<number> {
  const sourceFileId = input.sourceFileIds.transfer_plan ?? null;
  const totalRows = input.input1.rows.filter((row) => text(row['行标签']) === '总计');
  if (totalRows.length < 2) throw new Error('Transfer workflow requires source and adjusted 总计 rows');
  const sourceTotal = totalRows[0] as Record<string, unknown>;
  const adjustedTotal = totalRows[1] as Record<string, unknown>;
  const periods = input.input1.columns.filter((column) => /^\d{4}-\d{2}$/.test(column));
  if (!periods.length) throw new Error('Transfer workflow did not find monthly period columns');

  for (const [sortOrder, period] of periods.entries()) {
    const inTotal = parseEsopNumber(sourceTotal[period], `${period} source total`, false) as number;
    const transferToFutu = parseEsopNumber(adjustedTotal[period], `${period} adjusted total`, false) as number;
    const sourceCancelled = transferToFutu - inTotal;
    await client.execute(
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
      [sourceFileId, period, inTotal, sourceCancelled, sortOrder, JSON.stringify({ period, inTotal, sourceCancelled, transferToFutu })],
    );
  }
  await client.execute('delete from transfer_plan_periods where not (period = any($1::text[]))', [periods]);
  return periods.length;
}

export async function persistEsopPage(db: AppDb, input: EsopPagePersistInput): Promise<EsopPagePersistResult> {
  const rowsWritten = await db.transaction(async (client) => {
    if (input.pageKey === 'grant-record') return persistGrantRecords(client, input);
    if (input.pageKey === 'exercise-record') return persistExercises(client, input);
    if (input.pageKey === 'sold-shares') return persistSoldShares(client, input);
    if (input.pageKey === 'transfer-plan') return persistTransferPlan(client, input);
    throw new Error(`Unsupported ESOP page workflow: ${String(input.pageKey)}`);
  });
  return { pageKey: input.pageKey, rowsWritten };
}
