export type PlanStatus = '待启动' | '进行中' | '已完成';
export type SourceStatus = 'pass' | 'warning' | '';

export type Reconciliation = {
  item: string;
  lastMonth: number;
  newShares: number;
  eomBalance: number;
};

export type CapitalizationRow = {
  type?: 'cat-header-blue' | 'cat-header-gray' | 'cat-sub-label' | 'data';
  number?: string;
  description: string;
  shares?: number;
  percent?: number | null;
  formula?: string;
  highlightShares?: boolean;
};

export type Note = {
  id: number;
  time: string;
  content: string;
};

export type SummarySnapshot = {
  month: string;
  eomDate: string;
  reconciliation: Reconciliation;
  capitalization: CapitalizationRow[];
  totalFullyDiluted: number;
  formulaTrace: Record<string, unknown>;
  notes: Note[];
  capitalizationSource?: SummaryCapitalizationSource | null;
};

export type SummaryCapitalizationSource = {
  fileId: number | null;
  fileName: string | null;
  sheetName: string | null;
};

export type UpdatePlan = {
  id: number;
  month: string;
  monthLabel: string;
  operationTime: string;
  operator: string;
  status: PlanStatus;
  remark: string;
};

export type SourceCheckItem = {
  id?: number;
  fileName: string;
  isRequired: 'Required' | 'Optional' | '';
  uploadedFile: string;
  item?: string;
  metric?: string;
  status: SourceStatus;
  value: number | null;
  action: 'edit' | '-';
};

export type FixedValueItem = {
  id?: number;
  item: string;
  value: number;
  action: 'edit' | '-';
};

export type SourceChecklist = {
  fixedValues: FixedValueItem[];
  shareworksData: SourceCheckItem[];
  futuData: SourceCheckItem[];
};

export type Holding = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  userId: string | null;
  tags: string[];
  grantNumber: string;
  incentiveType: string;
  grantDate: string | null;
  grantQuantity: number | null;
  grantPriceUsd: number | null;
  expireDate: string | null;
  planName: string | null;
  conditionRule: string | null;
  employeePortalVisibility: string | null;
  closingPriceUsd: number | null;
  withholdingCost: string | null;
  taxCalculation: string | null;
  taxWithholding: string | null;
  fxSettlement: string | null;
  taxRule: string | null;
  cancellationConfirmDate: string | null;
  dataSource: string | null;
  vestingRuleName: string | null;
  vestingStartDate: string | null;
  vestedQuantity: number | null;
  effectiveVestedQuantity: number | null;
  unvestedQuantity: number | null;
  vestedCancelledQuantity: number | null;
  unvestedCancelledQuantity: number | null;
  exercisedQuantity: number | null;
  pendingExerciseQuantity: number | null;
  outstandingQuantity: number | null;
  sellableQuantity: number | null;
  relatedSaleOrderNumber: string | null;
  agreementInfo: string | null;
};

export type Employee = {
  id: number;
  employeeNumber: string;
  employeeName: string;
  userId: string | null;
  tags: string[];
  grantCount: number;
};

export type EmployeeMapping = {
  id: number;
  name: string;
  empId: string;
  futuId: string;
  shareworksId: string;
};

export type TrackedPlan = {
  id: number;
  name: string;
  createTime: string;
  status: string;
};

export type ShareholderTag = {
  id: number;
  name: string;
  identity: string;
  track: boolean;
};

export type LinkDetail = {
  title: string;
  columns: Array<{ key: string; label: string }>;
  rows: Array<Record<string, unknown>>;
  summary?: Record<string, unknown>;
};

export type ProductFileRecord = {
  id: number;
  originalName: string;
  storedName: string;
  fileExt: string;
  fileSizeBytes: number;
  mimeType: string;
  checksum: string;
  storageBackend: string;
  workbookSheetCount: number;
  workbookRowCount: number;
  uploadedBy: string;
  createdAt: string;
};

export type ProductFileSheetSummary = {
  sheetName: string;
  rowCount: number;
  columns: string[];
};

export type ProductFileDetail = {
  file: ProductFileRecord;
  sheets: ProductFileSheetSummary[];
};

export type ProductFileSheetPreview = {
  sheetName: string;
  rowCount: number;
  columns: string[];
  rows: Array<Record<string, unknown>>;
};

export type WorkflowDataFrameRange = {
  sheetName: string;
  a1Range: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
};

export type WorkflowDataFrame = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  index: number[];
  matrix: unknown[][];
  range: WorkflowDataFrameRange;
};

export type WorkflowSqlTableBinding = {
  tableName: string;
  inputSlot: string;
};

export type WorkflowAssertOperator = '>' | '>=' | '<' | '<=' | '=' | '!=';
export type WorkflowAssertFailureStrategy = 'block' | 'warning' | 'pass-through';

