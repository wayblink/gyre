export type MonthlyRunInputUsageRow = Record<string, unknown>;

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[-–—]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function normalizeSourceFileName(value: unknown): string {
  return normalizeText(value).replace(/\.(xlsx|xls|csv)$/i, '');
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

function rowSearchText(row: MonthlyRunInputUsageRow): string {
  const raw = parseRawValue(row.raw_value);
  return [
    row.source_group,
    row.metric_key,
    row.label,
    row.sheet_name,
    row.cell_ref,
    row.range_ref,
    row.uploaded_file,
    row.display_file_name,
    row.display_uploaded_file,
    raw.fileName,
    raw.item,
    raw.metric,
    raw.uploadedFile,
  ]
    .map(normalizeText)
    .filter(Boolean)
    .join(' | ');
}

const workflowFileRuntimeMatchers: Record<string, string[]> = {
  base_control_book: ['eq control book'],
  base_futu_exercises: ['futu exercises'],
  incremental_control_book: ['control_books_detail', 'control books detail', '27591'],
  futu_exercises: ['futu bci exercises', 'futu bci exercises to date'],
  option_plans_summary: ['option plans summary', 'gyre option plans summary sl'],
  options_os_detail_by_plan: ['options os detail by plan', 'options os detail'],
};

const workflowFixedValueMatchers: Record<string, string[]> = {
  optionsOutstandingCullgen: ['options outstanding cullgen', 'options_outstanding_cullgen'],
  optionsAvailableCullgen: ['options available cullgen', 'options_available_cullgen'],
};

export function monthlyRunWorkflowFileRuntimeKeyForRow(row: MonthlyRunInputUsageRow): string | null {
  const text = rowSearchText(row);
  for (const [runtimeKey, matchers] of Object.entries(workflowFileRuntimeMatchers)) {
    if (matchers.some((matcher) => text.includes(normalizeText(matcher)))) return runtimeKey;
  }
  return null;
}

export function monthlyRunWorkflowFileRuntimeKeyForName(fileName: unknown): string | null {
  const text = normalizeSourceFileName(fileName);
  for (const [runtimeKey, matchers] of Object.entries(workflowFileRuntimeMatchers)) {
    if (matchers.some((matcher) => text === normalizeSourceFileName(matcher))) return runtimeKey;
  }
  return null;
}

export function monthlyRunWorkflowFixedRuntimeKeyForRow(row: MonthlyRunInputUsageRow): string | null {
  const text = rowSearchText(row);
  for (const [runtimeKey, matchers] of Object.entries(workflowFixedValueMatchers)) {
    if (matchers.some((matcher) => text.includes(normalizeText(matcher)))) return runtimeKey;
  }
  return null;
}

export function isMonthlyRunWorkflowRuntimeInputRow(row: MonthlyRunInputUsageRow): boolean {
  if (normalizeText(row.source_group) === 'fixed') {
    return monthlyRunWorkflowFixedRuntimeKeyForRow(row) !== null;
  }
  return monthlyRunWorkflowFileRuntimeKeyForRow(row) !== null;
}
