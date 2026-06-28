import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import XLSX from 'xlsx';
import { config } from './config.js';
import type { AppDb, DbClient } from './db.js';
import { buildMonthlyWorkflowSeedDefinition } from './monthlyRun/workflowDefinition.js';
import { workflowOperatorDefinitions } from './workflow/operators/registry.js';

type PrototypeData = {
  employeeMappings: Array<Record<string, unknown>>;
  planManagements: Array<Record<string, unknown>>;
  shareholders: Array<Record<string, unknown>>;
  updatePlans: Array<Record<string, unknown>>;
  fileCheckLists: Record<string, unknown>;
  capTableData: Record<string, Record<string, unknown>>;
  linkModalData: Record<string, Record<string, unknown>>;
  getFileCheckList: (planId: number) => {
    fixedValues: Array<Record<string, unknown>>;
    shareworksData: Array<Record<string, unknown>>;
    futuData: Array<Record<string, unknown>>;
  };
};

function loadPrototypeData(): PrototypeData {
  const dataPath = path.join(config.rootDir, 'js', 'data.js');
  const source = fs.readFileSync(dataPath, 'utf8');
  return vm.runInNewContext(
    `${source}
({
  employeeMappings,
  planManagements,
  shareholders,
  updatePlans,
  fileCheckLists,
  capTableData,
  linkModalData,
  getFileCheckList
});`,
    {},
    { filename: dataPath },
  ) as PrototypeData;
}

function eomForMonth(monthKey: string): string {
  const [year, month] = monthKey.split('-').map(Number);
  return `${year}/${month}/${new Date(year, month, 0).getDate()}`;
}

function metricKey(prefix: string, label: unknown, index: number): string {
  return `${prefix}_${String(label || `row_${index + 1}`)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')}`;
}

function asNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (value === '--') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '--') return null;
  return text;
}

type GrantSheetRow = Record<string, unknown>;
type GrantWorkbookData = {
  employees: Array<{ employeeNumber: string; employeeName: string; userId: string | null }>;
  grants: GrantSheetRow[];
  vestings: Array<Record<string, unknown>>;
  agreements: Array<Record<string, unknown>>;
};

function loadGrantWorkbook(): GrantWorkbookData {
  const workbookPath = path.join(config.rootDir, 'database', 'Gyre Therapeutics授予数据导出报表20260622.xlsx');
  const workbook = XLSX.readFile(workbookPath);
  const grantRows = XLSX.utils.sheet_to_json<GrantSheetRow>(workbook.Sheets['授予记录'], { defval: '' });
  const vestingRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['归属记录'], { defval: '' });
  const agreementRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets['协议详情'], { defval: '' });

  const employees = new Map<string, { employeeNumber: string; employeeName: string; userId: string | null }>();
  for (const row of grantRows) {
    const employeeNumber = asText(row['工号']);
    if (!employeeNumber) continue;
    employees.set(employeeNumber, {
      employeeNumber,
      employeeName: asText(row['姓名']) ?? employeeNumber,
      userId: asText(row['用户ID']),
    });
  }

  return {
    employees: [...employees.values()],
    grants: grantRows,
    vestings: vestingRows,
    agreements: agreementRows,
  };
}

async function insertMetric(
  db: DbClient,
  updatePlanId: number,
  sourceGroup: string,
  metric: Record<string, unknown>,
  index: number,
) {
  const label = String(metric.item || metric.metric || metric.fileName || `Row ${index + 1}`);
  await db.execute(
    `
    insert into source_metrics (
      update_plan_id, source_group, metric_key, label, required, uploaded_file,
      raw_value, normalized_value, status, editable, sort_order
    ) values ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11)
  `,
    [
      updatePlanId,
      sourceGroup,
      metricKey(sourceGroup, label, index),
      label,
      String(metric.isRequired ?? ''),
      String(metric.uploadedFile ?? ''),
      JSON.stringify(metric),
      asNumber(metric.value),
      String(metric.status ?? ''),
      metric.action === 'edit',
      index,
    ],
  );
}

async function seedMonths(db: DbClient, data: PrototypeData): Promise<Map<string, number>> {
  const monthKeys = new Set<string>([
    ...Object.keys(data.capTableData),
    ...data.updatePlans.map((plan) => String(plan.month)),
  ]);
  const idByMonth = new Map<string, number>();

  for (const monthKey of [...monthKeys].sort()) {
    const monthData = data.capTableData[monthKey];
    const row = await db.queryOne<{ id: number }>(
      'insert into months (month_key, eom_date, status) values ($1, $2, $3) returning id',
      [monthKey, String(monthData?.eomDate ?? eomForMonth(monthKey)), 'open'],
    );
    if (row) idByMonth.set(monthKey, Number(row.id));
  }

  return idByMonth;
}

