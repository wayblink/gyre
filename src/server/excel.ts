import * as XLSX from 'xlsx';
import type { CapitalizationRow, SummarySnapshot, WorkflowDataFrame } from '../shared/types.js';

export type ParsedWorkbookRow = {
  sheetName: string;
  rowIndex: number;
  row: Record<string, unknown>;
};

export type WorkbookSheetPreview = {
  sheetName: string;
  rowCount: number;
  columns: string[];
  rows: Record<string, unknown>[];
};

export type WorkbookSummary = {
  sheetCount: number;
  totalRowCount: number;
  sheets: Array<{
    sheetName: string;
    rowCount: number;
    columns: string[];
  }>;
};

export type ExtractSheetRangeOptions = {
  range: string;
  headerRow?: number | null;
};

export type DataFrameWorkbookOptions = {
  sheetName?: string;
};

type CapitalizationWorkbookRow = {
  Number: string;
  Description: string;
  'Common Shares Equivalent': number | string | null;
  '% of fully diluted': number | string | null;
  Formula: string;
};

export function rowsToDataFrame(rows: Array<Record<string, unknown>>, range?: Partial<WorkflowDataFrame['range']>): WorkflowDataFrame {
  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row)).filter((key) => key.trim().length > 0)),
  );

  const normalizedRows = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, row[column] ?? null])),
  );

  return {
    columns,
    rows: normalizedRows,
    index: normalizedRows.map((_, index) => index + 1),
    matrix: normalizedRows.map((row) => columns.map((column) => row[column] ?? null)),
    range: {
      sheetName: range?.sheetName ?? 'SQL Result',
      a1Range: range?.a1Range ?? '',
      startRow: range?.startRow ?? 1,
      endRow: range?.endRow ?? normalizedRows.length,
      startCol: range?.startCol ?? 1,
      endCol: range?.endCol ?? columns.length,
    },
  };
}

function readWorkbook(buffer: Buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellText: true });
}

function normalizeCellValue(cell: XLSX.CellObject | undefined): unknown {
  if (!cell || cell.v === undefined) return null;
  return cell.v;
}

function sanitizeColumnName(value: unknown, fallbackIndex: number): string {
  const text = value === null || value === undefined ? '' : String(value).trim();
  return text || `column_${fallbackIndex + 1}`;
}

function uniqueColumnNames(values: unknown[]): string[] {
  const seen = new Map<string, number>();
  return values.map((value, index) => {
    const base = sanitizeColumnName(value, index);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

function readWorksheetRow(
  sheet: XLSX.WorkSheet,
  excelRowNumber: number,
  startColIndex: number,
  endColIndex: number,
): unknown[] {
  const row: unknown[] = [];
  for (let colIndex = startColIndex; colIndex <= endColIndex; colIndex += 1) {
    const cellAddress = XLSX.utils.encode_cell({ r: excelRowNumber - 1, c: colIndex });
    row.push(normalizeCellValue(sheet[cellAddress]));
  }
  return row;
}

export function parseWorkbook(buffer: Buffer): ParsedWorkbookRow[] {
  const workbook = readWorkbook(buffer);
  const rows: ParsedWorkbookRow[] = [];

  for (const sheetName of workbook.SheetNames) {
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });

    jsonRows.forEach((row, index) => {
      rows.push({ sheetName, rowIndex: index + 2, row });
    });
  }

  return rows;
}

export function summarizeWorkbook(buffer: Buffer): WorkbookSummary {
  const workbook = readWorkbook(buffer);
  const sheets = workbook.SheetNames.map((sheetName) => {
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
      defval: null,
      raw: true,
    });
    const columns = Array.from(
      new Set(
        jsonRows.flatMap((row) => Object.keys(row)).filter((key) => key.trim().length > 0),
      ),
    );

    return {
      sheetName,
      rowCount: jsonRows.length,
      columns,
    };
  });

  return {
    sheetCount: sheets.length,
    totalRowCount: sheets.reduce((sum, sheet) => sum + sheet.rowCount, 0),
    sheets,
  };
}

export function previewWorkbookSheet(
  buffer: Buffer,
  sheetName: string,
  limit = 50,
  offset = 0,
): WorkbookSheetPreview {
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }

  const jsonRows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });
  const columns = Array.from(
    new Set(
      jsonRows.flatMap((row) => Object.keys(row)).filter((key) => key.trim().length > 0),
    ),
  );

  return {
    sheetName,
    rowCount: jsonRows.length,
    columns,
    rows: jsonRows.slice(offset, offset + limit),
  };
}

