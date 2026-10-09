import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as XLSX from 'xlsx';
import {
  buildPlanSummary,
  mergeFutuExercise,
  mergeFutuGrant,
  mergeShareworksExercise,
  mergeShareworksGrant,
  toTransferPlanPeriod,
} from '../esopPages.js';
import { loadTransferPlanWorkbook, seedTransferPlanData } from '../seed.js';
import { expandByLinkedGroup } from '../employeeLinkExpansion.js';
import { assembleShareworksName } from '../employees.js';
import { config } from '../config.js';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { parseFivePercentHoldersGrid } from '../fivePercentHolders/persistence.js';
import { getLatestMonthlyRunOutput } from '../monthlyRun/instanceStore.js';
import { startEsopPageWorkflow } from '../esopWorkflow/service.js';
import { startDataManagementWorkflow } from '../dataManagementWorkflow/service.js';
import { ESOP_PAGE_WORKFLOW_CONFIGS, type EsopPageKey } from '../esopWorkflow/workflowDefinitions.js';
import {
  DATA_MANAGEMENT_WORKFLOW_CONFIGS,
  type DataManagementPageKey,
} from '../dataManagementWorkflow/workflowDefinitions.js';
import {
  badRequest,
  employeeCanonicalByNumber,
  employeeLabelsByNumber,
  employeeLinkGroupByNumber,
  getProductFileOrThrow,
  inputStorageFolderPrefix,
  latestWorkflowInputSourceBindings,
  notFound,
  pageWorkflowConfig,
  paginateItems,
  productFileDisplayPath,
  readLatestWorkflowDataFrameArtifact,
  readNameEmpNoSort,
  resultFilesFromArtifacts,
  saveProductWorkbook,
  sortRowsByNameOrEmpNo,
  sourceFilesFromArtifacts,
  textValue,
  numberValue,
  nullableNumberValue,
  dateTextValue,
  toProductFile,
  updatedByFromRequest,
  workflowSourceDescriptors,
} from './support.js';
import { employeeLabelIds, employeeLabelNames, employeeNumberByName, normalizeEmployeeName } from './employees.js';
import {
  emptyFivePercentHolderRows,
  applyFivePercentHolderGlobalParameters,
  hasCompleteFivePercentHolderGlobalParameters,
  loadLatestFixedValuesByKey,
  fivePercentHolderGlobalParameterOrder,
} from './parameters.js';
import type { EmployeeLabelRef, RequestWithAuth, WorkflowPageSourceBindingResponse } from './support.js';
import { workflowRunToExecutionResult } from '../workflow/runResult.js';
import type { RouteContext } from './context.js';

/**
 * The workflow-backed product pages: holdings/grants, exercises, sold shares, transfer plan, plan
 * summary and 5% holders. Each page reads the latest workflow artifact for its workflow code and
 * renders it, and each page's "update" action starts that workflow with the chosen source files.
 */

const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

const esopPageKeySchema = z.enum(['grant-record', 'exercise-record', 'sold-shares', 'transfer-plan']);

const esopWorkflowRunBodySchema = z.object({
  sources: z.record(
    z.string(),
    z.object({
      fileId: z.number().int().positive(),
      sheet: z.string().trim().min(1).max(255).optional(),
    }),
  ),
});

const transferPlanEditBodySchema = z.object({
  edits: z
    .array(
      z.object({
        period: z.string().trim().min(1),
        cancelledQuantity: z.number().finite(),
      }),
    )
    .min(1),
});

const dataManagementPageKeySchema = z.enum(['employee', 'plan-summary', 'five-percent-holders']);
const dataManagementWorkflowRunBodySchema = esopWorkflowRunBodySchema;

function futuGrantFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  const employeeNumber = textValue(row['工号']) ?? '';
  return {
    id: index + 1,
    employeeId: index + 1,
    employeeName: textValue(row['姓名']) ?? employeeNumber,
    employeeNumber,
    userId: textValue(row['用户ID']),
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    grantNumber: textValue(row['授予编号']) ?? '',
    incentiveType: textValue(row['激励类型']) ?? '',
    grantDate: dateTextValue(row['授予日期']),
    grantQuantity: nullableNumberValue(row['授予数量']),
    grantPriceUsd: nullableNumberValue(row['授予价(USD)']),
    expireDate: dateTextValue(row['失效日期']),
    planName: textValue(row['所属计划']),
    conditionRule: textValue(row['条件规则']),
    employeePortalVisibility: textValue(row['员工端']),
    closingPriceUsd: nullableNumberValue(row['登记日收盘价(USD)']),
    withholdingCost: textValue(row['代扣成本']),
    taxCalculation: textValue(row['代算税款']),
    taxWithholding: textValue(row['代扣税款']),
    fxSettlement: textValue(row['授予统一结汇']),
    taxRule: textValue(row['授予计税规则']),
    cancellationConfirmDate: dateTextValue(row['确认取消日期']),
    dataSource: textValue(row['数据来源']),
    vestingRuleName: textValue(row['归属规则名称']),
    vestingStartDate: dateTextValue(row['归属起算日期']),
    vestedQuantity: nullableNumberValue(row['已归属']),
    effectiveVestedQuantity: nullableNumberValue(row['有效已归属']),
    unvestedQuantity: nullableNumberValue(row['待归属']),
    vestedCancelledQuantity: nullableNumberValue(row['已归属取消']),
    unvestedCancelledQuantity: nullableNumberValue(row['待归属取消']),
    exercisedQuantity: nullableNumberValue(row['已行权']),
    pendingExerciseQuantity: nullableNumberValue(row['待行权']),
    outstandingQuantity: nullableNumberValue(row.Outstanding),
    sellableQuantity: nullableNumberValue(row['可出售数量']),
    relatedSaleOrderNumber: textValue(row['关联出售订单编号']),
    agreementInfo: textValue(row['协议信息']),
  };
}

function shareworksGrantFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    employeeNumber: textValue(row['Employee Number']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    lastName: textValue(row['Last Name']),
    firstName: textValue(row['First Name']),
    middleName: textValue(row['Middle Name']),
    planName: textValue(row['Plan Name']),
    grantName: textValue(row['Grant Name']),
    grantType: textValue(row['Grant Type']),
    employeeGrantNumber: textValue(row['Employee Grant Number']),
    grantDate: dateTextValue(row['Grant Date']),
    vestingStartDate: dateTextValue(row['Vesting Start Date']),
    serviceStartDate: dateTextValue(row['Service Start Date']),
    originalVestingStartDate: dateTextValue(row['Original VCD (migrated grants)']),
    expireDate: dateTextValue(row['Expire Date']),
    participantExpireDate: dateTextValue(row['Expire Date (participant view)']),
    earliestExpireCancelDate: dateTextValue(row['Earliest Expire Cancel Date']),
    latestExpireCancelDate: dateTextValue(row['Latest Expire Cancel Date']),
    sharesGranted: nullableNumberValue(row['No. of Shares Granted']),
    exercisePricePerShare: nullableNumberValue(row['Exercise Price per Share']),
    vestingSchedule: textValue(row['Vesting Schedule']),
    earlyExerciseAllowed: textValue(row['Early Exercise Allowed']),
    sharesVested: nullableNumberValue(row['No. of Shares Vested']),
    sharesUnvested: nullableNumberValue(row['No. of Shares Unvested']),
    sharesExercisedReleased: nullableNumberValue(row['Shares Exercised / Released']),
    sharesSubjectToRepurchase: nullableNumberValue(row['Shares Subject To Repurchase']),
    sharesCancelledExpired: nullableNumberValue(row['Shares Cancelled/Expired']),
    sharesOutstanding: nullableNumberValue(row['Shares Outstanding']),
    outstandingUnvested: nullableNumberValue(row['Outstanding Unvested']),
    outstandingVestedExercisable: nullableNumberValue(row['Outstanding Vested/Exercisable']),
  };
}

function exerciseFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    name: textValue(row.Name) ?? '',
    employeeNumber: textValue(row['Employee No.']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    futubullId: textValue(row['Futubull ID']) ?? '',
    userId: textValue(row['User ID']) ?? '',
    grantNumber: textValue(row['Grant No.']) ?? '',
    grantDate: dateTextValue(row['Grant Date']) ?? '',
    grantPriceUsd: numberValue(row['Grant Price(USD)']),
    exerciseDate: dateTextValue(row['Exercise Date']) ?? '',
    orderedQuantity: numberValue(row['Ordered Qty']),
    exercisedQuantity: numberValue(row['Exercised Qty']),
    exerciseCostUsd: numberValue(row['Exercise Cost(USD)']),
    deductionSellingQuantity: numberValue(row['Deduction/Selling Qty.']),
    dealtQuantity: numberValue(row['Dealt Qty.']),
  };
}

function shareworksExerciseFromWorkflowRow(
  row: Record<string, unknown>,
  index: number,
  labels: EmployeeLabelRef[] = [],
) {
  return {
    id: index + 1,
    employeeNumber: '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    lastName: textValue(row['Last Name']),
    firstName: textValue(row['First Name']),
    middleName: textValue(row['Middle Name']),
    planName: textValue(row['Plan Name']),
    grantType: textValue(row['Grant Type']),
    employeeGrantNumber: textValue(row['Employee Grant Number']),
    grantDate: dateTextValue(row['Grant Date']),
    sharesGranted: nullableNumberValue(row['No. of Shares Granted']),
    exercisePricePerShare: nullableNumberValue(row['Exercise Price per Share']),
    vestingSchedule: textValue(row['Vesting Schedule']),
    vestingStartDate: dateTextValue(row['Vesting Start Date']),
    originalVestingStartDate: dateTextValue(row['Original VCD (assumed grants)']),
    expireDate: dateTextValue(row['Expire Date']),
    earlyExerciseAllowed: textValue(row['Early Exercise Allowed']),
    sharesVested: nullableNumberValue(row['No. of Shares Vested']),
    sharesUnvested: nullableNumberValue(row['No. of Shares Unvested']),
    sharesExercisedReleased: nullableNumberValue(row['Shares Exercised / Released']),
    sharesSubjectToRepurchase: nullableNumberValue(row['Shares Subject To Repurchase']),
    sharesCancelledExpired: nullableNumberValue(row['Shares Cancelled/Expired']),
    sharesOutstanding: nullableNumberValue(row['Shares Outstanding']),
    outstandingVestedExercisable: nullableNumberValue(row['Outstanding Vested/Exercisable']),
    outstandingUnvested: nullableNumberValue(row['Outstanding Unvested']),
  };
}

