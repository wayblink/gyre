import * as XLSX from 'xlsx';
import type {
  WorkflowDataFrame,
  WorkflowDataFrameCell,
  WorkflowDataFrameCellType,
  WorkflowDataFrameColumnSchema,
  WorkflowDataFrameRange,
} from '../shared/types.js';

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
  dropTrailingEmptyRows?: boolean;
};

export type ResolvedSheetRangeDataFrameOptions = {
  range: XLSX.Range;
  headerRow?: number | null;
  sourceRange?: string;
  dropTrailingEmptyRows?: boolean;
};

function decodeSheetRangeRef(sheet: XLSX.WorkSheet, sheetName: string): XLSX.Range {
  const ref = sheet['!ref'];
  if (!ref) throw new Error(`Sheet ${sheetName} has no usable range`);
  return XLSX.utils.decode_range(ref);
}

function findActualCellBounds(sheet: XLSX.WorkSheet, startRow: number, startCol: number, endRow: number, endCol: number): XLSX.Range {
  let actualEndRow = startRow;
  let actualEndCol = startCol;
  for (const key of Object.keys(sheet)) {
    if (key.startsWith('!')) continue;
    let cellAddress: XLSX.CellAddress;
    try {
      cellAddress = XLSX.utils.decode_cell(key);
    } catch {
      continue;
    }
    if (cellAddress.r < startRow || cellAddress.r > endRow || cellAddress.c < startCol || cellAddress.c > endCol) continue;
    actualEndRow = Math.max(actualEndRow, cellAddress.r);
    actualEndCol = Math.max(actualEndCol, cellAddress.c);
  }
  return {
    s: { r: startRow, c: startCol },
    e: { r: actualEndRow, c: actualEndCol },
  };
}

function decodeExtractRange(range: string, sheet: XLSX.WorkSheet, sheetName: string): XLSX.Range {
  const openEndedRowRange = range.match(/^([A-Z]+)(\d+):([A-Z]+)$/i);
  if (openEndedRowRange) {
    const [, startColumn, startRowText, endColumn] = openEndedRowRange;
    const sheetRange = decodeSheetRangeRef(sheet, sheetName);
    const startRow = Number(startRowText) - 1;
    const startCol = XLSX.utils.decode_col(startColumn);
    const requestedEndCol = XLSX.utils.decode_col(endColumn);
    return findActualCellBounds(sheet, startRow, startCol, sheetRange.e.r, requestedEndCol);
  }
  return XLSX.utils.decode_range(range);
}

function isBlankDataFrameValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '');
}

function trimTrailingBlankRows(matrix: unknown[][]): unknown[][] {
  let end = matrix.length;
  while (end > 0 && matrix[end - 1].every(isBlankDataFrameValue)) end -= 1;
  return matrix.slice(0, end);
}

export type DataFrameWorkbookOptions = {
  sheetName?: string;
};