export type WorkflowAssertionResult = {
  passed: boolean;
  operator: WorkflowAssertOperator;
  actualValue: unknown;
  expectedValue: unknown;
  failureMessage: string;
  failureStrategy: WorkflowAssertFailureStrategy;
  blockExecution: boolean;
  actualLabel?: string;
  expectedLabel?: string;
};

export type PaginatedResult<T> = {
  items?: T[];
  holdings?: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type WorkflowOperatorSlot = {
  slot: string;
  type?: string;
  required?: boolean;
  contentType?: string;
  label?: string;
};

export type WorkflowOperatorCategory = 'Input' | 'Transform' | 'Validation' | 'Output';

export type WorkflowOperatorParamField = {
  type: 'string' | 'number' | 'boolean' | 'array';
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
};

export type WorkflowOperatorParamsSchema = Record<string, WorkflowOperatorParamField>;

export type WorkflowOperator = {
  id: number;
  code: string;
  name: string;
  version: string;
  category: WorkflowOperatorCategory;
  description: string;
  inputSlots: WorkflowOperatorSlot[];
  outputSlots: WorkflowOperatorSlot[];
  paramsSchema: WorkflowOperatorParamsSchema;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTaskInput = {
  from: string;
  slot: string;
};

export type WorkflowTask = {
  id: string;
  name: string;
  operatorCode: string;
  operatorVersion: string;
  description: string;
  x: number;
  y: number;
  params: Record<string, unknown>;
  inputs: Record<string, WorkflowTaskInput>;
  dependsOn?: string[];
};

export type WorkflowDefinition = {
  id: number;
  code: string;
  name: string;
  description: string;
  status: 'draft' | 'active';
  version: number;
  tasks: WorkflowTask[];
  createdAt: string;
  updatedAt: string;
};

export type WorkflowPortableDefinition = {
  code: string;
  name: string;
  description: string;
  status: 'draft' | 'active';
  version: number;
  tasks: WorkflowTask[];
};

export type WorkflowImportExportBundle = {
  format: 'captable-workflow';
  version: 1;
  exportedAt: string;
  workflow: WorkflowPortableDefinition;
};

export type WorkflowTaskPreviewRequest = {
  workflowId: number;
  taskId: string;
  tasks?: WorkflowTask[];
};

export type WorkflowTaskPreviewResult =
  | {
      kind: 'dataframe';
      dataFrame: WorkflowDataFrame;
    }
  | {
      kind: 'assert';
      assertion: WorkflowAssertionResult;
      dataFrame: WorkflowDataFrame;
    }
  | {
      kind: 'file-plan';
      fileName: string;
      sheetName: string;
      dataFrame: WorkflowDataFrame;
    }
  | {
      kind: 'file';
      file: ProductFileRecord;
      dataFrame: WorkflowDataFrame;
    };

export type WorkflowExecutionTaskState = 'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'warning';

export type WorkflowExecutionWarning = {
  taskId: string;
  message: string;
  approved: boolean;
};

export type WorkflowExecutionTaskTiming = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

export type WorkflowExecutionResult = {
  run?: WorkflowRunRecord;
  result: WorkflowTaskPreviewResult | null;
  taskStates: Record<string, WorkflowExecutionTaskState>;
  taskResults: Record<string, WorkflowTaskPreviewResult | null>;
  taskTimings: Record<string, WorkflowExecutionTaskTiming>;
  taskErrors: Record<string, string | null>;
  failedTaskId: string | null;
  blockedTaskIds: string[];
  warningTaskIds: string[];
  waitingForApprovalTaskIds: string[];
  warnings: WorkflowExecutionWarning[];
  errorMessage: string | null;
};

export type WorkflowExecuteRequest = {
  tasks?: WorkflowTask[];
  approvedWarningTaskIds?: string[];
};

export type WorkflowRunStatus = 'running' | 'completed' | 'completed_with_warnings' | 'waiting_approval' | 'failed';

export type WorkflowRunStepRecord = {
  id: number;
  runId: number;
  taskId: string;
  taskName: string;
  operatorCode: string;
  status: WorkflowExecutionTaskState;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  result: WorkflowTaskPreviewResult | null;
};

export type WorkflowRunArtifactRecord = {
  id: number;
  runId: number;
  stepId: number | null;
  taskId: string | null;
  artifactType: 'dataframe' | 'assertion' | 'file' | 'json';
  fileId: number | null;
  name: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowRunRecord = {
  id: number;
  workflowId: number;
  status: WorkflowRunStatus;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  approvedWarningTaskIds: string[];
  steps: WorkflowRunStepRecord[];
  artifacts: WorkflowRunArtifactRecord[];
};