async function seedUpdatePlans(db: DbClient, data: PrototypeData, idByMonth: Map<string, number>): Promise<Map<number, number>> {
  const planIdMap = new Map<number, number>();

  for (const plan of data.updatePlans) {
    const sourceId = Number(plan.id);
    const monthKey = String(plan.month);
    const row = await db.queryOne<{ id: number }>(
      `
      insert into update_plans (month_id, operation_time, operator, status, remark)
      values ($1, $2, $3, $4, $5)
      returning id
    `,
      [
        idByMonth.get(monthKey),
        String(plan.operationTime),
        String(plan.operator),
        String(plan.status),
        String(plan.remark ?? ''),
      ],
    );
    if (!row) continue;

    const newPlanId = Number(row.id);
    planIdMap.set(sourceId, newPlanId);

    const checklist = data.getFileCheckList(sourceId);
    for (const [index, item] of checklist.fixedValues.entries()) await insertMetric(db, newPlanId, 'fixed', item, index);
    for (const [index, item] of checklist.shareworksData.entries()) await insertMetric(db, newPlanId, 'shareworks', item, index);
    for (const [index, item] of checklist.futuData.entries()) await insertMetric(db, newPlanId, 'futu', item, index);
  }

  return planIdMap;
}

async function seedSnapshotsAndDetails(db: DbClient, data: PrototypeData, idByMonth: Map<string, number>) {
  for (const [monthKey, monthData] of Object.entries(data.capTableData)) {
    const monthId = idByMonth.get(monthKey);
    if (!monthId) continue;

    const summary = {
      month: monthKey,
      eomDate: monthData.eomDate,
      reconciliation: monthData.reconciliation,
      capitalization: monthData.capitalization,
      totalFullyDiluted: monthData.totalFullyDiluted,
    };
    await db.execute(
      `
      insert into calculation_snapshots (month_id, status, generated_by, summary_json, formula_trace_json)
      values ($1, 'current', 'seed', $2::jsonb, $3::jsonb)
    `,
      [
        monthId,
        JSON.stringify(summary),
        JSON.stringify({
          source: 'PM prototype seed',
          unresolvedInputs: [
            '2025 BC Subplan transferred: workbook summary 695164 vs row-sum 695165',
            '6/30 report month-end behavior requires product decision',
            'Series B preferred not converted to common needs cap table treatment',
          ],
        }),
      ],
    );

    const notes = (monthData.notes ?? []) as Array<Record<string, unknown>>;
    for (const note of notes) {
      await db.execute('insert into notes (month_id, content, created_at) values ($1, $2, $3)', [
        monthId,
        String(note.content),
        String(note.time ?? new Date().toISOString()),
      ]);
    }

    const holdings = (monthData.holdings ?? []) as Array<Record<string, unknown>>;
    for (const item of holdings) {
      await db.execute(
        `
        insert into holdings (
          month_id, cost_center, participant_type, employee_number, last_name, first_name, middle_name,
          plan_name, grant_name, grant_type, employee_grant_number, grant_date, vesting_start_date,
          service_start_date, original_vcd, expire_date, expire_date_participant, earliest_expire_cancel,
          latest_expire_cancel, shares_granted, exercise_price, vesting_schedule, early_exercise,
          shares_vested, shares_unvested, shares_exercised, shares_repurchase, shares_cancelled,
          shares_outstanding, outstanding_unvested, outstanding_vested, raw_json
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
          $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32::jsonb
        )
      `,
        [
          monthId,
          item.costCenter ?? null,
          item.participantType ?? null,
          item.employeeNumber ?? null,
          item.lastName ?? null,
          item.firstName ?? null,
          item.middleName ?? null,
          item.planName ?? null,
          item.grantName ?? null,
          item.grantType ?? null,
          item.employeeGrantNumber ?? null,
          item.grantDate ?? null,
          item.vestingStartDate ?? null,
          item.serviceStartDate ?? null,
          item.originalVCD ?? null,
          item.expireDate ?? null,
          item.expireDateParticipant ?? null,
          item.earliestExpireCancel ?? null,
          item.latestExpireCancel ?? null,
          asNumber(item.sharesGranted),
          asNumber(item.exercisePrice),
          item.vestingSchedule ?? null,
          item.earlyExercise ?? null,
          asNumber(item.sharesVested),
          asNumber(item.sharesUnvested),
          asNumber(item.sharesExercised),
          asNumber(item.sharesRepurchase),
          asNumber(item.sharesCancelled),
          asNumber(item.sharesOutstanding),
          asNumber(item.outstandingUnvested),
          asNumber(item.outstandingVested),
          JSON.stringify(item),
        ],
      );
    }
  }

  for (const [key, detail] of Object.entries(data.linkModalData)) {
    await db.execute(
      `
      insert into link_details (detail_key, title, columns_json, rows_json, summary_json)
      values ($1, $2, $3::jsonb, $4::jsonb, $5::jsonb)
    `,
      [
        key,
        String(detail.title),
        JSON.stringify(detail.columns ?? []),
        JSON.stringify(detail.rows ?? []),
        detail.summary ? JSON.stringify(detail.summary) : null,
      ],
    );
  }
}

