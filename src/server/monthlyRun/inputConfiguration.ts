import type { WorkflowRuntimeParameters } from '../../shared/types.js';
import type { MonthlyRunDb } from './store.js';
import { buildMonthlyRuntimeParameters, MONTHLY_RUN_SOURCE_DEFINITIONS } from './workflowDefinition.js';
import { productFileRef } from '../workflow/fileSources.js';

type UpdatePlanInputRow = Record<string, unknown>;
type ValidationError = Error & { statusCode?: number };

export type MonthlyRunInputConfiguration = {
  updatePlanId: number;
  month: string;
  operator: string;
  runtimeParameters: WorkflowRuntimeParameters;
  primarySourceFileId: number | null;
};

export type ProductFileBackfill = {
  originalName: string;
  filePath: string;
  mimeType?: string;
  uploadedBy?: string;
  folderPrefix?: string;
};

export type ProductFileBindingLookup = {
  sourceKey: string;
  label: string;
  uploadedFile: string;
  defaultSheetName: string | null;
  currentProductFileId?: number | null;
};

const sourceMetricMatchers: Record<string, string[]> = {
  control_book: ['eq control book'],
  futu_exercises: ['futu bci exercises to date'],
  option_plans: ['option plans summary'],
};

const fixedValueMatchers: Record<string, string[]> = {
  optionsOutstandingCullgen: ['options outstanding cullgen', 'options_outstanding_cullgen'],
  optionsAvailableCullgen: ['options available cullgen', 'options_available_cullgen'],
};

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function parseRawValue(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value)) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function rowText(row: UpdatePlanInputRow): string {
  const raw = parseRawValue(row.raw_value);
  return [
    row.source_group,
    row.metric_key,
    row.label,
    raw.fileName,
    raw.item,
    raw.metric,
    row.sheet_name,
    row.cell_ref,
    row.range_ref,
    row.uploaded_file,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' | ');
}

function normalizedMetricKey(value: unknown): string {
  return normalizeText(value).replaceAll(' ', '_');
}

function rowNumericValue(row: UpdatePlanInputRow): number | null {
  const direct = Number(row.normalized_value);
  if (Number.isFinite(direct)) return direct;
  const raw = parseRawValue(row.raw_value);
  const rawValue = Number(raw.value);
  return Number.isFinite(rawValue) ? rawValue : null;
}