function soldShareFromWorkflowRow(row: Record<string, unknown>, index: number, labels: EmployeeLabelRef[] = []) {
  return {
    id: index + 1,
    name: textValue(row['姓名']) ?? '',
    employeeNumber: textValue(row['工号']) ?? '',
    labelIds: employeeLabelIds(labels),
    labels,
    tags: employeeLabelNames(labels),
    futubullId: textValue(row['牛牛号']) ?? '',
    userId: textValue(row['用户ID']) ?? '',
    employmentStatus: textValue(row['在职状态']) ?? '',
    relatedPartyIdentity: textValue(row['关联人士身份']) ?? '',
    capitalGainsTaxVisibility: textValue(row['财产转让所得税']) ?? '',
    soldQuantity: numberValue(row['出售总数量']),
    dealtQuantity: numberValue(row['成交总数量']),
    dealAmountUsd: numberValue(row['成交总金额（美元）']),
    taxableIncomeUsd: numberValue(row['财产转让所得总应税收入（美元）']),
    taxPayableUsd: numberValue(row['财产转让所得总应纳税额（美元）']),
    transactionFeesUsd: numberValue(row['交易总费用（美元）']),
    netDealValueUsd: numberValue(row['成交净值（美元）']),
    grantCostUsd: numberValue(row['授予成本（美元）']),
    exerciseVestingFeeUsd: numberValue(row['行权/归属手续费（美元）']),
    withholdingTaxUsd: numberValue(row['本期合计代扣税额（美元）']),
    withholdingTaxCny: numberValue(row['本期合计代扣税额（人民币）']),
    cashNetProceedsUsd: numberValue(row['现金净收益(美元)']),
  };
}

function transferPlanFromWorkflowRows(rows: Array<Record<string, unknown>>, sourceFileId: number | null) {
  const periodColumns = Object.keys(rows[0] ?? {}).filter((column) => {
    const normalized = column.trim();
    return normalized && !['行标签', '(空白)', '总计'].includes(normalized);
  });
  const totalRows = rows.filter((row) => textValue(row['行标签']) === '总计');
  const sourceTotalRow = totalRows[0] ?? {};
  const adjustedTotalRow = totalRows[1] ?? sourceTotalRow;
  const details = rows.filter((row) => /^K\d+$/.test(textValue(row['行标签']) ?? ''));
  return periodColumns.map((period, sortOrder) => {
    const inTotal = numberValue(sourceTotalRow[period]);
    const transferToFutu = numberValue(adjustedTotalRow[period], inTotal);
    const sourceCancelled = transferToFutu - inTotal;
    return {
      id: sortOrder + 1,
      sourceFileId,
      period,
      inTotal,
      sourceCancelled,
      cancelledQuantity: sourceCancelled,
      transferToFutu,
      manuallyEdited: false,
      sortOrder,
      detailCount: details.length,
    };
  });
}

