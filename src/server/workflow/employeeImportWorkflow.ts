import type {
  WorkflowRuntimeParameters,
  WorkflowRuntimeParametersSchema,
  WorkflowTask,
} from '../../shared/types.js';
import { deriveWorkflowRuntimeConfigFromTasks } from './runtimeParameterRequirements.js';

export const EMPLOYEE_IMPORT_WORKFLOW_CODE = 'employee-import';
export const EMPLOYEE_IMPORT_WORKFLOW_NAME = 'Employee Import / 员工归集';
export const EMPLOYEE_IMPORT_WORKFLOW_DESCRIPTION =
  '从 Futu 授予明细与 Shareworks 明细提取员工，各自规范成 (employee_id, source, employee_name) 后 union，再按 employee_id UPSERT 进 employees 表。换文件重跑即幂等重归集；跨来源同人由「关联」处理。';

// Futu 工号 → employee_id (upper+trim so it matches normalizeExternalNumber), source=futu.
// concat('', ...) stringifies numeric cells; coalesce guards nulls before trim.
const FUTU_TRANSFORM_SQL = `
select distinct
  upper(trim(concat('', coalesce([工号], '')))) as employee_id,
  'futu' as source,
  trim(concat('', coalesce([姓名], ''))) as employee_name,
  true as has_file_evidence
from {futu}
where trim(concat('', coalesce([工号], ''))) <> ''`;

// Shareworks employee number → employee_id, name assembled from last/first/middle.
const SHAREWORKS_TRANSFORM_SQL = `
select distinct
  upper(trim(concat('', coalesce([Employee Number], '')))) as employee_id,
  'shareworks' as source,
  trim(concat(coalesce([Last Name], ''), ' ', coalesce([First Name], ''), ' ', coalesce([Middle Name], ''))) as employee_name,
  true as has_file_evidence
from {sw}
where trim(concat('', coalesce([Employee Number], ''))) <> ''`;

const futuFileRef = {
  $fromRuntime: 'fileRefs.futu_grants',
  $type: 'object',
  $label: 'Futu 授予数据导出报表 workbook',
};
const shareworksFileRef = {
  $fromRuntime: 'fileRefs.shareworks',
  $type: 'object',
  $label: 'Shareworks Cap Table workbook',
};

export function buildEmployeeImportWorkflowTasks(): WorkflowTask[] {
  return [
    {
      id: 'extract_futu_grants',
      name: 'Extract Futu 授予记录',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '从 Futu 授予数据导出报表的「授予记录」sheet 提取明细（含 工号、姓名）。',
      x: 48,
      y: 48,
      params: {
        fileRef: futuFileRef,
        sheetName: '授予记录',
        range: 'A1:BZ',
        headerRow: 1,
        dropTrailingEmptyRows: true,
      },
      inputs: {},
      dependsOn: [],
    },
    {
      id: 'extract_shareworks',
      name: 'Extract Shareworks Options OS Detail',
      operatorCode: 'sheet.range.extract',
      operatorVersion: '1.0.0',
      description: '从 Shareworks Cap Table 的「Options OS Detail」sheet 提取明细（表头在第 2 行）。',
      x: 48,
      y: 260,
      params: {
        fileRef: shareworksFileRef,
        sheetName: 'Options OS Detail',
        range: 'A2:BZ',
        headerRow: 2,
        dropTrailingEmptyRows: true,
      },
      inputs: {},
      dependsOn: [],
    },
    {
      id: 'normalize_futu_employees',
      name: 'Normalize Futu Employees',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '把 Futu 明细去重规范成 (employee_id, source, employee_name)。',
      x: 400,
      y: 48,
      params: {
        sql: FUTU_TRANSFORM_SQL,
        tableBindings: [{ tableName: 'futu', inputSlot: 'input1' }],
      },
      inputs: { input1: { from: 'extract_futu_grants', slot: 'dataframe' } },
      dependsOn: [],
    },
    {
      id: 'normalize_shareworks_employees',
      name: 'Normalize Shareworks Employees',
      operatorCode: 'sql.compute',
      operatorVersion: '1.0.0',
      description: '把 Shareworks 明细去重规范成 (employee_id, source, employee_name)，姓名由 last/first/middle 拼成。',
      x: 400,
      y: 260,
      params: {
        sql: SHAREWORKS_TRANSFORM_SQL,
        tableBindings: [{ tableName: 'sw', inputSlot: 'input1' }],
      },
      inputs: { input1: { from: 'extract_shareworks', slot: 'dataframe' } },
      dependsOn: [],
    },
    {
      id: 'union_employees',
      name: 'Union Employees',
      operatorCode: 'dataframe.union',
      operatorVersion: '1.0.0',
      description: '把 Futu 与 Shareworks 员工按列名对齐后合并成一张待写入表。',
      x: 760,
      y: 154,
      params: { distinct: false },
      inputs: {
        input1: { from: 'normalize_futu_employees', slot: 'dataframe' },
        input2: { from: 'normalize_shareworks_employees', slot: 'dataframe' },
      },
      dependsOn: [],
    },
    {
      id: 'upsert_employees',
      name: 'Upsert Employees',
      operatorCode: 'db.upsert',
      operatorVersion: '1.0.0',
      description: '按 employee_id UPSERT 进 employees 表：已存在工号更新姓名/证据，新工号插入。',
      x: 1120,
      y: 154,
      params: {
        table: 'employees',
        columns: ['employee_id', 'source', 'employee_name', 'has_file_evidence'],
        conflictColumns: ['employee_id'],
        updateColumns: ['employee_name', 'has_file_evidence'],
      },
      inputs: { input1: { from: 'union_employees', slot: 'dataframe' } },
      dependsOn: [],
    },
  ];
}

export function buildEmployeeImportWorkflowSeedDefinition(): {
  code: string;
  name: string;
  description: string;
  status: 'active';
  version: number;
  tasks: WorkflowTask[];
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
} {
  const tasks = buildEmployeeImportWorkflowTasks();
  const runtimeConfig = deriveWorkflowRuntimeConfigFromTasks({
    tasks,
    runtimeParamsSchema: {},
    runtimeParamsDefaults: {},
  });
  return {
    code: EMPLOYEE_IMPORT_WORKFLOW_CODE,
    name: EMPLOYEE_IMPORT_WORKFLOW_NAME,
    description: EMPLOYEE_IMPORT_WORKFLOW_DESCRIPTION,
    status: 'active',
    version: 1,
    tasks,
    runtimeParamsSchema: runtimeConfig.runtimeParamsSchema,
    runtimeParamsDefaults: runtimeConfig.runtimeParamsDefaults,
  };
}
