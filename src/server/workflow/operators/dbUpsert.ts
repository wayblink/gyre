import { defineWorkflowOperator, normalizeWorkflowTaskDependencies, requireInputDataFrame } from './types.js';
import type { WorkflowTaskPreviewResult } from '../../../shared/types.js';

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
}

export const dbUpsertOperator = defineWorkflowOperator({
  code: 'db.upsert',
  name: 'Upsert To Table / 写库',
  version: '1.0.0',
  category: 'Database',
  description: '通用写库算子：把上游 dataframe 按冲突键 UPSERT 进白名单业务表（employees）。',
  documentation: {
    usage:
      '把上游 dataframe 的行写入数据库表。表必须在白名单内，且冲突键上要有唯一约束。updateColumns 为空时命中冲突只跳过（INSERT-or-IGNORE），否则按冲突键更新（UPSERT）。预览不写库，仅显示将写入的行数。',
    steps: [
      '上游先用 union / sql.compute 把数据整理成「列名与目标表字段一致」的 dataframe。',
      '设置 table（目标表）、conflictColumns（唯一键，如 employee_id）。',
      '需要覆盖更新时把要更新的列填进 updateColumns；留空则命中冲突时跳过。',
      'columns 留空表示写入 dataframe 的全部列；也可只选子集。',
    ],
    example: `{
  "table": "employees",
  "columns": ["employee_id", "source", "employee_name"],
  "conflictColumns": ["employee_id"],
  "updateColumns": ["employee_name"]
}`,
  },
  inputSlots: [{ slot: 'input1', type: 'table', contentType: 'application/json', label: 'DataFrame', required: true }],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'Result' }],
  paramsSchema: {
    table: {
      type: 'string',
      label: '目标表',
      required: true,
      description: '写入的业务表，必须在服务端白名单内。',
      enum: ['employees'],
    },
    conflictColumns: {
      type: 'array',
      label: '冲突键（唯一列）',
      required: true,
      description: 'ON CONFLICT 用的唯一键列，目标表上必须有对应唯一约束/索引。',
      default: [],
    },
    updateColumns: {
      type: 'array',
      label: '冲突时更新列',
      required: false,
      description: '命中冲突时要覆盖更新的列；留空表示命中冲突时跳过（不更新）。',
      default: [],
    },
    columns: {
      type: 'array',
      label: '写入列',
      required: false,
      description: '要写入的列；留空表示写入 dataframe 的全部列。列名需与目标表字段一致。',
      default: [],
    },
  },
  normalizeTask(task) {
    task.inputs = {
      input1: {
        from: String(task.inputs?.input1?.from ?? '').trim(),
        slot: 'dataframe',
        guards: task.inputs?.input1?.guards,
      },
    };
    task.params.conflictColumns = toStringArray(task.params.conflictColumns);
    task.params.updateColumns = toStringArray(task.params.updateColumns);
    task.params.columns = toStringArray(task.params.columns);
    normalizeWorkflowTaskDependencies(task);
  },
  async execute(context) {
    const { task, runtime } = context;
    if (!runtime.upsertTableRows) {
      throw new Error('DB write is not available in this runtime');
    }
    const dataframe = await requireInputDataFrame(context, 'input1');
    const table = String(task.params.table ?? '').trim();
    if (!table) throw new Error(`Task ${task.name} requires a target table`);
    const conflictColumns = toStringArray(task.params.conflictColumns);
    const updateColumns = toStringArray(task.params.updateColumns);
    const selected = toStringArray(task.params.columns);
    const columns = selected.length ? selected : dataframe.columns;

    const { inserted, updated } = await runtime.upsertTableRows({
      table,
      columns,
      rows: dataframe.rows,
      conflictColumns,
      updateColumns,
    });

    return runtime.rowsToDataFrame(
      [{ table, inserted, updated, total: inserted + updated, skipped: dataframe.rows.length - inserted - updated }],
      { sheetName: task.name || 'Upsert Result', a1Range: '' },
    );
  },
  async preview(context): Promise<WorkflowTaskPreviewResult> {
    const { task, runtime } = context;
    const dataframe = await requireInputDataFrame(context, 'input1');
    const table = String(task.params.table ?? '').trim();
    const conflictColumns = toStringArray(task.params.conflictColumns);
    const updateColumns = toStringArray(task.params.updateColumns);
    // Preview must not write. Report the intended action only.
    return {
      kind: 'dataframe',
      dataFrame: runtime.rowsToDataFrame(
        [
          {
            table,
            rowsToWrite: dataframe.rows.length,
            conflictKey: conflictColumns.join(', '),
            onConflict: updateColumns.length ? `update: ${updateColumns.join(', ')}` : 'do nothing',
          },
        ],
        { sheetName: task.name || 'Upsert Plan', a1Range: '' },
      ),
    };
  },
});
