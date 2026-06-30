import * as XLSX from 'xlsx';
import type {
  WorkflowDataFrame,
  WorkflowDataFrameCell,
  WorkflowDataFrameCellType,
  WorkflowDataFrameColumnSchema,
  WorkflowDataFrameSection,
} from '../../../shared/types.js';
import {
  defineWorkflowOperator,
  normalizeWorkflowFileReference,
  normalizeWorkflowTaskDependencies,
  readWorkflowFile,
} from './types.js';

type SectionEndMode = 'blank-row' | 'next-anchor' | 'fixed-row-count';

type SheetSectionConfig = {
  key: string;
  title: string;
  range: string;
  headerRow: number | null;
  anchorText: string;
  anchorColumn: string | number | null;
  headerRowOffset: number | null;
  dataStartRowOffset: number | null;
  endMode: SectionEndMode;
  maxRows: number | null;
  rangeColumns: string;
};

type ResolvedSectionConfig = SheetSectionConfig & {
  resolvedRange: string;
  resolvedHeaderRow: number | null;
  dataStartRow: number;
  dataEndRow: number;
  anchorAddress: string | null;
};

type SectionRow = {
  row: Record<string, unknown>;
  sourceCells: Map<string, WorkflowDataFrameCell>;
};

function normalizeNumber(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === '') return null;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return Number.isFinite(value) ? value : null;
}

function normalizeEndMode(raw: unknown): SectionEndMode {
  return raw === 'next-anchor' || raw === 'fixed-row-count' ? raw : 'blank-row';
}

function normalizeSectionConfig(raw: unknown, index: number): SheetSectionConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const key = String(record.key ?? record.title ?? `section_${index + 1}`).trim() || `section_${index + 1}`;
  const title = String(record.title ?? key).trim() || key;
  const range = String(record.range ?? '').trim();
  const anchorText = String(record.anchorText ?? '').trim();
  const rangeColumns = String(record.rangeColumns ?? '').trim();
  const anchorColumnRaw = record.anchorColumn;
  const anchorColumn =
    anchorColumnRaw === null || anchorColumnRaw === undefined || anchorColumnRaw === ''
      ? null
      : typeof anchorColumnRaw === 'number'
        ? anchorColumnRaw
        : String(anchorColumnRaw).trim();

  if (!range && !anchorText) return null;
  return {
    key,
    title,
    range,
    headerRow: normalizeNumber(record.headerRow),
    anchorText,
    anchorColumn,
    headerRowOffset: normalizeNumber(record.headerRowOffset),
    dataStartRowOffset: normalizeNumber(record.dataStartRowOffset),
    endMode: normalizeEndMode(record.endMode),
    maxRows: normalizeNumber(record.maxRows),
    rangeColumns,
  };
}

function normalizeSections(raw: unknown): SheetSectionConfig[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((item, index) => normalizeSectionConfig(item, index))
    .filter((item): item is SheetSectionConfig => Boolean(item));
}

function metadataColumnName(raw: unknown, fallback: string) {
  const value = String(raw ?? '').trim();
  return value || fallback;
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

function makeComputedCell(
  column: string,
  value: unknown,
  rowIndex: number,
  columnIndex: number,
): WorkflowDataFrameCell {
  return {
    column,
    rowIndex,
    columnIndex,
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
      row: rowIndex,
      col: columnIndex,
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
      sourceAddress: columnCells.find((cell) => cell.address)?.address ?? null,
    };
  });
}

function appendUniqueColumns(columns: string[], nextColumns: string[]) {
  nextColumns.forEach((column) => {
    if (column.trim() && !columns.includes(column)) {
      columns.push(column);
    }
  });
}

function getSourceCellMap(dataframe: WorkflowDataFrame, rowIndex: number): Map<string, WorkflowDataFrameCell> {
  const sourceCells = new Map<string, WorkflowDataFrameCell>();
  dataframe.columns.forEach((column, columnIndex) => {
    const cell = dataframe.cells?.[rowIndex]?.[columnIndex];
    if (cell) {
      sourceCells.set(column, cell);
    }
  });
  return sourceCells;
}