async function seedSettings(db: DbClient, data: PrototypeData) {
  for (const item of data.employeeMappings) {
    await db.execute(
      'insert into employee_mappings (display_name, employee_id, futu_id, shareworks_id) values ($1, $2, $3, $4)',
      [item.name, item.empId, item.futuId ?? '', item.shareworksId ?? ''],
    );
  }

  for (const item of data.planManagements) {
    await db.execute(
      'insert into tracked_plans (plan_name, description, status, created_at) values ($1, $2, $3, $4)',
      [item.name, '', item.status, item.createTime],
    );
  }

  for (const item of data.shareholders) {
    await db.execute('insert into shareholder_tags (name, identity, tracked) values ($1, $2, $3)', [
      item.name,
      item.identity,
      Boolean(item.track),
    ]);
  }
}

async function seedGrantWorkbookData(db: DbClient) {
  const workbookData = loadGrantWorkbook();
  const employeeIdByNumber = new Map<string, number>();
  const grantIdByNumber = new Map<string, number>();

  for (const employee of workbookData.employees) {
    const row = await db.queryOne<{ id: number }>(
      `
      insert into employees (employee_number, employee_name, user_id)
      values ($1, $2, $3)
      returning id
    `,
      [employee.employeeNumber, employee.employeeName, employee.userId],
    );
    if (row) employeeIdByNumber.set(employee.employeeNumber, Number(row.id));
  }

  for (const item of workbookData.grants) {
    const employeeNumber = asText(item['工号']);
    const grantNumber = asText(item['授予编号']);
    if (!employeeNumber || !grantNumber) continue;
    const employeeId = employeeIdByNumber.get(employeeNumber);
    if (!employeeId) continue;

    const row = await db.queryOne<{ id: number }>(
      `
      insert into equity_grants (
        employee_id, grant_number, incentive_type, grant_date, grant_quantity, grant_price_usd,
        expire_date, plan_name, condition_rule, employee_portal_visibility, closing_price_usd,
        withholding_cost, tax_calculation, tax_withholding, fx_settlement, tax_rule,
        cancellation_confirm_date, data_source, vesting_rule_name, vesting_start_date,
        vested_quantity, effective_vested_quantity, unvested_quantity, vested_cancelled_quantity,
        unvested_cancelled_quantity, exercised_quantity, pending_exercise_quantity,
        outstanding_quantity, sellable_quantity, related_sale_order_number, agreement_info, raw_json
      ) values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
        $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32::jsonb
      )
      returning id
    `,
      [
        employeeId,
        grantNumber,
        asText(item['激励类型']) ?? '',
        asText(item['授予日期']),
        asNumber(item['授予数量']),
        asNumber(item['授予价(USD)']),
        asText(item['失效日期']),
        asText(item['所属计划']),
        asText(item['条件规则']),
        asText(item['员工端']),
        asNumber(item['登记日收盘价(USD)']),
        asText(item['代扣成本']),
        asText(item['代算税款']),
        asText(item['代扣税款']),
        asText(item['授予统一结汇']),
        asText(item['授予计税规则']),
        asText(item['确认取消日期']),
        asText(item['数据来源']),
        asText(item['归属规则名称']),
        asText(item['归属起算日期']),
        asNumber(item['已归属']),
        asNumber(item['有效已归属']),
        asNumber(item['待归属']),
        asNumber(item['已归属取消']),
        asNumber(item['待归属取消']),
        asNumber(item['已行权']),
        asNumber(item['待行权']),
        asNumber(item['Outstanding']),
        asNumber(item['可出售数量']),
        asText(item['关联出售订单编号']),
        asText(item['协议信息']),
        JSON.stringify(item),
      ],
    );
    if (row) grantIdByNumber.set(grantNumber, Number(row.id));
  }

  for (const item of workbookData.vestings) {
    const grantNumber = asText(item['授予编号']);
    const employeeNumber = asText(item['工号']);
    const vestingDate = asText(item['归属日期']);
    const vestingQuantity = asNumber(item['归属数量']);
    if (!grantNumber || !employeeNumber || !vestingDate || vestingQuantity === null) continue;
    const grantId = grantIdByNumber.get(grantNumber);
    if (!grantId) continue;
    await db.execute(
      `
      insert into grant_vestings (grant_id, employee_number, grant_number, vesting_date, vesting_quantity, raw_json)
      values ($1, $2, $3, $4, $5, $6::jsonb)
    `,
      [grantId, employeeNumber, grantNumber, vestingDate, vestingQuantity, JSON.stringify(item)],
    );
  }

  for (const item of workbookData.agreements) {
    const grantNumber = asText(item['授予编号']);
    const agreementNumber = asText(item['协议编号']);
    if (!grantNumber || !agreementNumber) continue;
    const grantId = grantIdByNumber.get(grantNumber);
    if (!grantId) continue;
    await db.execute(
      `
      insert into grant_agreements (
        grant_id, grant_number, agreement_number, send_status, employee_sign_status,
        company_sign_status, other_sign_status, raw_json
      ) values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
    `,
      [
        grantId,
        grantNumber,
        agreementNumber,
        asText(item['发送状态']),
        asText(item['员工签署状态']),
        asText(item['公司签署状态']),
        asText(item['其他签署方签署状态']),
        JSON.stringify(item),
      ],
    );
  }
}