export function rowsToDataFrame(rows: Array<Record<string, unknown>>, range?: Partial<WorkflowDataFrame['range']>): WorkflowDataFrame {
  const columns = Array.from(
    new Set(rows.flatMap((row) => Object.keys(row)).filter((key) => key.trim().length > 0)),
  );

  const normalizedRows = rows.map((row) =>
    Object.fromEntries(columns.map((column) => [column, normalizeDataFrameInputValue(row[column] ?? null, column)])),
  );

  const cells = normalizedRows.map((row, rowIndex) =>
    columns.map((column, columnIndex): WorkflowDataFrameCell => {
      const value = row[column] ?? null;
      return {
        column,
        rowIndex: rowIndex + 1,
        columnIndex: columnIndex + 1,
        address: null,
        value,
        displayValue: value === null || value === undefined ? '' : String(value),
        type: inferCellValueType(value),
        format: null,
        formula: null,
        error: null,
        isBlank: value === null || value === undefined || value === '',
        source: {
          kind: 'computed',
          row: rowIndex + 1,
          col: columnIndex + 1,
        },
      };
    }),
  );
  const schema = inferColumnSchema(columns, cells);
  const dataframeRange = {
    sheetName: range?.sheetName ?? 'SQL Result',
    a1Range: range?.a1Range ?? '',
    startRow: range?.startRow ?? 1,
    endRow: range?.endRow ?? normalizedRows.length,
    startCol: range?.startCol ?? 1,
    endCol: range?.endCol ?? columns.length,
  };

  return {
    columns,
    rows: normalizedRows,
    index: normalizedRows.map((_, index) => index + 1),
    matrix: normalizedRows.map((row) => columns.map((column) => row[column] ?? null)),
    range: dataframeRange,
    schema,
    cells,
    source: {
      kind: 'computed',
      sheetName: dataframeRange.sheetName,
      range: dataframeRange,
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

function inferCellValueType(value: unknown): WorkflowDataFrameCellType {
  if (value === null) return 'null';
  if (value === undefined || value === '') return 'blank';
  if (value instanceof Date) return 'date';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'unknown';
}

function normalizeDataFrameInputValue(value: unknown, columnName: string): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;
  if (!isInferableNumericColumnName(columnName)) return value;
  return parseWorkbookNumber(value, isPercentColumnName(columnName)) ?? value;
}

function isInferableNumericColumnName(columnName: string): boolean {
  const normalized = columnName.trim().toLowerCase();
  if (!normalized) return false;
  if (/\b(id|code|employee|user|grant|account|identifier|uuid|serial)\b/.test(normalized)) return false;
  return (
    normalized === 'number' ||
    normalized === 'no' ||
    normalized === 'no.' ||
    normalized === '#' ||
    normalized.includes('shares') ||
    normalized.includes('quantity') ||
    normalized.includes('qty') ||
    normalized.includes('amount') ||
    normalized.includes('price') ||
    normalized.includes('percent') ||
    normalized.includes('percentage') ||
    normalized.includes('%')
  );
}

function mapXlsxCellType(cell: XLSX.CellObject | undefined): WorkflowDataFrameCellType {
  if (!cell || cell.v === undefined) return 'blank';
  if (cell.t === 'e') return 'error';
  if (cell.t === 'n') return 'number';
  if (cell.t === 'b') return 'boolean';
  if (cell.t === 'd') return 'date';
  if (cell.t === 's') return 'string';
  if (cell.v === null) return 'null';
  return inferCellValueType(cell.v);
}

function getCellDisplayValue(cell: XLSX.CellObject | undefined): string {
  if (!cell || cell.v === undefined || cell.v === null) return '';
  if (cell.w !== undefined) return String(cell.w);
  return String(cell.v);
}

function isCellInMergedRange(merges: XLSX.Range[] | undefined, rowIndex: number, colIndex: number): boolean {
  if (!merges?.length) return false;
  return merges.some(
    (range) => rowIndex >= range.s.r && rowIndex <= range.e.r && colIndex >= range.s.c && colIndex <= range.e.c,
  );
}

function buildDataFrameCell(
  sheet: XLSX.WorkSheet,
  sheetName: string,
  rowIndex: number,
  colIndex: number,
  columnName: string,
): WorkflowDataFrameCell {
  const address = XLSX.utils.encode_cell({ r: rowIndex, c: colIndex });
  const cell = sheet[address] as XLSX.CellObject | undefined;
  const value = normalizeCellValue(cell);
  const type = mapXlsxCellType(cell);

  return {
    column: columnName,
    rowIndex: rowIndex + 1,
    columnIndex: colIndex + 1,
    address,
    value,
    displayValue: getCellDisplayValue(cell),
    type,
    format: cell?.z ? String(cell.z) : null,
    formula: cell?.f ? String(cell.f) : null,
    error: type === 'error' ? String(cell?.w ?? cell?.v ?? 'Excel error') : null,
    isBlank: !cell || cell.v === undefined || cell.v === null || cell.v === '',
    isMerged: isCellInMergedRange(sheet['!merges'], rowIndex, colIndex),
    source: {
      kind: 'excel',
      sheetName,
      address,
      row: rowIndex + 1,
      col: colIndex + 1,
    },
  };
}

function inferColumnSchema(columns: string[], cells: WorkflowDataFrameCell[][]): WorkflowDataFrameColumnSchema[] {
  return columns.map((column, columnIndex) => {
    const columnCells = cells.map((row) => row[columnIndex]).filter((cell): cell is WorkflowDataFrameCell => Boolean(cell));
    const populatedTypes = new Set(
      columnCells
        .filter((cell) => !cell.isBlank && cell.type !== 'blank' && cell.type !== 'null')
        .map((cell) => cell.type),
    );
    const formats = Array.from(new Set(columnCells.map((cell) => cell.format).filter((format): format is string => Boolean(format))));
    const nullable = columnCells.some((cell) => cell.isBlank || cell.type === 'blank' || cell.type === 'null');
    const type = populatedTypes.size === 0 ? 'blank' : populatedTypes.size === 1 ? Array.from(populatedTypes)[0] : 'mixed';
    return {
      name: column,
      index: columnIndex + 1,
      type,
      nullable,
      formats,
      sourceAddress: columnCells[0]?.address ?? null,
    };
  });
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
    decodedRange = decodeExtractRange(normalizedRange, sheet, sheetName);
  } catch {
    throw new Error(`Invalid range: ${options.range}`);
  }

  return extractResolvedSheetRangeAsDataFrame(buffer, sheetName, {
    range: decodedRange,
    headerRow: options.headerRow,
    sourceRange: normalizedRange,
    dropTrailingEmptyRows: options.dropTrailingEmptyRows,
  });
}

export function extractResolvedSheetRangeAsDataFrame(
  buffer: Buffer,
  sheetName: string,
  options: ResolvedSheetRangeDataFrameOptions,
): WorkflowDataFrame {
  const workbook = readWorkbook(buffer);
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error(`Sheet ${sheetName} not found`);
  }

  const decodedRange = options.range;
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

  const dataMatrix =
    options.dropTrailingEmptyRows === false
      ? matrix.slice(dataStartIndex)
      : trimTrailingBlankRows(matrix.slice(dataStartIndex));
  const effectiveMatrix = matrix.slice(0, dataStartIndex).concat(dataMatrix);
  const rows = dataMatrix.map((rowValues) =>
    Object.fromEntries(columns.map((column, index) => [column, rowValues[index] ?? null])),
  );

  const index = rows.map((_, rowIndex) => startRow + dataStartIndex + rowIndex);
  const cells = dataMatrix.map((_, rowIndex) => {
    const absoluteRowIndex = decodedRange.s.r + dataStartIndex + rowIndex;
    return columns.map((column, columnIndex) => buildDataFrameCell(sheet, sheetName, absoluteRowIndex, decodedRange.s.c + columnIndex, column));
  });
  const schema = inferColumnSchema(columns, cells);
  const effectiveEndRow = dataMatrix.length > 0 ? startRow + dataStartIndex + dataMatrix.length - 1 : startRow + dataStartIndex - 1;
  const dataframeRange: WorkflowDataFrameRange = {
    sheetName,
    a1Range: XLSX.utils.encode_range({
      s: decodedRange.s,
      e: { r: Math.max(decodedRange.s.r, effectiveEndRow - 1), c: decodedRange.e.c },
    }),
    startRow,
    endRow: Math.max(startRow, effectiveEndRow),
    startCol,
    endCol,
  };

  return {
    columns,
    rows,
    index,
    matrix: effectiveMatrix,
    range: dataframeRange,
    schema,
    cells,
    source: {
      kind: 'excel',
      sheetName,
      range: dataframeRange,
    },
  };
}