function rowProductFileId(row: UpdatePlanInputRow): number | null {
  if (row.product_file_id === null || row.product_file_id === undefined) return null;
  const id = Number(row.product_file_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function rowSourceFileId(row: UpdatePlanInputRow): number | null {
  if (row.source_file_id === null || row.source_file_id === undefined) return null;
  const id = Number(row.source_file_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function rowUploadedFile(row: UpdatePlanInputRow | null): string {
  return String(row?.uploaded_file ?? '').trim();
}

function rowLabel(row: UpdatePlanInputRow): string {
  const raw = parseRawValue(row.raw_value);
  return String(raw.fileName ?? raw.item ?? raw.metric ?? row.label ?? `Metric ${String(row.id ?? '')}`).trim();
}

function isRequiredInputRow(row: UpdatePlanInputRow): boolean {
  return normalizeText(row.required) === 'required' && normalizeText(row.source_group) !== 'fixed';
}

function isMissingUploadedFile(row: UpdatePlanInputRow): boolean {
  const uploadedFile = rowUploadedFile(row);
  return !uploadedFile || normalizeText(uploadedFile) === 'not uploaded';
}

function inputConfigurationError(message: string): ValidationError {
  const error = new Error(message) as ValidationError;
  error.statusCode = 400;
  return error;
}

function findInputRow(sourceKey: string, rows: UpdatePlanInputRow[]): UpdatePlanInputRow | null {
  const matchers = sourceMetricMatchers[sourceKey] ?? [sourceKey.replaceAll('_', ' ')];
  return (
    rows.find((row) => {
      const text = rowText(row);
      return matchers.some((matcher) => text.includes(matcher));
    }) ?? null
  );
}

function resolveFixedValues(rows: UpdatePlanInputRow[]): Record<string, number> {
  const fixedRows = rows.filter((row) => normalizeText(row.source_group) === 'fixed');
  const fixedValues: Record<string, number> = {};
  for (const [runtimeKey, matchers] of Object.entries(fixedValueMatchers)) {
    const row = fixedRows.find((candidate) => {
      const raw = parseRawValue(candidate.raw_value);
      const texts = [
        normalizeText(candidate.label),
        normalizeText(raw.item),
        normalizeText(raw.metric),
        normalizedMetricKey(candidate.metric_key),
      ];
      return matchers.some((matcher) => {
        const normalizedMatcher = normalizeText(matcher);
        const keyMatcher = normalizedMetricKey(matcher);
        return texts.some((text) => text.includes(normalizedMatcher) || text.includes(keyMatcher));
      });
    });
    const value = row ? rowNumericValue(row) : null;
    if (value !== null) fixedValues[runtimeKey] = value;
  }
  return fixedValues;
}

async function resolveRequiredInputRows(
  db: MonthlyRunDb,
  updatePlanId: number,
  rows: UpdatePlanInputRow[],
  backfillProductFile?: (params: ProductFileBackfill) => Promise<number>,
  lookupProductFile?: (params: ProductFileBindingLookup) => Promise<number | null>,
): Promise<Map<unknown, number>> {
  const resolvedFileIds = new Map<unknown, number>();
  for (const row of rows.filter(isRequiredInputRow)) {
    const label = rowLabel(row);
    if (isMissingUploadedFile(row)) {
      throw inputConfigurationError(`Input Configuration is incomplete: missing file for ${label}`);
    }

    let fileId = rowProductFileId(row);
    const sourceFileId = rowSourceFileId(row);
    if (!fileId && sourceFileId && backfillProductFile) {
      const sourceFile = await db.queryOne<UpdatePlanInputRow>('select * from source_files where id = $1', [sourceFileId]);
      if (sourceFile) {
        fileId = await backfillProductFile({
          originalName: String(sourceFile.original_name ?? rowUploadedFile(row) ?? `${label}.xlsx`),
          filePath: String(sourceFile.file_path),
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          uploadedBy: 'Input Configuration',
          folderPrefix: `sources/${updatePlanId}`,
        });
      }
    }

    if (lookupProductFile && rowUploadedFile(row)) {
      const lookedUpFileId = await lookupProductFile({
        sourceKey: `input_metric_${String(row.id ?? label)}`,
        label,
        uploadedFile: rowUploadedFile(row),
        defaultSheetName: null,
        currentProductFileId: fileId,
      });
      if (lookedUpFileId) fileId = lookedUpFileId;
    }

    if (!fileId && lookupProductFile) {
      fileId = await lookupProductFile({
        sourceKey: `input_metric_${String(row.id ?? label)}`,
        label,
        uploadedFile: rowUploadedFile(row),
        defaultSheetName: null,
        currentProductFileId: null,
      });
    }

    if (!fileId) {
      throw inputConfigurationError(`Input Configuration is incomplete: missing file for ${label}`);
    }

    resolvedFileIds.set(row.id, fileId);
    if (fileId !== rowProductFileId(row)) {
      await db.execute('update source_metrics set product_file_id = $1 where id = $2', [fileId, row.id]);
    }
  }
  return resolvedFileIds;
}

export async function resolveMonthlyRunInputConfiguration(
  db: MonthlyRunDb,
  updatePlanId: number,
  backfillProductFile?: (params: ProductFileBackfill) => Promise<number>,
  lookupProductFile?: (params: ProductFileBindingLookup) => Promise<number | null>,
): Promise<MonthlyRunInputConfiguration> {
  const plan = await db.queryOne<UpdatePlanInputRow>(
    `select up.id, up.operator, m.month_key
       from update_plans up
       join months m on m.id = up.month_id
      where up.id = $1`,
    [updatePlanId],
  );
  if (!plan) throw new Error(`Update plan ${updatePlanId} not found`);

  const rows = await db.query<UpdatePlanInputRow>(
    `select *
       from source_metrics
      where update_plan_id = $1
      order by case source_group when 'fixed' then 1 when 'shareworks' then 2 when 'futu' then 3 else 4 end, sort_order, id`,
    [updatePlanId],
  );

  const requiredInputFileIds = await resolveRequiredInputRows(db, updatePlanId, rows, backfillProductFile, lookupProductFile);
  const fixedValues = resolveFixedValues(rows);

  const fileIds: Record<string, number> = {};
  for (const source of MONTHLY_RUN_SOURCE_DEFINITIONS) {
    const row = findInputRow(source.sourceKey, rows);
    let fileId = row ? (requiredInputFileIds.get(row.id) ?? rowProductFileId(row)) : null;
    const sourceFileId = row ? rowSourceFileId(row) : null;
    if (!fileId && sourceFileId && backfillProductFile) {
      const sourceFile = await db.queryOne<UpdatePlanInputRow>('select * from source_files where id = $1', [sourceFileId]);
      if (sourceFile) {
        fileId = await backfillProductFile({
          originalName: String(sourceFile.original_name ?? row?.uploaded_file ?? `${source.sourceKey}.xlsx`),
          filePath: String(sourceFile.file_path),
          mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          uploadedBy: 'Input Configuration',
          folderPrefix: `sources/${updatePlanId}`,
        });
        await db.execute('update source_metrics set product_file_id = $1 where id = $2', [fileId, row?.id]);
      }
    }
    if (row && lookupProductFile) {
      const lookedUpFileId = await lookupProductFile({
        sourceKey: source.sourceKey,
        label: source.label,
        uploadedFile: rowUploadedFile(row),
        defaultSheetName: source.defaultSheetName ?? null,
        currentProductFileId: fileId,
      });
      if (lookedUpFileId) {
        const shouldUpdateMetric = lookedUpFileId !== fileId;
        fileId = lookedUpFileId;
        if (shouldUpdateMetric) {
          await db.execute('update source_metrics set product_file_id = $1 where id = $2', [fileId, row.id]);
        }
      }
    }
    if (!fileId && source.required) {
      throw inputConfigurationError(`Missing Input Configuration file: ${source.label}`);
    }
    if (fileId) fileIds[source.sourceKey] = fileId;
  }

  return {
    updatePlanId,
    month: String(plan.month_key),
    operator: String(plan.operator ?? 'Administrator'),
    runtimeParameters: buildMonthlyRuntimeParameters({
      month: String(plan.month_key),
      fileRefs: Object.fromEntries(Object.entries(fileIds).map(([sourceKey, fileId]) => [sourceKey, productFileRef(fileId)])),
      fixedValues,
    }),
    primarySourceFileId: fileIds.control_book ?? Object.values(fileIds)[0] ?? null,
  };
}
