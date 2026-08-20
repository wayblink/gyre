import { Pool } from 'pg';

/**
 * One-shot: inject monthly input-source rendering metadata into the DB workflow
 * `gyre-captable-summary-v2` at runtime_params_schema.fileRefs.properties.<sourceKey>.
 *
 * Workflow definitions are DB-owned (see CLAUDE.md). The monthly page's source list is derived
 * from this schema (server monthlySourcesFromSchema); jsonb does not preserve key order, so each
 * source carries an explicit `order`. Re-export the JSON seed after running:
 *   npx tsx scripts/inject-monthly-source-meta.ts && npx tsx scripts/export-workflows.ts
 */

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://captable:captable@127.0.0.1:55432/captable';

const FILE_REFS_PROPERTIES: Record<string, unknown> = {
  base_control_book: {
    type: 'object',
    label: 'Control Book Summary',
    description: '上月完整 EQ Control Book，作为增量合并的 base；输出可作为下月 base 链式使用。',
    required: true,
    order: 1,
    sourceGroup: 'shareworks',
    taskId: 'invoke_control_book_merge',
    defaultSheetName: 'EQ Control Book',
    allowSheetNameOverride: true,
    properties: { sheet: { type: 'string', label: 'Base sheet' } },
  },
  incremental_control_book: {
    type: 'object',
    label: 'Control Book monthly detail',
    description: '本月下载的增量 Control Book 明细，与 base 按交易自然键幂等合并。',
    required: true,
    order: 2,
    sourceGroup: 'shareworks',
    taskId: 'invoke_control_book_merge',
    defaultSheetName: '27591',
    allowSheetNameOverride: true,
    properties: { sheet: { type: 'string', label: 'Increment sheet' } },
  },
  previous_capitalization_summary: {
    type: 'object',
    label: 'Previous Capitalization Summary',
    description:
      '由业务逻辑自动引入：触发时若存在上一个月的 Capitalization Summary 输出，则自动作为本源用于校验本月 EQ Control Book 的 Last Month；无则置空跳过。UI 不暴露该源。',
    required: false,
    hidden: true,
    order: 3,
    sourceGroup: 'shareworks',
    taskId: 'extract_previous_capitalization_summary',
    defaultSheetName: 'Capitalization Summary',
  },
  futu_exercises: {
    type: 'object',
    label: 'Futu BCI Exercises',
    description: '用于汇总 Futu exercises to date 的已行权数量。',
    required: true,
    order: 4,
    sourceGroup: 'futu',
    taskId: 'extract_futu_exercises',
    defaultSheetName: 'Futu BCI Exercises to Date',
  },
  option_plans_summary: {
    type: 'object',
    label: 'Gyre Option Plans Summary SL',
    description: '用于读取独立 Gyre_Option_Plans_Summary_SL workbook 并汇总各计划 outstanding 与 available shares。',
    required: true,
    order: 5,
    sourceGroup: 'shareworks',
    taskId: 'invoke_option_plans_summary',
    defaultSheetName: '!Option Plans Summary (Post-Gyr',
    allowSheetNameOverride: true,
    properties: { sheet: { type: 'string', label: 'Sheet' } },
  },
  bc_subplan_transfer: {
    type: 'object',
    label: '2025 BC Subplan Transfer',
    description: '必选：用户明确选择合并表或单独 workbook，并指定包含 2025 BC Subplan transfer/vesting 数据的 Sheet。',
    required: true,
    order: 6,
    sourceGroup: 'shareworks',
    taskId: 'extract_bc_subplan_transfer',
    defaultSheetName: 'Vesting Schedule',
    allowSheetNameOverride: true,
    properties: { sheet: { type: 'string', label: 'Sheet' } },
  },
  options_os_detail_by_plan: {
    type: 'object',
    label: 'Options OS Detail by Plan',
    description:
      '设计文档中的 Options_OS_Detail_by_Plan：Shareworks 按计划/员工维度的 options outstanding 明细，用作可选复核输入。',
    required: false,
    hidden: true,
    order: 7,
    sourceGroup: 'shareworks',
    taskId: 'extract_options_os_detail_by_plan',
    defaultSheetName: 'Options OS Detail',
  },
};

async function main(): Promise<void> {
  const pool = new Pool({ connectionString });
  try {
    const result = await pool.query(
      `update workflow_definitions
          set runtime_params_schema_json = jsonb_set(runtime_params_schema_json, '{fileRefs,properties}', $1::jsonb),
              updated_at = current_timestamp
        where code = 'gyre-captable-summary-v2'`,
      [JSON.stringify(FILE_REFS_PROPERTIES)],
    );
    console.log(`injected monthly source metadata into gyre-captable-summary-v2 (${result.rowCount} row)`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