export function dataFrameToWorkbookBuffer(
  dataframe: WorkflowDataFrame,
  options: DataFrameWorkbookOptions = {},
): Buffer {
  const columnSchema = new Map(dataframe.schema?.map((schema) => [schema.name, schema]));
  const rows = dataframe.rows.map((row) =>
    Object.fromEntries(
      dataframe.columns.map((column) => [
        column,
        normalizeDataFrameValueForWorkbook(row[column] ?? null, column, columnSchema.get(column)),
      ]),
    ),
  );
  const worksheet = XLSX.utils.json_to_sheet(rows, {
    header: dataframe.columns,
  });
  applyDataFrameWorksheetFormats(worksheet, dataframe.columns);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName?.trim() || dataframe.range.sheetName || 'Sheet1');
  return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
}

function normalizeDataFrameValueForWorkbook(
  value: unknown,
  columnName: string,
  schema?: WorkflowDataFrameColumnSchema,
): unknown {
  if (value === null || value === undefined || value === '') return null;
  if (value instanceof Date || typeof value === 'number' || typeof value === 'boolean') return value;

  if (schema?.type === 'number') {
    const parsed = parseWorkbookNumber(value, isPercentColumnName(columnName) || schema.formats.some(isPercentFormat));
    return parsed ?? value;
  }

  return value;
}

function parseWorkbookNumber(value: unknown, percent: boolean): number | null {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? normalizeWorkbookNumericValue(value, percent) : null;
  }

  const text = String(value).trim();
  if (!text || /^[-+]?0\d/.test(text)) return null;
  const withoutPercent = text.endsWith('%') ? text.slice(0, -1).trim() : text;
  const normalized = withoutPercent.replace(/,/g, '');
  if (!/^[-+]?(?:\d+|\d*\.\d+)$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed)) return null;
  return normalizeWorkbookNumericValue(parsed, percent || text.endsWith('%'));
}

function normalizeWorkbookNumericValue(value: number, percent: boolean): number {
  return percent && Math.abs(value) > 1 ? value / 100 : value;
}

function isPercentColumnName(columnName: string): boolean {
  const normalized = columnName.trim().toLowerCase();
  return normalized.includes('%') || normalized.includes('percent') || normalized.includes('percentage');
}

function isPercentFormat(format: string): boolean {
  return format.includes('%');
}

function isShareCountColumnName(columnName: string): boolean {
  const normalized = columnName.trim().toLowerCase();
  return normalized.includes('shares') || normalized.includes('qty') || normalized.includes('quantity') || normalized.includes('outstanding');
}

function applyDataFrameWorksheetFormats(worksheet: XLSX.WorkSheet, columns: string[]) {
  const ref = worksheet['!ref'];
  if (!ref) return;

  const range = XLSX.utils.decode_range(ref);
  for (let columnIndex = range.s.c; columnIndex <= range.e.c; columnIndex += 1) {
    const columnName = columns[columnIndex - range.s.c] ?? '';
    const numberFormat = isPercentColumnName(columnName)
      ? '0.00%'
      : isShareCountColumnName(columnName)
        ? '#,##0'
        : null;
    if (!numberFormat) continue;

    for (let rowIndex = range.s.r + 1; rowIndex <= range.e.r; rowIndex += 1) {
      const cell = worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: columnIndex })];
      if (cell && typeof cell.v === 'number') {
        cell.t = 'n';
        cell.z = numberFormat;
      }
    }
  }
}