export function extractSheetRangeAsDataFrame(
  buffer: Buffer,
  sheetName: string,
  options: ExtractSheetRangeOptions,
): WorkflowDataFrame {
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }

  const normalizedRange = options.range?.trim();
  if (!normalizedRange) {
    throw new Error('Range is required');
  }

  let decodedRange: XLSX.Range;
  try {
    decodedRange = XLSX.utils.decode_range(normalizedRange);
  } catch {
    throw new Error(`Invalid range: ${options.range}`);
  }

  const startRow = decodedRange.s.r + 1;
  const endRow = decodedRange.e.r + 1;
  const startCol = decodedRange.s.c + 1;
  const endCol = decodedRange.e.c + 1;

  const matrix: unknown[][] = [];
  for (let rowIndex = decodedRange.s.r; rowIndex <= decodedRange.e.r; rowIndex += 1) {
    const row: unknown[] = [];
    for (let colIndex = decodedRange.s.c; colIndex <= decodedRange.e.c; colIndex += 1) {
      const cellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
      row.push(normalizeCellValue(sheet[cellAddress]));
    }
    matrix.push(row);
  }

  const requestedHeaderRow = options.headerRow ?? null;
  const headerMatrixIndex =
    requestedHeaderRow !== null && requestedHeaderRow >= startRow && requestedHeaderRow <= endRow
      ? requestedHeaderRow - startRow
      : null;
  const externalHeaderSource =
    requestedHeaderRow !== null && headerMatrixIndex === null && requestedHeaderRow >= 1
      ? readWorksheetRow(sheet, requestedHeaderRow, decodedRange.s.c, decodedRange.e.c)
      : null;

  const headerSource = externalHeaderSource ?? (headerMatrixIndex === null ? matrix[0] ?? [] : matrix[headerMatrixIndex] ?? []);
  const columns = uniqueColumnNames(headerSource);
  const dataStartIndex = externalHeaderSource ? 0 : headerMatrixIndex === null ? 1 : headerMatrixIndex + 1;

  const rows = matrix.slice(dataStartIndex).map((rowValues) =>
    Object.fromEntries(columns.map((column, index) => [column, rowValues[index] ?? null])),
  );

  const index = rows.map((_, rowIndex) => startRow + dataStartIndex + rowIndex);

  return {
    columns,
    rows,
    index,
    matrix,
    range: {
      sheetName,
      a1Range: XLSX.utils.encode_range(decodedRange),
      startRow,
      endRow,
      startCol,
      endCol,
    },
  };
}

export function dataFrameToWorkbookBuffer(
  dataframe: WorkflowDataFrame,
  options: DataFrameWorkbookOptions = {},
): Buffer {
  const rows = dataframe.rows.map((row) =>
    Object.fromEntries(dataframe.columns.map((column) => [column, row[column] ?? null])),
  );
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: dataframe.columns,
  });
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName?.trim() || dataframe.range.sheetName || 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function normalizePercentForWorkbook(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  return percent > 1 ? percent / 100 : percent;
}

export function summaryCapitalizationToWorkbookBuffer(summary: SummarySnapshot): Buffer {
  const rows: CapitalizationWorkbookRow[] = summary.capitalization.map((item) => {
    if (item.type === 'cat-header-blue' || item.type === 'cat-header-gray') {
      return {
        Number: '',
        Description: item.description,
        'Common Shares Equivalent': null,
        '% of fully diluted': null,
        Formula: '',
      };
    }

    if (item.type === 'cat-sub-label') {
      return {
        Number: '',
        Description: item.description,
        'Common Shares Equivalent': item.shares ?? null,
        '% of fully diluted': null,
        Formula: item.formula ?? '',
      };
    }

    return {
      Number: item.number ?? '',
      Description: item.description,
      'Common Shares Equivalent': item.shares ?? null,
      '% of fully diluted': normalizePercentForWorkbook(item.percent),
      Formula: item.formula ?? '',
    };
  });

  rows.push({
    Number: '',
    Description: 'Total Fully Diluted Shares Outstand',
    'Common Shares Equivalent': summary.totalFullyDiluted,
    '% of fully diluted': 1,
    Formula: '',
  });

  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: ['Number', 'Description', 'Common Shares Equivalent', '% of fully diluted', 'Formula'],
  });

  worksheet['!cols'] = [
    { wch: 10 },
    { wch: 48 },
    { wch: 28 },
    { wch: 20 },
    { wch: 24 },
  ];

  const range = XLSX.utils.decode_range(worksheet['!ref'] ?? 'A1');
  for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
    const shareCell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 2 })];
    if (shareCell && typeof shareCell.v === 'number') {
      shareCell.t = 'n';
      shareCell.z = '#,##0.00';
    }

    const percentCell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: 3 })];
    if (percentCell && typeof percentCell.v === 'number') {
      percentCell.t = 'n';
      percentCell.z = '0.00%';
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Capitalization Summary');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function asTrimmedText(value: unknown): string {
  return value === null || value === undefined ? '' : String(value).trim();
}

function asOptionalNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const normalized = String(value).replace(/,/g, '').trim();
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizePercentValue(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && value.includes('%')) {
    const parsed = asOptionalNumber(value.replace('%', ''));
    return parsed === null ? null : parsed;
  }
  const parsed = asOptionalNumber(value);
  return parsed;
}

function findColumnKey(row: Record<string, unknown>, candidates: string[]): string | undefined {
  const entries = Object.keys(row);
  return entries.find((key) => candidates.includes(key.trim().toLowerCase()));
}

export function parseCapitalizationSummarySheet(
  buffer: Buffer,
  preferredSheetName?: string | null,
): Pick<SummarySnapshot, 'capitalization' | 'totalFullyDiluted'> & { resolvedSheetName: string } {
  const workbook = readWorkbook(buffer);
  const sheetName =
    (preferredSheetName && workbook.SheetNames.find((name) => name === preferredSheetName)) ||
    workbook.SheetNames.find((name) => name === 'Capitalization Summary') ||
    workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('Workbook has no sheets');
  }

  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: null,
    raw: true,
  });

  if (rows.length === 0) {
    return {
      capitalization: [],
      totalFullyDiluted: 0,
      resolvedSheetName: sheetName,
    };
  }

  const descriptionKey =
    findColumnKey(rows[0], ['description', 'item', 'label']) ??
    Object.keys(rows[0]).find((key) => key.trim().length > 0);
  if (!descriptionKey) {
    throw new Error(`Sheet ${sheetName} missing description column`);
  }

  const numberKey = findColumnKey(rows[0], ['number', 'no', '#']);
  const sharesKey = findColumnKey(rows[0], ['common shares equivalent', 'shares', 'common shares', 'value']);
  const percentKey = findColumnKey(rows[0], ['% of fully diluted', 'percent', 'percentage', 'ownership %']);
  const formulaKey = findColumnKey(rows[0], ['formula']);

  const capitalization: CapitalizationRow[] = [];
  let totalFullyDiluted = 0;

  rows.forEach((row) => {
    const description = asTrimmedText(row[descriptionKey]);
    const number = numberKey ? asTrimmedText(row[numberKey]) : '';
    const shares = sharesKey ? asOptionalNumber(row[sharesKey]) : null;
    const percent = percentKey ? normalizePercentValue(row[percentKey]) : null;
    const formula = formulaKey ? asTrimmedText(row[formulaKey]) : '';

    if (!description && !number && shares === null && percent === null && !formula) {
      return;
    }

    const normalizedDescription = description.toLowerCase();
    if (normalizedDescription === 'total fully diluted shares outstand') {
      totalFullyDiluted = shares ?? totalFullyDiluted;
      return;
    }

    const isHeader = !number && shares === null && percent === null && !formula && Boolean(description);
    if (isHeader) {
      capitalization.push({
        type: 'cat-header-blue',
        description,
      });
      return;
    }

    const isSubLabel = !number && shares !== null && percent === null;
    if (isSubLabel) {
      capitalization.push({
        type: 'cat-sub-label',
        description,
        shares,
        formula: formula || undefined,
      });
      return;
    }

    capitalization.push({
      type: 'data',
      number: number || undefined,
      description,
      shares: shares ?? undefined,
      percent,
      formula: formula || undefined,
    });
  });

  if (!totalFullyDiluted) {
    const lastNumericRow = [...capitalization]
      .reverse()
      .find((row) => row.type === 'data' && typeof row.shares === 'number');
    totalFullyDiluted = lastNumericRow?.shares ?? 0;
  }

  return {
    capitalization,
    totalFullyDiluted,
    resolvedSheetName: sheetName,
  };
}