function buildSectionDataFrame(params: {
  sheetName: string;
  fileId: number | null;
  sourceRanges: string[];
  columns: string[];
  sectionRows: SectionRow[];
  sections: WorkflowDataFrameSection[];
}): WorkflowDataFrame {
  const range = {
    sheetName: params.sheetName,
    a1Range: params.sourceRanges.join(', '),
    startRow: 1,
    endRow: params.sectionRows.length,
    startCol: 1,
    endCol: params.columns.length,
  };
  const rows = params.sectionRows.map(({ row }) =>
    Object.fromEntries(params.columns.map((column) => [column, row[column] ?? null])),
  );
  const cells = params.sectionRows.map(({ row, sourceCells }, rowIndex) =>
    params.columns.map((column, columnIndex) => {
      const sourceCell = sourceCells.get(column);
      if (!sourceCell) {
        return makeComputedCell(column, row[column] ?? null, rowIndex + 1, columnIndex + 1);
      }
      return {
        ...sourceCell,
        column,
        rowIndex: rowIndex + 1,
        columnIndex: columnIndex + 1,
        source: {
          ...sourceCell.source,
          fileId: params.fileId,
          sheetName: sourceCell.source.sheetName ?? params.sheetName,
        },
      };
    }),
  );

  return {
    columns: params.columns,
    rows,
    index: params.sectionRows.map((_, index) => index + 1),
    matrix: rows.map((row) => params.columns.map((column) => row[column] ?? null)),
    range,
    schema: inferColumnSchema(params.columns, cells),
    cells,
    source: {
      kind: 'excel',
      fileId: params.fileId,
      sheetName: params.sheetName,
      range,
    },
    sections: params.sections,
  };
}

function readWorkbook(buffer: Buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellText: true });
}

function getWorksheetRange(sheet: XLSX.WorkSheet): XLSX.Range {
  const ref = sheet['!ref'];
  if (!ref) {
    throw new Error('Sheet is empty');
  }
  return XLSX.utils.decode_range(ref);
}

function cellText(sheet: XLSX.WorkSheet, rowIndex: number, colIndex: number): string {
  const cell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })] as XLSX.CellObject | undefined;
  if (!cell || cell.v === undefined || cell.v === null) return '';
  return String(cell.w ?? cell.v).trim();
}

function rowValues(sheet: XLSX.WorkSheet, rowIndex: number, startCol: number, endCol: number): string[] {
  const values: string[] = [];
  for (let colIndex = startCol; colIndex <= endCol; colIndex += 1) {
    values.push(cellText(sheet, rowIndex, colIndex));
  }
  return values;
}

function rowNonEmptyCells(sheet: XLSX.WorkSheet, rowIndex: number, startCol: number, endCol: number) {
  return rowValues(sheet, rowIndex, startCol, endCol)
    .map((value, offset) => ({ value, colIndex: startCol + offset }))
    .filter((item) => item.value.length > 0);
}

function isBlankRow(sheet: XLSX.WorkSheet, rowIndex: number, startCol: number, endCol: number): boolean {
  return rowNonEmptyCells(sheet, rowIndex, startCol, endCol).length === 0;
}

function decodeColumnRef(raw: string | number | null, fallback: number): number {
  if (raw === null) return fallback;
  if (typeof raw === 'number') return Math.max(0, Math.floor(raw) - 1);
  const trimmed = raw.trim();
  if (!trimmed) return fallback;
  if (/^\d+$/.test(trimmed)) return Math.max(0, Number(trimmed) - 1);
  return XLSX.utils.decode_col(trimmed.replace(/[^A-Za-z]/g, '').toUpperCase());
}

function parseRangeColumns(raw: string, sheetRange: XLSX.Range): { startCol: number; endCol: number } {
  const trimmed = raw.trim();
  if (!trimmed) return { startCol: sheetRange.s.c, endCol: sheetRange.e.c };
  const parts = trimmed.split(':').map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return { startCol: sheetRange.s.c, endCol: sheetRange.e.c };
  const startCol = decodeColumnRef(parts[0], sheetRange.s.c);
  const endCol = decodeColumnRef(parts[1] ?? parts[0], startCol);
  return {
    startCol: Math.min(startCol, endCol),
    endCol: Math.max(startCol, endCol),
  };
}