async function seedParametersAndDecisions(db: DbClient, firstPlanId: number | undefined) {
  const parameters: Array<[string, string, number]> = [
    ['cullgen_common_stock', 'Cullgen common stock', 14_450_527],
    ['gyre_2023_china_subplan_total', 'Gyre 2023 China SubPlan Total', 7_815_396],
    ['warrants_convertible_preferred', 'Warrants for Convertible Preferred Stock', 540_666],
    ['options_outstanding_cullgen', 'Options Outstanding- Cullgen', 4_156_815],
    ['options_available_cullgen', 'Options Available- Cullgen', 10_994],
  ];
  for (const [key, label, value] of parameters) {
    await db.execute(
      'insert into global_parameters (key, label, value, effective_from, editable) values ($1, $2, $3, $4, true)',
      [key, label, value, '2026-05'],
    );
  }

  if (!firstPlanId) return;

  const decisions = [
    {
      key: '2025_bc_subplan_transferred',
      candidates: [
        { value: 695_164, source: 'Workbook summary / current PM prototype' },
        { value: 695_165, source: 'EQ Control Book row sum' },
      ],
      selected: 695_164,
      reason: 'Preserve current prototype value while marking one-share source conflict for confirmation.',
    },
    {
      key: 'options_available_gyre_label',
      candidates: [{ value: 'Options Available- Gyre', source: 'Workbook D71 interpretation' }],
      selected: 'Options Available- Gyre',
      reason: 'PDF wording likely labels D71 as outstanding, but workbook value aligns to available options.',
    },
    {
      key: 'gyre_2025_bc_subplan_cancelled_source',
      candidates: [{ value: -28_170, source: 'Futu option plans summary include cancel' }],
      selected: -28_170,
      reason: 'Source file and extraction rule still need business confirmation.',
    },
    {
      key: 'series_b_preferred_not_converted',
      candidates: [{ value: 'add_to_cap_table', source: 'Excel clarification comment' }],
      selected: null,
      reason: 'Need product/accounting decision for how Series B preferred not converted to common appears in summary.',
    },
    {
      key: 'report_month_end_behavior',
      candidates: [{ value: 'update_to_2026_06_30', source: 'Excel comment: Update to 6/30?' }],
      selected: null,
      reason: 'Need decision on whether report month is fixed by selected month or latest available workbook date.',
    },
    {
      key: 'han_tracking',
      candidates: [{ value: 'do_not_track_han', source: 'Excel clarification comment' }],
      selected: 'do_not_track_han',
      reason: 'Seeded as rule candidate; confirm whether this is a shareholder exclusion or employee mapping exclusion.',
    },
    {
      key: 'employee_identity_source',
      candidates: [
        { value: 'shareworks', source: 'Shareworks employee/grant identifiers' },
        { value: 'futu', source: 'Futu user/futubull identifiers' },
        { value: 'manual_mapping', source: 'Settings employee mapping table' },
      ],
      selected: 'manual_mapping',
      reason: 'Initial version stores cross-system mapping explicitly until source-of-truth is decided.',
    },
  ];

  for (const decision of decisions) {
    await db.execute(
      `
      insert into manual_decisions (
        update_plan_id, metric_key, candidates_json, selected_value, reason, decided_by, decided_at
      ) values ($1, $2, $3::jsonb, $4, $5, $6, current_timestamp)
    `,
      [
        firstPlanId,
        decision.key,
        JSON.stringify(decision.candidates),
        decision.selected === null ? null : String(decision.selected),
        decision.reason,
        'seed',
      ],
    );
  }
}

