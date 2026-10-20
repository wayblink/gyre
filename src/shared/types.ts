export type PlanStatus = '待启动' | '进行中' | '待复核' | '已完成' | '失败' | '已取消';

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
  fixedValues?: {
    seriesBPreferredStock?: number;
  };
};

export type SummaryCapitalizationSource = {
  fileId: number | null;
  fileName: string | null;
  sheetName: string | null;
};

export type UserRole = 'admin' | 'user';

export type AuthenticatedUser = {
  id: number;
  username: string;
  displayName: string;
  role: UserRole | string;
  email: string | null;
  phone: string | null;
};

export type AccountProfile = AuthenticatedUser;

export type ManagedUser = AuthenticatedUser & {
  role: UserRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AuthStatus = {
  authenticated: boolean;
  bootstrapRequired: boolean;
  user: AuthenticatedUser | null;
};

export type Holding = {
  id: number;
  employeeId: number;
  employeeName: string;
  employeeNumber: string;
  userId: string | null;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
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

export type ExerciseRecord = {
  id: number;
  name: string;
  employeeNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
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

export type SoldShare = {
  id: number;
  name: string;
  employeeNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
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

export type CancellationRecord = {
  id: number;
  name: string;
  employeeNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
  employmentStatus: string;
  grantNumber: string;
  incentiveType: string;
  planName: string;
  grantDate: string;
  changeType: string;
  reason: string;
  quantity: number;
  vestingDate: string;
  changeDate: string;
  financialChangeDate: string;
  creationNumber: string;
  vestingRule: string;
  operator: string;
};

export type TransferPlanPeriod = {
  id: number;
  sourceFileId: number | null;
  period: string;
  inTotal: number;
  sourceCancelled: number;
  cancelledQuantity: number;
  transferToFutu: number;
  manuallyEdited: boolean;
  sortOrder: number;
};

export type TransferPlanResponse = {
  sourceFileId: number | null;
  sourceFileName: string;
  sourceFiles?: string[];
  workflowSourceBindings?: WorkflowPageSourceBinding[];
  workflowResultFiles?: WorkflowResultFileBinding[];
  resultFileName?: string | null;
  resultFiles?: string[];
  detailCount: number;
  items: TransferPlanPeriod[];
  totals: {
    inTotal: number;
    sourceCancelled: number;
    cancelledQuantity: number;
    transferToFutu: number;
  };
};

export type ShareworksGrant = {
  id: number;
  employeeNumber: string | null;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  planName: string | null;
  grantName: string | null;
  grantType: string | null;
  employeeGrantNumber: string | null;
  grantDate: string | null;
  vestingStartDate: string | null;
  serviceStartDate: string | null;
  originalVestingStartDate: string | null;
  expireDate: string | null;
  participantExpireDate: string | null;
  earliestExpireCancelDate: string | null;
  latestExpireCancelDate: string | null;
  sharesGranted: number | null;
  exercisePricePerShare: number | null;
  vestingSchedule: string | null;
  earlyExerciseAllowed: string | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesSubjectToRepurchase: number | null;
  sharesCancelledExpired: number | null;
  sharesOutstanding: number | null;
  outstandingUnvested: number | null;
  outstandingVestedExercisable: number | null;
};

export type MergedGrant = {
  id: string;
  source: 'Futu' | 'Shareworks';
  employeeName: string;
  grantNumber: string;
  employeeNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
  incentiveType: string;
  grantDate: string | null;
  grantQuantity: number | null;
  grantPrice: number | null;
  expireDate: string | null;
  planName: string | null;
  vestingRuleName: string | null;
  vestingStartDate: string | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesCancelledExpired: number | null;
  sharesOutstanding: number | null;
};

export type EmployeeSource = 'futu' | 'shareworks' | 'manual';

// Shareworks Exec Option OS ("Executive Awards OS Only"): a per-grant outstanding-awards report
// (22 columns), keyed by name + Employee Grant Number — no Employee Number, and not a per-transaction
// exercise log. Mirrors the raw columns of the standalone !GYRE_Exec_Option_OS.xlsx export.
export type ShareworksExercise = {
  id: number;
  employeeNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
  lastName: string | null;
  firstName: string | null;
  middleName: string | null;
  planName: string | null;
  grantType: string | null;
  employeeGrantNumber: string | null;
  grantDate: string | null;
  sharesGranted: number | null;
  exercisePricePerShare: number | null;
  vestingSchedule: string | null;
  vestingStartDate: string | null;
  originalVestingStartDate: string | null;
  expireDate: string | null;
  earlyExerciseAllowed: string | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesSubjectToRepurchase: number | null;
  sharesCancelledExpired: number | null;
  sharesOutstanding: number | null;
  outstandingVestedExercisable: number | null;
  outstandingUnvested: number | null;
};

// Loose concatenation of the Futu per-transaction exercise rows and the Shareworks per-grant
// outstanding rows, each keeping its own raw columns, tagged by source. Not column-normalized.
export type MergedExercise = {
  id: string;
  source: 'Futu' | 'Shareworks';
  employeeName: string;
  employeeNumber: string;
  grantNumber: string;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  linkedIdentities?: LinkedEmployeeIdentity[];
  // Futu per-transaction fields (null on Shareworks rows).
  futubullId: string | null;
  userId: string | null;
  grantDate: string | null;
  grantPriceUsd: number | null;
  exerciseDate: string | null;
  orderedQuantity: number | null;
  exercisedQuantity: number | null;
  exerciseCostUsd: number | null;
  deductionSellingQuantity: number | null;
  dealtQuantity: number | null;
  // Shareworks per-grant fields (null on Futu rows).
  planName: string | null;
  grantType: string | null;
  vestingSchedule: string | null;
  vestingStartDate: string | null;
  expireDate: string | null;
  sharesGranted: number | null;
  exercisePricePerShare: number | null;
  sharesVested: number | null;
  sharesUnvested: number | null;
  sharesExercisedReleased: number | null;
  sharesOutstanding: number | null;
};

export type LinkedEmployeeIdentity = {
  id: number;
  employeeId: string;
  source: string;
  name: string;
};

export type Employee = {
  id: number;
  employeeNumber: string;
  employeeName: string;
  userId: string | null;
  labelIds: number[];
  labels: EmployeeLabelRef[];
  tags: string[];
  grantCount: number;
  source: EmployeeSource;
  hasFileEvidence: boolean;
  active: boolean;
  linkedIdentities: LinkedEmployeeIdentity[];
};

export type EmployeeLabelRef = {
  id: number;
  name: string;
  color: string;
};

export type EmployeeLabel = {
  id: number;
  name: string;
  color: string;
  employeeCount: number;
  createdAt: string;
  updatedAt: string;
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

export type PlanSummaryItem = {
  planName: string;
  granted: number;
  exercised: number;
  cancelled: number;
  outstanding: number;
};

export type PlanSummaryResponse = {
  sourceFiles?: string[];
  workflowSourceBindings?: WorkflowPageSourceBinding[];
  workflowResultFiles?: WorkflowResultFileBinding[];
  resultFileName?: string | null;
  resultFiles?: string[];
  items: PlanSummaryItem[];
  totals: {
    planCount: number;
    granted: number;
    exercised: number;
    cancelled: number;
    outstanding: number;
  };
};

export type FixedValueRecord = {
  id: number;
  key: string;
  label: string;
  value: number;
  effectiveFrom: string;
  effectiveTo: string | null;
  editable: boolean;
  updatedBy: string;
  updatedAt: string;
};

export type FivePercentHolder = {
  id: number;
  rowType: 'holder' | 'total';
  name: string;
  commonStock: number | null;
  totalCses: number | null;
  pctOfClass: number | null;
  pctFullyDiluted: number | null;
  sc13Filing: string | null;
  note: string | null;
};

export type FivePercentHoldersResponse = {
  sourceFiles?: string[];
  workflowSourceBindings?: WorkflowPageSourceBinding[];
  workflowResultFiles?: WorkflowResultFileBinding[];
  resultFileName?: string | null;
  resultFiles?: string[];
  summary: {
    asOfDate: string | null;
    fullyDiluted: number | null;
    commonStockOs: number | null;
  };
  items: FivePercentHolder[];
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
  displayName: string;
  storedName: string;
  displayPath: string;
  logicalPath?: string;
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

export type WorkflowDataFrameRange = {
  sheetName: string;
  a1Range: string;
  startRow: number;
  endRow: number;
  startCol: number;
  endCol: number;
};

export type WorkflowDataFrameCellType =
  'string' | 'number' | 'boolean' | 'date' | 'error' | 'blank' | 'null' | 'unknown';

export type WorkflowDataFrameSource = {
  kind: 'excel' | 'computed';
  fileId?: number | null;
  fileName?: string | null;
  sheetName?: string | null;
  range?: WorkflowDataFrameRange | null;
};

export type WorkflowDataFrameCell = {
  column: string;
  rowIndex: number;
  columnIndex: number;
  address: string | null;
  value: unknown;
  displayValue: string;
  type: WorkflowDataFrameCellType;
  format: string | null;
  formula: string | null;
  error: string | null;
  isBlank: boolean;
  isMerged?: boolean;
  source: {
    kind: 'excel' | 'computed';
    fileId?: number | null;
    fileName?: string | null;
    sheetName?: string | null;
    address?: string | null;
    row?: number | null;
    col?: number | null;
  };
};

export type WorkflowDataFrameColumnSchema = {
  name: string;
  index: number;
  type: WorkflowDataFrameCellType | 'mixed';
  nullable: boolean;
  formats: string[];
  sourceAddress?: string | null;
};

export type WorkflowDataFrameSection = {
  key: string;
  title: string;
  range: WorkflowDataFrameRange;
  headerRow: number | null;
  dataStartRow: number;
  dataEndRow: number;
  anchorAddress?: string | null;
};

export type WorkflowDataFrame = {
  columns: string[];
  rows: Array<Record<string, unknown>>;
  index: number[];
  matrix: unknown[][];
  range: WorkflowDataFrameRange;
  schema?: WorkflowDataFrameColumnSchema[];
  cells?: WorkflowDataFrameCell[][];
  source?: WorkflowDataFrameSource;
  sections?: WorkflowDataFrameSection[];
};

export type WorkflowSqlTableBinding = {
  tableName: string;
  inputSlot: string;
};

export type WorkflowAssertOperator = '>' | '>=' | '<' | '<=' | '=' | '!=';
export type WorkflowAssertFailureStrategy = 'block' | 'warning' | 'pass-through';
export type WorkflowInputGuardType =
  'dataframe.assert' | 'dataframe.sql.assert' | 'dataframe.schema.assert' | 'dataframe.shape.assert';

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

export type WorkflowInputGuard = {
  id: string;
  type: WorkflowInputGuardType;
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
};

export type PaginatedResult<T> = {
  items?: T[];
  holdings?: T[];
  sourceFiles?: string[];
  workflowSourceBindings?: WorkflowPageSourceBinding[];
  workflowResultFiles?: WorkflowResultFileBinding[];
  resultFileName?: string | null;
  resultFiles?: string[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

export type WorkflowPageSourceBinding = {
  sourceKey: string;
  label: string;
  fileId: number | null;
  fileName: string | null;
  sheet?: string | null;
};

export type WorkflowResultFileBinding = {
  fileId: number;
  fileName: string;
};

export type WorkflowPageConfig = {
  pageKey: string;
  workflowCode: string;
  workflowName: string;
  description: string;
  sources: Array<{ sourceKey: string; label: string; sheet?: string | null }>;
};

export type WorkflowOperatorSlot = {
  slot: string;
  type?: string;
  required?: boolean;
  contentType?: string;
  label?: string;
};

export type WorkflowOperatorCategory = 'Input' | 'Transform' | 'Validation' | 'Output' | 'Database';

export type WorkflowOperatorParamField = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  label: string;
  required?: boolean;
  placeholder?: string;
  description?: string;
  enum?: string[];
  default?: unknown;
};

export type WorkflowOperatorParamsSchema = Record<string, WorkflowOperatorParamField>;

export type WorkflowOperatorDocumentation = {
  usage: string;
  steps: string[];
  example: string;
};

export type WorkflowRuntimeParameterField = {
  type: 'string' | 'number' | 'boolean' | 'array' | 'object';
  label: string;
  required?: boolean;
  description?: string;
  enum?: string[];
  properties?: WorkflowRuntimeParametersSchema;
  // Optional business-page input-source rendering metadata carried on fileRefs.properties.<sourceKey>.
  // Lets a page's source list (e.g. MonthlyRunSourceDefinition) be derived from a DB workflow schema.
  // jsonb does not preserve key insertion order, so `order` drives display ordering.
  order?: number;
  sourceGroup?: 'shareworks' | 'futu';
  taskId?: string;
  defaultSheetName?: string | null;
  allowSheetNameOverride?: boolean;
  hidden?: boolean;
  optionalCategory?: 'inherit' | 'validation' | 'supplement';
};

export type WorkflowRuntimeParametersSchema = Record<string, WorkflowRuntimeParameterField>;
export type WorkflowRuntimeParameters = Record<string, unknown>;

export type WorkflowRuntimeParameterReference = {
  $fromRuntime: string;
  $type?: WorkflowRuntimeParameterField['type'];
  $label?: string;
  $description?: string;
  $enum?: string[];
  $default?: unknown;
};

export type WorkflowFileReference =
  | {
      provider: 'product-files';
      id?: number;
      key?: string;
    }
  | {
      provider: string;
      key?: string;
      path?: string;
      id?: string | number;
      [key: string]: unknown;
    };

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
  documentation?: WorkflowOperatorDocumentation;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTaskInput = {
  from: string;
  slot: string;
  guards?: WorkflowInputGuard[];
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
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
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
  runtimeParamsSchema: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults: WorkflowRuntimeParameters;
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
  runtimeParamsSchema?: WorkflowRuntimeParametersSchema;
  runtimeParamsDefaults?: WorkflowRuntimeParameters;
  runtimeParameters?: WorkflowRuntimeParameters;
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

export type WorkflowExecutionTaskState =
  'pending' | 'running' | 'completed' | 'failed' | 'blocked' | 'warning' | 'skipped';

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
  runtimeParameters?: WorkflowRuntimeParameters;
  approvedWarningTaskIds?: string[];
};

export type WorkflowRunStatus =
  'pending' | 'running' | 'completed' | 'completed_with_warnings' | 'waiting_approval' | 'failed' | 'skipped';

export type WorkflowRunEventRecord = {
  id: number;
  runId: number;
  stepId: number | null;
  taskId: string | null;
  eventType: string;
  level: 'info' | 'warning' | 'error';
  message: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type WorkflowRunApprovalRecord = {
  id: number;
  runId: number;
  taskId: string;
  approvalKey: string;
  status: 'pending' | 'approved' | 'rejected' | 'skipped';
  decision: string | null;
  decidedBy: string | null;
  comment: string | null;
  createdAt: string;
  decidedAt: string | null;
};

export type WorkflowRunStepRecord = {
  id: number;
  runId: number;
  taskId: string;
  taskName: string;
  description?: string;
  operatorCode: string;
  status: WorkflowExecutionTaskState;
  lockToken: string | null;
  lockedAt: string | null;
  attemptCount: number;
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

/**
 * Client-side view of the run the workflow page is showing: which workflow it belongs to, whether it
 * is open/running, and the per-task state the run panel projects onto the DOM.
 */
export type WorkflowRunState = {
  isOpen: boolean;
  isRunning: boolean;
  workflowId: number | null;
  runId: number | null;
  activeTaskId: string | null;
  taskStates: Record<string, WorkflowExecutionTaskState>;
  approvedWarningTaskIds: string[];
  waitingForApprovalTaskIds: string[];
  warningTaskIds: string[];
  warningMessages: Record<string, string>;
  taskMessages: Record<string, string>;
  message: string;
  errorMessage: string | null;
};

export type WorkflowRunRecord = {
  id: number;
  workflowId: number;
  versionId: number | null;
  workflowCode: string;
  workflowName: string;
  status: WorkflowRunStatus;
  runtimeParameters: WorkflowRuntimeParameters;
  tasksSnapshot: WorkflowTask[];
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  errorMessage: string | null;
  approvedWarningTaskIds: string[];
  steps: WorkflowRunStepRecord[];
  artifacts: WorkflowRunArtifactRecord[];
  events: WorkflowRunEventRecord[];
  approvals: WorkflowRunApprovalRecord[];
};

export type MonthlyRunStatus = WorkflowRunStatus;

export type MonthlyRunHistoryRecord = {
  id: number;
  monthId: number;
  monthKey: string;
  workflowId: number;
  workflowRunId: number | null;
  sourceFileId: number | null;
  sourceFileName: string | null;
  producedFileId: number | null;
  producedFileName: string | null;
  producedSheetName: string | null;
  operator: string;
  status: MonthlyRunStatus;
  errorMessage: string | null;
  triggeredAt: string;
  finishedAt: string | null;
  runtimeParameters: WorkflowRuntimeParameters;
  inputFiles: Array<{
    sourceKey: string;
    label: string;
    fileId: number | null;
    fileName: string | null;
  }>;
};

export type MonthlyRunSourceDefinition = {
  sourceGroup: 'shareworks' | 'futu';
  sourceKey: string;
  taskId: string;
  label: string;
  description: string;
  defaultSheetName?: string | null;
  allowSheetNameOverride?: boolean;
  required: boolean;
  hidden?: boolean;
  optionalCategory?: 'inherit' | 'validation' | 'supplement';
};

export type MonthlyRunFixedValueDefinition = {
  key: string;
  label: string;
  description: string;
  defaultValue: number;
  required: boolean;
};

export type MonthlyRunSourceBinding = {
  fileId: number;
  logicalPath?: string | null;
  fileKey?: string | null;
  sheetName?: string | null;
};

export type MonthlyRunInstanceSourceValue = {
  fileId: number | null;
  fileName: string | null;
  logicalPath?: string | null;
  sheetName: string | null;
};

export type MonthlyRunInstanceRecord = {
  id: number;
  monthId: number;
  monthKey: string;
  workflowCode: string;
  operator: string;
  status: string;
  sources: Record<string, MonthlyRunInstanceSourceValue>;
  fixedValues: Record<string, number>;
  latestWorkflowRunId: number | null;
  latestOutputFileId: number | null;
  latestOutputFileName: string | null;
  latestErrorMessage: string | null;
  lastTriggeredAt: string | null;
  lastFinishedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type LatestMonthlyRunOutput = {
  monthKey: string;
  fileId: number;
  fileName: string;
  finishedAt: string;
};

export type MonthlyRunInstanceUpsertRequest = {
  operator?: string;
  sources?: Record<string, MonthlyRunSourceBinding | null>;
  fixedValues?: Record<string, number>;
};

export type MonthlyRunTriggerRequest = {
  workflowId?: number;
  workflowCode?: string;
  month?: string;
  operator?: string;
  /** Monthly workflow version the UI was built against; the server rejects a mismatch. */
  expectedWorkflowVersion?: number;
};

export type MonthlyRunTriggerResponse = {
  history: MonthlyRunHistoryRecord;
  executionResult: WorkflowExecutionResult;
};

/**
 * Outcome of deleting a Monthly Update Plan. Deleting the plan cascades to the month's run
 * history, its produced output files, and every file under `input/<monthKey>/`. Files under
 * `control_book/` are deliberately left alone: each month's merged base is consumed as the next
 * month's Control Book Summary input, so it is managed as a cross-month chain.
 */
export type MonthlyRunPlanDeleteResult = {
  instanceId: number;
  monthKey: string;
  deletedHistoryCount: number;
  deletedInputFileCount: number;
  deletedOutputFileIds: number[];
};

export type MonthlyRunSourceConfigResponse = {
  workflowCode: string;
  workflowName: string;
  /** Version of the monthly workflow definition row currently stored in the DB. */
  workflowVersion: number;
  sources: MonthlyRunSourceDefinition[];
  fixedValues: MonthlyRunFixedValueDefinition[];
};