function findAnchorRow(
  sheet: XLSX.WorkSheet,
  sheetRange: XLSX.Range,
  section: SheetSectionConfig,
): { rowIndex: number; colIndex: number } | null {
  if (!section.anchorText) return null;
  const needle = section.anchorText.toLowerCase();
  const anchorCol = section.anchorColumn === null ? null : decodeColumnRef(section.anchorColumn, sheetRange.s.c);

  for (let rowIndex = sheetRange.s.r; rowIndex <= sheetRange.e.r; rowIndex += 1) {
    const startCol = anchorCol ?? sheetRange.s.c;
    const endCol = anchorCol ?? sheetRange.e.c;
    for (let colIndex = startCol; colIndex <= endCol; colIndex += 1) {
      if (cellText(sheet, rowIndex, colIndex).toLowerCase().includes(needle)) {
        return { rowIndex, colIndex };
      }
    }
  }
  return null;
}

function isHeaderCandidate(values: string[]): boolean {
  const nonEmpty = values.filter(Boolean);
  if (nonEmpty.length < 2) return false;
  const textLike = nonEmpty.filter((value) => /[A-Za-z\u4e00-\u9fff]/.test(value)).length;
  return textLike >= Math.min(2, nonEmpty.length);
}

function findHeaderRow(
  sheet: XLSX.WorkSheet,
  startRowIndex: number,
  endRowIndex: number,
  startCol: number,
  endCol: number,
): number {
  for (let rowIndex = startRowIndex; rowIndex <= Math.min(endRowIndex, startRowIndex + 8); rowIndex += 1) {
    if (isHeaderCandidate(rowValues(sheet, rowIndex, startCol, endCol))) {
      return rowIndex;
    }
  }
  return startRowIndex;
}

function inferDataEndRow(
  sheet: XLSX.WorkSheet,
  dataStartRowIndex: number,
  sheetRange: XLSX.Range,
  startCol: number,
  endCol: number,
  maxRows: number | null,
): number {
  const maxEnd = maxRows && maxRows > 0 ? Math.min(sheetRange.e.r, dataStartRowIndex + maxRows - 1) : sheetRange.e.r;
  let lastDataRow = dataStartRowIndex - 1;
  for (let rowIndex = dataStartRowIndex; rowIndex <= maxEnd; rowIndex += 1) {
    if (isBlankRow(sheet, rowIndex, startCol, endCol)) break;
    lastDataRow = rowIndex;
  }
  return Math.max(lastDataRow, dataStartRowIndex);
}

function resolveConfiguredSections(
  sheet: XLSX.WorkSheet,
  sheetRange: XLSX.Range,
  sections: SheetSectionConfig[],
): ResolvedSectionConfig[] {
  return sections.map((section, index) => {
    if (section.range) {
      const decoded = XLSX.utils.decode_range(section.range);
      const headerRow = section.headerRow ?? decoded.s.r + 1;
      const dataStartRow = headerRow + 1;
      return {
        ...section,
        resolvedRange: XLSX.utils.encode_range(decoded),
        resolvedHeaderRow: section.headerRow,
        dataStartRow,
        dataEndRow: decoded.e.r + 1,
        anchorAddress: null,
      };
    }

    const anchor = findAnchorRow(sheet, sheetRange, section);
    if (!anchor) {
      throw new Error(`Anchor "${section.anchorText}" not found`);
    }

    const columnBounds = parseRangeColumns(section.rangeColumns, sheetRange);
    const headerRowIndex =
      section.headerRow !== null
        ? section.headerRow - 1
        : section.headerRowOffset !== null
          ? anchor.rowIndex + section.headerRowOffset
          : findHeaderRow(sheet, anchor.rowIndex + 1, sheetRange.e.r, columnBounds.startCol, columnBounds.endCol);
    const dataStartRowIndex =
      section.dataStartRowOffset !== null ? anchor.rowIndex + section.dataStartRowOffset : headerRowIndex + 1;
    const dataEndRowIndex = inferDataEndRow(
      sheet,
      dataStartRowIndex,
      sheetRange,
      columnBounds.startCol,
      columnBounds.endCol,
      section.maxRows,
    );
    const decoded = {
      s: { r: headerRowIndex, c: columnBounds.startCol },
      e: { r: dataEndRowIndex, c: columnBounds.endCol },
    };

    return {
      ...section,
      key: section.key || `section_${index + 1}`,
      title: section.title || section.anchorText || section.key,
      resolvedRange: XLSX.utils.encode_range(decoded),
      resolvedHeaderRow: headerRowIndex + 1,
      dataStartRow: dataStartRowIndex + 1,
      dataEndRow: dataEndRowIndex + 1,
      anchorAddress: XLSX.utils.encode_cell({ r: anchor.rowIndex, c: anchor.colIndex }),
    };
  });
}