function transferPlanEditedWorkbookBuffer(
  rows: Array<Record<string, unknown>>,
  edits: Array<{ period: string; cancelledQuantity: number }>,
): Buffer {
  if (rows.length === 0) throw badRequest('Transfer Plan result file has no rows to edit');
  const firstRow = rows[0] ?? {};
  const rowLabelColumn = Object.keys(firstRow).find((column) => column.trim() === '行标签') ?? '行标签';
  const columns = Object.keys(firstRow);
  if (!columns.includes(rowLabelColumn)) columns.unshift(rowLabelColumn);
  const periodColumns = columns.filter((column) => {
    const normalized = column.trim();
    return normalized && normalized !== rowLabelColumn && !['(空白)', '总计'].includes(normalized);
  });
  const totalColumn = columns.find((column) => column.trim() === '总计') ?? '总计';
  if (!columns.includes(totalColumn)) columns.push(totalColumn);

  const editedRows = rows.map((row) => ({ ...row }));
  const totalRows = editedRows.filter((row) => textValue(row[rowLabelColumn]) === '总计');
  if (totalRows.length < 2) {
    throw badRequest('Transfer Plan result file is missing source and adjusted total rows');
  }
  const sourceTotalRow = totalRows[0]!;
  const adjustedTotalRow = totalRows[1]!;
  const editsByPeriod = new Map(edits.map((edit) => [edit.period, edit.cancelledQuantity]));
  const unknownPeriod = [...editsByPeriod.keys()].find((period) => !periodColumns.includes(period));
  if (unknownPeriod) throw badRequest(`Unknown Transfer Plan period: ${unknownPeriod}`);

  for (const period of periodColumns) {
    const sourceValue = numberValue(sourceTotalRow[period]);
    const cancelledQuantity = editsByPeriod.get(period);
    if (cancelledQuantity !== undefined) {
      adjustedTotalRow[period] = sourceValue + cancelledQuantity;
    }
  }
  sourceTotalRow[totalColumn] = periodColumns.reduce((total, period) => total + numberValue(sourceTotalRow[period]), 0);
  adjustedTotalRow[totalColumn] = periodColumns.reduce(
    (total, period) => total + numberValue(adjustedTotalRow[period]),
    0,
  );

  const sheetRows = [[], [], [], columns, ...editedRows.map((row) => columns.map((column) => row[column] ?? null))];
  const worksheet = XLSX.utils.aoa_to_sheet(sheetRows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, '2025 BC Subplan Transfer');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

async function latestFivePercentHolderInputSourceBindings(
  db: RouteContext['db'],
): Promise<WorkflowPageSourceBindingResponse[]> {
  const bindings = await latestWorkflowInputSourceBindings(db, 'five-percent-holders-sync');
  const existing = bindings.find((binding) => binding.sourceKey === 'capitalization_summary');
  if (existing?.fileId) return bindings;

  const latestMonthlyOutput = await getLatestMonthlyRunOutput(db);
  if (!latestMonthlyOutput?.fileId) return bindings;

  const file = await getProductFileOrThrow(db, latestMonthlyOutput.fileId);
  return bindings.map((binding) =>
    binding.sourceKey === 'capitalization_summary'
      ? {
          ...binding,
          fileId: latestMonthlyOutput.fileId,
          fileName: productFileDisplayPath(file),
        }
      : binding,
  );
}

export function registerDataPageRoutes(app: FastifyInstance, ctx: RouteContext) {
  const { db, workflowRunStore, workflowRunExecutor } = ctx;

  app.get('/api/holdings', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const {
      query = '',
      grantType = '',
      tagId = '',
      tag = '',
    } = request.query as {
      query?: string;
      grantType?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-grant-record-sync',
      taskId: 'persist_grant_record_futu_file',
      fallbackSheetName: 'Futu Grants',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-grant-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber(db);
    const canonicalByNumber = await employeeCanonicalByNumber(db);
    const linkGroup = await employeeLinkGroupByNumber(db);
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['工号']) ?? '';
          return {
            ...futuGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (grantType && row.incentiveType !== grantType) return false;
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        }),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [row.employeeName, row.employeeNumber, row.tags.join(' '), row.grantNumber, row.planName, row.vestingRuleName]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        left.grantNumber.localeCompare(right.grantNumber),
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.employeeName ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      holdings: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/grants/shareworks', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tagId = '', tag = '' } = request.query as { query?: string; tagId?: string; tag?: string };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-grant-record-sync',
      taskId: 'persist_grant_record_shareworks_file',
      fallbackSheetName: 'Shareworks Grants',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-grant-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber(db);
    const canonicalByNumber = await employeeCanonicalByNumber(db);
    const linkGroup = await employeeLinkGroupByNumber(db);
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['Employee Number']) ?? '';
          return {
            ...shareworksGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => Boolean(row.employeeGrantNumber))
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        }),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.lastName,
          row.firstName,
          row.middleName,
          row.employeeNumber,
          row.employeeGrantNumber,
          row.planName,
          row.grantName,
          row.grantType,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        String(left.employeeNumber ?? '').localeCompare(String(right.employeeNumber ?? '')) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        String(left.employeeGrantNumber ?? '').localeCompare(String(right.employeeGrantNumber ?? '')),
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim(),
      (row) => String(row.employeeNumber ?? ''),
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/grants/merge', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const { query = '', tagId = '', tag = '' } = request.query as { query?: string; tagId?: string; tag?: string };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const [futuArtifact, shareworksArtifact, labelsByEmployee] = await Promise.all([
      readLatestWorkflowDataFrameArtifact(db, {
        workflowCode: 'esop-grant-record-sync',
        taskId: 'persist_grant_record_futu_file',
        fallbackSheetName: 'Futu Grants',
      }),
      readLatestWorkflowDataFrameArtifact(db, {
        workflowCode: 'esop-grant-record-sync',
        taskId: 'persist_grant_record_shareworks_file',
        fallbackSheetName: 'Shareworks Grants',
      }),
      employeeLabelsByNumber(db),
    ]);
    const futuRows = (futuArtifact?.rows ?? [])
      .map((row, index) => {
        const employeeNumber = textValue(row['工号']) ?? '';
        return futuGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
      })
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      });
    const shareworksRows = (shareworksArtifact?.rows ?? [])
      .map((row, index) => {
        const employeeNumber = textValue(row['Employee Number']) ?? '';
        return shareworksGrantFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
      })
      .filter((row) => Boolean(row.employeeGrantNumber))
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      });
    const canonicalByNumber = await employeeCanonicalByNumber(db);
    const linkGroup = await employeeLinkGroupByNumber(db);
    const items = expandByLinkedGroup(
      [
        ...futuRows.map((row) => ({
          ...mergeFutuGrant(row),
          linkedIdentities: linkGroup.get(row.employeeNumber) ?? [],
        })),
        ...shareworksRows.map((row) => ({
          ...mergeShareworksGrant(row),
          linkedIdentities: linkGroup.get(row.employeeNumber ?? '') ?? [],
        })),
      ],
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [
          row.employeeName,
          row.employeeNumber,
          row.grantNumber,
          row.incentiveType,
          row.planName,
          row.vestingRuleName,
          row.source,
        ]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        left.grantNumber.localeCompare(right.grantNumber),
    );
    const sortedItems = sortRowsByNameOrEmpNo(
      items,
      readNameEmpNoSort(request.query),
      (row) => row.employeeName ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const total = sortedItems.length;
    const offset = (page - 1) * pageSize;
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-grant-record-sync');
    return {
      items: sortedItems.slice(offset, offset + pageSize),
      sourceFiles: inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[],
      workflowSourceBindings: inputSourceBindings,
      workflowResultFiles: resultFilesFromArtifacts(futuArtifact, shareworksArtifact),
      resultFiles: sourceFilesFromArtifacts(futuArtifact, shareworksArtifact),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.get('/api/exercises', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const {
      query = '',
      grantYear = '',
      tagId = '',
      tag = '',
    } = request.query as {
      query?: string;
      grantYear?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedGrantYear = grantYear.trim();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-exercise-record-sync',
      taskId: 'persist_exercise_record_file',
      fallbackSheetName: 'Futu BCI Exercises to Date',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-exercise-record-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber(db);
    const canonicalByNumber = await employeeCanonicalByNumber(db);
    const linkGroup = await employeeLinkGroupByNumber(db);
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['Employee No.']) ?? '';
          return {
            ...exerciseFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        })
        .filter((row) => !normalizedGrantYear || row.grantDate.slice(0, 4) === normalizedGrantYear),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [row.name, row.employeeNumber, row.futubullId, row.userId, row.grantNumber, row.grantDate, row.exerciseDate]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        String(right.exerciseDate ?? '').localeCompare(String(left.exerciseDate ?? '')) ||
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        left.grantNumber.localeCompare(right.grantNumber) ||
        left.id - right.id,
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.name ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/exercises/shareworks', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const {
      query = '',
      tagId = '',
      tag = '',
    } = request.query as {
      query?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const [artifact, inputSourceBindings, labelsByEmployee, numberByName, canonicalByNumber, linkGroup] =
      await Promise.all([
        readLatestWorkflowDataFrameArtifact(db, {
          workflowCode: 'esop-exercise-record-sync',
          taskId: 'persist_exercise_record_shareworks_file',
          fallbackSheetName: 'Shareworks Exec Option OS',
        }),
        latestWorkflowInputSourceBindings(db, 'esop-exercise-record-sync'),
        employeeLabelsByNumber(db),
        employeeNumberByName(db),
        employeeCanonicalByNumber(db),
        employeeLinkGroupByNumber(db),
      ]);
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const name = assembleShareworksName(
            textValue(row['Last Name']),
            textValue(row['First Name']),
            textValue(row['Middle Name']),
          );
          const employeeNumber = numberByName.get(normalizeEmployeeName(name)) ?? '';
          const base = shareworksExerciseFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
          return { ...base, employeeNumber, linkedIdentities: linkGroup.get(employeeNumber) ?? [] };
        })
        .filter((row) => Boolean(row.employeeGrantNumber))
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        }),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [row.lastName, row.firstName, row.middleName, row.employeeGrantNumber, row.planName, row.grantType]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        String(left.lastName ?? '').localeCompare(String(right.lastName ?? '')) ||
        String(left.firstName ?? '').localeCompare(String(right.firstName ?? '')) ||
        String(left.employeeGrantNumber ?? '').localeCompare(String(right.employeeGrantNumber ?? '')),
    );
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => `${row.lastName ?? ''} ${row.firstName ?? ''}`.trim(),
      (row) => String(row.employeeNumber ?? ''),
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/exercises/merge', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const {
      query = '',
      tagId = '',
      tag = '',
    } = request.query as {
      query?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const [
      futuArtifact,
      shareworksArtifact,
      inputSourceBindings,
      labelsByEmployee,
      numberByName,
      canonicalByNumber,
      linkGroup,
    ] = await Promise.all([
      readLatestWorkflowDataFrameArtifact(db, {
        workflowCode: 'esop-exercise-record-sync',
        taskId: 'persist_exercise_record_file',
        fallbackSheetName: 'Futu BCI Exercises to Date',
      }),
      readLatestWorkflowDataFrameArtifact(db, {
        workflowCode: 'esop-exercise-record-sync',
        taskId: 'persist_exercise_record_shareworks_file',
        fallbackSheetName: 'Shareworks Exec Option OS',
      }),
      latestWorkflowInputSourceBindings(db, 'esop-exercise-record-sync'),
      employeeLabelsByNumber(db),
      employeeNumberByName(db),
      employeeCanonicalByNumber(db),
      employeeLinkGroupByNumber(db),
    ]);
    const futuRows = (futuArtifact?.rows ?? [])
      .map((row, index) => {
        const employeeNumber = textValue(row['Employee No.']) ?? '';
        return {
          ...exerciseFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
          linkedIdentities: linkGroup.get(employeeNumber) ?? [],
        };
      })
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      })
      .map((row) => mergeFutuExercise(row));
    const shareworksRows = (shareworksArtifact?.rows ?? [])
      .map((row, index) => {
        const name = assembleShareworksName(
          textValue(row['Last Name']),
          textValue(row['First Name']),
          textValue(row['Middle Name']),
        );
        const employeeNumber = numberByName.get(normalizeEmployeeName(name)) ?? '';
        const base = shareworksExerciseFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []);
        return { ...base, employeeNumber, linkedIdentities: linkGroup.get(employeeNumber) ?? [] };
      })
      .filter((row) => Boolean(row.employeeGrantNumber))
      .filter((row) => {
        if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
        if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
        return true;
      })
      .map((row) => mergeShareworksExercise(row));
    const items = expandByLinkedGroup([...futuRows, ...shareworksRows], normalizedQuery, canonicalByNumber, (row) =>
      [row.employeeName, row.employeeNumber, row.grantNumber, row.source]
        .join(' ')
        .toLowerCase()
        .includes(normalizedQuery),
    ).sort(
      (left, right) =>
        left.employeeNumber.localeCompare(right.employeeNumber) ||
        String(left.grantDate ?? '').localeCompare(String(right.grantDate ?? '')) ||
        left.grantNumber.localeCompare(right.grantNumber),
    );
    const sortedItems = sortRowsByNameOrEmpNo(
      items,
      readNameEmpNoSort(request.query),
      (row) => row.employeeName ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const total = sortedItems.length;
    const offset = (page - 1) * pageSize;
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    return {
      items: sortedItems.slice(offset, offset + pageSize),
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      workflowResultFiles: resultFilesFromArtifacts(futuArtifact, shareworksArtifact),
      resultFiles: sourceFilesFromArtifacts(futuArtifact, shareworksArtifact),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    };
  });

  app.get('/api/sold-shares', async (request) => {
    const { page, pageSize } = paginationQuerySchema.parse(request.query ?? {});
    const {
      query = '',
      employmentStatus = '',
      tagId = '',
      tag = '',
    } = request.query as {
      query?: string;
      employmentStatus?: string;
      tagId?: string;
      tag?: string;
    };
    const normalizedQuery = query.trim().toLowerCase();
    const normalizedEmploymentStatus = employmentStatus.trim();
    const normalizedLabelId = Number(tagId);
    const labelIdFilter = Number.isInteger(normalizedLabelId) && normalizedLabelId > 0 ? normalizedLabelId : 0;
    const normalizedTag = tag.trim();
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-sold-shares-sync',
      taskId: 'persist_sold_shares_file',
      fallbackSheetName: 'Futu Sold Shares',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-sold-shares-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const labelsByEmployee = await employeeLabelsByNumber(db);
    const canonicalByNumber = await employeeCanonicalByNumber(db);
    const linkGroup = await employeeLinkGroupByNumber(db);
    const rows = expandByLinkedGroup(
      (artifact?.rows ?? [])
        .map((row, index) => {
          const employeeNumber = textValue(row['工号']) ?? '';
          return {
            ...soldShareFromWorkflowRow(row, index, labelsByEmployee.get(employeeNumber) ?? []),
            linkedIdentities: linkGroup.get(employeeNumber) ?? [],
          };
        })
        .filter((row) => {
          if (labelIdFilter && !row.labelIds.includes(labelIdFilter)) return false;
          if (!labelIdFilter && normalizedTag && !row.tags.includes(normalizedTag)) return false;
          return true;
        })
        .filter((row) => !normalizedEmploymentStatus || row.employmentStatus === normalizedEmploymentStatus),
      normalizedQuery,
      canonicalByNumber,
      (row) =>
        [row.name, row.employeeNumber, row.futubullId, row.userId, row.employmentStatus, row.relatedPartyIdentity]
          .join(' ')
          .toLowerCase()
          .includes(normalizedQuery),
    ).sort((left, right) => left.employeeNumber.localeCompare(right.employeeNumber) || left.id - right.id);
    const sortedRows = sortRowsByNameOrEmpNo(
      rows,
      readNameEmpNoSort(request.query),
      (row) => row.name ?? '',
      (row) => row.employeeNumber ?? '',
    );
    const paginated = paginateItems(sortedRows, page, pageSize);
    return {
      items: paginated.items,
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      total: paginated.total,
      page: paginated.page,
      pageSize: paginated.pageSize,
      totalPages: paginated.totalPages,
    };
  });

  app.get('/api/transfer-plan', async () => {
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-transfer-to-futu-sync',
      taskId: 'persist_transfer_plan_file',
      fallbackSheetName: '2025 BC Subplan Transfer',
    });
    const inputSourceBindings = await latestWorkflowInputSourceBindings(db, 'esop-transfer-to-futu-sync');
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const baseItems = transferPlanFromWorkflowRows(artifact?.rows ?? [], artifact?.fileId ?? null);
    const detailCount = baseItems[0]?.detailCount ?? 0;
    const items = baseItems.map(({ detailCount: _detailCount, ...item }) => item);
    const sourceFileId = items[0]?.sourceFileId ?? null;
    const totals = items.reduce(
      (result, item) => ({
        inTotal: result.inTotal + item.inTotal,
        sourceCancelled: result.sourceCancelled + item.sourceCancelled,
        cancelledQuantity: result.cancelledQuantity + item.cancelledQuantity,
        transferToFutu: result.transferToFutu + item.transferToFutu,
      }),
      { inTotal: 0, sourceCancelled: 0, cancelledQuantity: 0, transferToFutu: 0 },
    );

    return {
      sourceFileId,
      sourceFileName: artifact?.fileName ?? '2025 BC Subplan Transfer.xlsx',
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      detailCount,
      items,
      totals,
    };
  });

  app.post('/api/transfer-plan/edits', async (request, reply) => {
    const body = transferPlanEditBodySchema.parse(request.body ?? {});
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'esop-transfer-to-futu-sync',
      taskId: 'persist_transfer_plan_file',
      fallbackSheetName: '2025 BC Subplan Transfer',
    });
    if (!artifact) throw notFound('Transfer Plan result file not found');

    const buffer = transferPlanEditedWorkbookBuffer(artifact.rows, body.edits);
    const saved = await saveProductWorkbook(db, {
      originalName: '2025 BC Subplan Transfer.xlsx',
      buffer,
      uploadedBy: `Transfer Plan Edit · ${updatedByFromRequest(request as RequestWithAuth)}`,
      folderPrefix: inputStorageFolderPrefix('transfer-plan'),
    });
    const run = await startEsopPageWorkflow(db, workflowRunStore, workflowRunExecutor, 'transfer-plan', {
      transfer_plan: { fileId: Number(saved.file.id) },
    });

    return reply.code(201).send({
      file: toProductFile(saved.file),
      ...workflowRunToExecutionResult(run),
    });
  });

  app.patch('/api/transfer-plan/:id', async (request) => {
    const { id } = request.params as { id: string };
    const body = z.object({ cancelledQuantity: z.number().finite() }).parse(request.body ?? {});
    let row = await db.queryOne<Record<string, unknown>>(
      `update transfer_plan_periods
          set cancelled_quantity = $2,
              manually_edited = true,
              updated_at = current_timestamp
        where id = $1
        returning *`,
      [Number(id), body.cancelledQuantity],
    );
    if (!row) {
      const artifact = await readLatestWorkflowDataFrameArtifact(db, {
        workflowCode: 'esop-transfer-to-futu-sync',
        taskId: 'persist_transfer_plan_file',
        fallbackSheetName: '2025 BC Subplan Transfer',
      });
      const item = transferPlanFromWorkflowRows(artifact?.rows ?? [], artifact?.fileId ?? null).find(
        (candidate) => candidate.id === Number(id),
      );
      if (item) {
        row = await db.queryOne<Record<string, unknown>>(
          `insert into transfer_plan_periods (
             source_file_id, period, in_total, source_cancelled, cancelled_quantity, manually_edited, sort_order, raw_json
           ) values ($1, $2, $3, $4, $5, true, $6, $7::jsonb)
           on conflict (period) do update
             set source_file_id = excluded.source_file_id,
                 in_total = excluded.in_total,
                 source_cancelled = excluded.source_cancelled,
                 cancelled_quantity = excluded.cancelled_quantity,
                 manually_edited = true,
                 sort_order = excluded.sort_order,
                 raw_json = excluded.raw_json,
                 updated_at = current_timestamp
           returning *`,
          [
            item.sourceFileId,
            item.period,
            item.inTotal,
            item.sourceCancelled,
            body.cancelledQuantity,
            item.sortOrder,
            JSON.stringify(item),
          ],
        );
      }
    }
    if (!row) throw notFound('Transfer plan period not found');
    return { item: toTransferPlanPeriod(row as never) };
  });

  app.post('/api/transfer-plan/import', async (request, reply) => {
    let uploaded: { buffer: Buffer; mimeType: string } | null = null;
    for await (const part of request.parts()) {
      if (part.type === 'file') {
        uploaded = {
          buffer: await part.toBuffer(),
          mimeType: part.mimetype,
        };
      }
    }
    if (!uploaded) return reply.code(400).send({ error: 'No file uploaded' });

    const canonicalName = '2025 BC Subplan Transfer.xlsx';
    const canonicalPath = path.join(config.rootDir, 'database', 'extracted-sheets', canonicalName);
    const temporaryPath = `${canonicalPath}.${crypto.randomUUID()}.tmp.xlsx`;
    fs.writeFileSync(temporaryPath, uploaded.buffer);
    let workbook;
    try {
      workbook = loadTransferPlanWorkbook(temporaryPath);
      fs.renameSync(temporaryPath, canonicalPath);
    } catch (error) {
      fs.rmSync(temporaryPath, { force: true });
      throw error;
    }

    const saved = await saveProductWorkbook(db, {
      originalName: canonicalName,
      buffer: uploaded.buffer,
      mimeType: uploaded.mimeType,
      uploadedBy: 'Administrator',
      folderPrefix: inputStorageFolderPrefix('transfer-plan'),
    });
    await seedTransferPlanData(db, workbook, Number(saved.file.id));
    return reply.code(201).send({
      file: toProductFile(saved.file),
      detailCount: workbook.details.length,
    });
  });

  app.get('/api/plan-summary', async (request) => {
    const requestedMonth = String((request.query as { month?: string }).month ?? '').trim();
    if (requestedMonth && !/^\d{4}-\d{2}$/.test(requestedMonth)) {
      throw badRequest('Invalid month; expected YYYY-MM');
    }
    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'gyre-captable-summary-v2',
      taskId: 'invoke_plan_summary_sync',
      fallbackSheetName: 'Plan Summary',
      month: requestedMonth || null,
    });
    return {
      sourceFiles: artifact ? [artifact.filePath || artifact.fileName] : [],
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      ...buildPlanSummary(
        (artifact?.rows ?? []).map((row) => ({
          plan_name: row.plan_name === undefined || row.plan_name === null ? null : String(row.plan_name),
          granted: row.granted === undefined || row.granted === null ? null : Number(row.granted),
          exercised: row.exercised === undefined || row.exercised === null ? null : Number(row.exercised),
          cancelled: row.cancelled === undefined || row.cancelled === null ? null : Number(row.cancelled),
          outstanding: row.outstanding === undefined || row.outstanding === null ? null : Number(row.outstanding),
        })),
      ),
    };
  });

  app.get('/api/five-percent-holders', async () => {
    const inputSourceBindings = await latestFivePercentHolderInputSourceBindings(db);
    const inputSourceFiles = inputSourceBindings.map((binding) => binding.fileName).filter(Boolean) as string[];
    const fixedValues = await loadLatestFixedValuesByKey(db, fivePercentHolderGlobalParameterOrder);
    const fixedValuesComplete = hasCompleteFivePercentHolderGlobalParameters(fixedValues);
    const emptyResult = {
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: null,
      workflowResultFiles: [] as ReturnType<typeof resultFilesFromArtifacts>,
      resultFiles: [] as string[],
      summary: {
        asOfDate: null,
        fullyDiluted: null,
        commonStockOs: null,
      },
      items: emptyFivePercentHolderRows(fixedValues),
    };
    if (!fixedValuesComplete) return emptyResult;

    const artifact = await readLatestWorkflowDataFrameArtifact(db, {
      workflowCode: 'five-percent-holders-sync',
      taskId: 'persist_five_percent_holders_file',
      fallbackSheetName: '5% Holders',
    });
    if (!artifact) {
      return {
        ...emptyResult,
      };
    }

    const grid = artifact
      ? [artifact.columns, ...artifact.rows.map((row) => artifact.columns.map((column) => row[column] ?? null))]
      : [];
    const workbook = parseFivePercentHoldersGrid(grid);
    const holders = applyFivePercentHolderGlobalParameters(workbook, fixedValues);
    return {
      sourceFiles: inputSourceFiles,
      workflowSourceBindings: inputSourceBindings,
      resultFileName: artifact?.fileName ?? null,
      workflowResultFiles: resultFilesFromArtifacts(artifact),
      resultFiles: sourceFilesFromArtifacts(artifact),
      summary: {
        asOfDate: workbook.asOfDate,
        fullyDiluted: workbook.fullyDiluted,
        commonStockOs: workbook.commonStockOs,
      },
      items: holders.map((row, index) => ({ id: index + 1, ...row })),
    };
  });

  app.get('/api/esop-workflows', async () => ({
    items: (
      await Promise.all(
        Object.values(ESOP_PAGE_WORKFLOW_CONFIGS).map((config) =>
          pageWorkflowConfig(db, config.pageKey, config.workflowCode),
        ),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null),
  }));

  app.post('/api/esop-workflows/:pageKey/runs', async (request, reply) => {
    const pageKey = esopPageKeySchema.parse((request.params as { pageKey: string }).pageKey) as EsopPageKey;
    const body = esopWorkflowRunBodySchema.parse(request.body ?? {});
    const config = ESOP_PAGE_WORKFLOW_CONFIGS[pageKey];
    const sourceDescriptors = await workflowSourceDescriptors(db, config.workflowCode);
    const expectedSourceKeys = new Set(sourceDescriptors.map((source) => source.sourceKey));
    const unknownSourceKey = Object.keys(body.sources).find((sourceKey) => !expectedSourceKeys.has(sourceKey));
    if (unknownSourceKey) throw new Error(`Unknown ESOP workflow source: ${unknownSourceKey}`);

    for (const source of sourceDescriptors) {
      const fileId = body.sources[source.sourceKey]?.fileId;
      if (!fileId) throw new Error(`Missing ESOP workflow source: ${source.sourceKey}`);
      await getProductFileOrThrow(db, fileId);
    }

    const run = await startEsopPageWorkflow(db, workflowRunStore, workflowRunExecutor, pageKey, body.sources);
    return reply.code(201).send(workflowRunToExecutionResult(run));
  });

  app.get('/api/data-management-workflows', async () => ({
    items: (
      await Promise.all(
        Object.values(DATA_MANAGEMENT_WORKFLOW_CONFIGS).map((config) =>
          pageWorkflowConfig(db, config.pageKey, config.workflowCode),
        ),
      )
    ).filter((item): item is NonNullable<typeof item> => item !== null),
  }));

  app.post('/api/data-management-workflows/:pageKey/runs', async (request, reply) => {
    const pageKey = dataManagementPageKeySchema.parse(
      (request.params as { pageKey: string }).pageKey,
    ) as DataManagementPageKey;
    const body = dataManagementWorkflowRunBodySchema.parse(request.body ?? {});
    const config = DATA_MANAGEMENT_WORKFLOW_CONFIGS[pageKey];
    const sourceDescriptors = await workflowSourceDescriptors(db, config.workflowCode);
    const expectedSourceKeys = new Set(sourceDescriptors.map((source) => source.sourceKey));
    const unknownSourceKey = Object.keys(body.sources).find((sourceKey) => !expectedSourceKeys.has(sourceKey));
    if (unknownSourceKey) throw new Error(`Unknown data management workflow source: ${unknownSourceKey}`);
    const sources = { ...body.sources };
    if (pageKey === 'five-percent-holders' && !sources.capitalization_summary?.fileId) {
      const latestMonthlyOutput = await getLatestMonthlyRunOutput(db);
      if (latestMonthlyOutput?.fileId) {
        sources.capitalization_summary = { fileId: latestMonthlyOutput.fileId };
      }
    }
    for (const source of sourceDescriptors) {
      const fileId = sources[source.sourceKey]?.fileId;
      if (!fileId) throw new Error(`Missing data management workflow source: ${source.sourceKey}`);
      const file = await getProductFileOrThrow(db, fileId);
      if (pageKey === 'plan-summary' && source.sourceKey === 'option_plans_summary') {
        const originalName = String(file.original_name ?? file.originalName ?? '').toLowerCase();
        const normalizedName = originalName.replace(/[_-]+/g, ' ');
        if (!normalizedName.includes('option plans summary sl')) {
          throw new Error('Plan Summary 输入文件必须匹配 Gyre_Option_Plans_Summary_SL 文件名模式');
        }
      }
    }
    const run = await startDataManagementWorkflow(db, workflowRunStore, workflowRunExecutor, pageKey, sources);
    return reply.code(201).send(workflowRunToExecutionResult(run));
  });
}