async function seedWorkflowData(db: DbClient) {
  const operatorCodes = workflowOperatorDefinitions.map((operator) => `'${operator.code}'`).join(', ');
  await db.execute(`delete from workflow_operators where code not in (${operatorCodes})`);
  await db.execute(
    `update workflow_definitions
        set code = $2
      where code = $1`,
    ['captable-import', 'default-workflow'],
  );

  for (const operator of workflowOperatorDefinitions) {
    await db.execute(
      `insert into workflow_operators (
        code, name, version, category, description, input_slots_json, output_slots_json, params_schema_json
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      on conflict (code, version) do update set
        name = excluded.name,
        category = excluded.category,
        description = excluded.description,
        input_slots_json = excluded.input_slots_json,
        output_slots_json = excluded.output_slots_json,
        params_schema_json = excluded.params_schema_json,
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
      ],
    );
  }

  const workflowTasks = [
    {
      id: 'task_extract_range',
      name: 'Extract Excel Range',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '选择文件、Sheet 与范围，提取通用 dataframe 数据。',
      x: 48,
      y: 48,
      params: {
        fileId: null,
        sheetName: 'Detailed Cap Table',
        range: 'A1:Z50',
        headerRow: 1,
      },
      inputs: {},
    },
    {
      id: 'task_sql_compute',
      name: 'Compute SQL',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '对上游 dataframe 执行 SQL 计算。',
      x: 360,
      y: 48,
      params: {
        sql: 'select count(*) as total_rows from {source}',
        tableBindings: [{ tableName: 'source', inputSlot: 'source_input' }],
      },
      inputs: {
        source_input: { from: 'task_extract_range', slot: 'dataframe' },
      },
    },
  ];

  await db.execute(
    `insert into workflow_definitions (code, name, description, status, version, tasks_json)
     values ($1, $2, $3, $4, $5, $6::jsonb)
     on conflict (code) do nothing`,
    [
      'default-workflow',
      'Cap Table Import Flow',
      '通用 Excel 提取与 SQL 计算工作流，支持基于文件、Sheet 和范围输出 dataframe，并在后续节点上执行 SQL。',
      'active',
      1,
      JSON.stringify(workflowTasks),
    ],
  );

  await parameterizeMonthlyWorkflow(db);
}

async function parameterizeMonthlyWorkflow(db: DbClient): Promise<void> {
  const workflow = buildMonthlyWorkflowSeedDefinition();

  await db.execute(
    `insert into workflow_definitions (
        code, name, description, status, version, tasks_json,
        runtime_params_schema_json, runtime_params_defaults_json
      ) values ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      on conflict (code) do update set
            name = excluded.name,
            description = excluded.description,
            status = excluded.status,
            version = excluded.version,
            tasks_json = excluded.tasks_json,
            runtime_params_schema_json = excluded.runtime_params_schema_json,
            runtime_params_defaults_json = excluded.runtime_params_defaults_json,
            updated_at = current_timestamp
      where workflow_definitions.code = $1`,
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

export async function seedDatabase(db: AppDb) {
  const existing = await db.queryOne<{ count: string }>('select count(*)::text as count from months');
  if (Number(existing?.count ?? 0) > 0) {
    await db.transaction(async (client) => {
      await seedWorkflowData(client);
    });
    return;
  }

  const data = loadPrototypeData();
  await db.transaction(async (client) => {
    const idByMonth = await seedMonths(client, data);
    const planIdMap = await seedUpdatePlans(client, data, idByMonth);
    await seedSnapshotsAndDetails(client, data, idByMonth);
    await seedSettings(client, data);
    await seedGrantWorkbookData(client);
    await seedParametersAndDecisions(client, planIdMap.get(1));
    await seedWorkflowData(client);
  });
}