function inferAutoSections(sheet: XLSX.WorkSheet, sheetRange: XLSX.Range): ResolvedSectionConfig[] {
  const sections: ResolvedSectionConfig[] = [];
  let rowIndex = sheetRange.s.r;

  while (rowIndex <= sheetRange.e.r) {
    const nonEmpty = rowNonEmptyCells(sheet, rowIndex, sheetRange.s.c, sheetRange.e.c);
    if (nonEmpty.length !== 1) {
      rowIndex += 1;
      continue;
    }

    const headerRowIndex = findHeaderRow(sheet, rowIndex + 1, sheetRange.e.r, sheetRange.s.c, sheetRange.e.c);
    if (headerRowIndex <= rowIndex || headerRowIndex > rowIndex + 8) {
      rowIndex += 1;
      continue;
    }

    const headerCells = rowNonEmptyCells(sheet, headerRowIndex, sheetRange.s.c, sheetRange.e.c);
    if (headerCells.length < 2) {
      rowIndex += 1;
      continue;
    }

    const startCol = Math.min(...headerCells.map((cell) => cell.colIndex));
    const endCol = Math.max(...headerCells.map((cell) => cell.colIndex));
    const dataStartRowIndex = headerRowIndex + 1;
    const dataEndRowIndex = inferDataEndRow(sheet, dataStartRowIndex, sheetRange, startCol, endCol, null);
    const title = nonEmpty[0].value;
    const keyBase = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `section_${sections.length + 1}`;
    const decoded = {
      s: { r: headerRowIndex, c: startCol },
      e: { r: dataEndRowIndex, c: endCol },
    };

    sections.push({
      key: keyBase,
      title,
      range: '',
      headerRow: null,
      anchorText: title,
      anchorColumn: null,
      headerRowOffset: null,
      dataStartRowOffset: null,
      endMode: 'blank-row',
      maxRows: null,
      rangeColumns: '',
      resolvedRange: XLSX.utils.encode_range(decoded),
      resolvedHeaderRow: headerRowIndex + 1,
      dataStartRow: dataStartRowIndex + 1,
      dataEndRow: dataEndRowIndex + 1,
      anchorAddress: XLSX.utils.encode_cell({ r: rowIndex, c: nonEmpty[0].colIndex }),
    });
    rowIndex = dataEndRowIndex + 1;
  }

  return sections;
}

export const sheetSectionsExtractOperator = defineWorkflowOperator({
  code: 'sheet.sections.extract',
  name: 'Excel Sections Extract',
  version: '1.0.0',
  category: 'Input',
  description: '从同一个 Excel Sheet 中提取多个不连续区块，支持固定范围、锚点、空行分段和自动识别表头。',
  inputSlots: [],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    fileRef: { type: 'object', label: '文件引用', required: true, default: null },
    fileId: { type: 'number', label: '文件 ID（兼容）', required: false, default: null },
    sheetName: { type: 'string', label: 'Sheet 名称', required: true, default: '' },
    sectionMode: { type: 'string', label: '区块发现模式', required: false, enum: ['manual', 'auto'], default: 'manual' },
    sections: {
      type: 'array',
      label: 'Sections',
      required: false,
      default: [{ key: 'section_1', title: 'Section 1', range: '', headerRow: null, anchorText: '', rangeColumns: '' }],
    },
    sectionColumn: { type: 'string', label: '区块列名', required: false, default: 'section' },
    sectionIndexColumn: { type: 'string', label: '区块序号列名', required: false, default: 'sectionIndex' },
    sourceRangeColumn: { type: 'string', label: '来源范围列名', required: false, default: 'sourceRange' },
    splitByColumn: {
      type: 'string',
      label: '按列拆分区块',
      required: false,
      description: '适用于连续表内包含多个计划/类别的情况，例如 Category for Grouping',
      default: '',
    },
  },
  normalizeTask(task) {
    task.inputs = {};
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime }) {
    const fileRef = normalizeWorkflowFileReference(task.params.fileRef ?? task.params.fileId);
    const sheetName = String(task.params.sheetName ?? '').trim();
    const configuredSections = normalizeSections(task.params.sections);
    const sectionMode = String(task.params.sectionMode ?? 'manual').trim();

    if (!fileRef) throw new Error(`Task ${task.name} is missing fileRef`);
    if (!sheetName) throw new Error(`Task ${task.name} requires sheetName`);

    const sectionColumn = metadataColumnName(task.params.sectionColumn, 'section');
    const sectionIndexColumn = metadataColumnName(task.params.sectionIndexColumn, 'sectionIndex');
    const sourceRangeColumn = metadataColumnName(task.params.sourceRangeColumn, 'sourceRange');
    const splitByColumn = String(task.params.splitByColumn ?? '').trim();

    const buffer = await readWorkflowFile(runtime, fileRef);
    const workbook = readWorkbook(buffer);
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) throw new Error(`Sheet ${sheetName} not found`);

    const sheetRange = getWorksheetRange(sheet);
    const resolvedSections =
      configuredSections.length > 0 ? resolveConfiguredSections(sheet, sheetRange, configuredSections) : sectionMode === 'auto' ? inferAutoSections(sheet, sheetRange) : [];
    if (!resolvedSections.length) {
      throw new Error(`Task ${task.name} requires at least one section range, anchorText, or sectionMode=auto`);
    }

    const columns: string[] = [];
    const sectionRows: SectionRow[] = [];
    const sourceRanges: string[] = [];
    const sectionMetadata: WorkflowDataFrameSection[] = [];

    resolvedSections.forEach((section, index) => {
      try {
        const dataframe = runtime.extractSheetRangeAsDataFrame(buffer, sheetName, {
          range: section.resolvedRange,
          headerRow: section.resolvedHeaderRow,
        });
        sourceRanges.push(dataframe.range.a1Range);
        appendUniqueColumns(columns, dataframe.columns);
        appendUniqueColumns(columns, [sectionColumn, sectionIndexColumn, sourceRangeColumn]);
        if (splitByColumn && dataframe.columns.includes(splitByColumn)) {
          const groupIndexes = new Map<string, number>();
          let currentGroupTitle = '';
          dataframe.rows.forEach((row, rowIndex) => {
            const splitValue = String(row[splitByColumn] ?? '').trim();
            const groupTitle = splitValue || currentGroupTitle || section.title || section.key;
            if (splitValue) {
              currentGroupTitle = splitValue;
            }
            if (!groupIndexes.has(groupTitle)) {
              const sectionNumber = sectionMetadata.length + 1;
              groupIndexes.set(groupTitle, sectionNumber);
              sectionMetadata.push({
                key: groupTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || `section_${sectionNumber}`,
                title: groupTitle,
                range: dataframe.range,
                headerRow: section.resolvedHeaderRow,
                dataStartRow: section.dataStartRow,
                dataEndRow: section.dataEndRow,
                anchorAddress: section.anchorAddress,
              });
            }
            const nextRow = {
              ...row,
              [sectionColumn]: groupTitle,
              [sectionIndexColumn]: groupIndexes.get(groupTitle) ?? index + 1,
              [sourceRangeColumn]: dataframe.range.a1Range,
            };
            sectionRows.push({
              row: nextRow,
              sourceCells: getSourceCellMap(dataframe, rowIndex),
            });
          });
        } else {
          sectionMetadata.push({
            key: section.key,
            title: section.title || section.key,
            range: dataframe.range,
            headerRow: section.resolvedHeaderRow,
            dataStartRow: section.dataStartRow,
            dataEndRow: section.dataEndRow,
            anchorAddress: section.anchorAddress,
          });
          dataframe.rows.forEach((row, rowIndex) => {
            const nextRow = {
              ...row,
              [sectionColumn]: section.title || section.key,
              [sectionIndexColumn]: index + 1,
              [sourceRangeColumn]: dataframe.range.a1Range,
            };
            sectionRows.push({
              row: nextRow,
              sourceCells: getSourceCellMap(dataframe, rowIndex),
            });
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Section ${section.key || index + 1} extraction failed: ${message}`);
      }
    });

    return buildSectionDataFrame({
      sheetName,
      fileId: fileRef.provider === 'product-files' && typeof fileRef.id === 'number' ? fileRef.id : null,
      sourceRanges,
      columns,
      sectionRows,
      sections: sectionMetadata,
    });
  },
});
