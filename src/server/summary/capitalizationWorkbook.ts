import * as XLSX from 'xlsx';
import type { CapitalizationRow, SummarySnapshot } from '../../shared/types.js';

type CapitalizationWorkbookRow = {
  Number: number | null;
  Description: string;
  'Common Shares Equivalent': number | string | null;
  '% of fully diluted': number | string | null;
  Formula: string;
};

function readWorkbook(buffer: Buffer) {
  return XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true, cellText: true });
}

function normalizePercentForWorkbook(percent: number | null | undefined): number | null {
  if (percent === null || percent === undefined || Number.isNaN(percent)) return null;
  return percent > 1 ? percent / 100 : percent;
}

function normalizeCapitalizationNumberForWorkbook(value: string | null | undefined): number | null {
  const text = value?.trim();
  if (!text) return null;
  const numericValue = Number(text);
  return Number.isFinite(numericValue) ? numericValue : null;
}

export function summaryCapitalizationToWorkbookBuffer(summary: SummarySnapshot): Buffer {
  const rows: CapitalizationWorkbookRow[] = summary.capitalization.map((item) => {
    if (item.type === 'cat-header-blue' || item.type === 'cat-header-gray') {
      return {
        Number: null,
        Description: item.description,
        'Common Shares Equivalent': null,
        '% of fully diluted': null,
        Formula: '',
      };
    }

    if (item.type === 'cat-sub-label') {
      return {
        Number: null,
        Description: item.description,
        'Common Shares Equivalent': item.shares ?? null,
        '% of fully diluted': null,
        Formula: item.formula ?? '',
      };
    }

    return {
      Number: normalizeCapitalizationNumberForWorkbook(item.number),
      Description: item.description,
      'Common Shares Equivalent': item.shares ?? null,
      '% of fully diluted': normalizePercentForWorkbook(item.percent),
      Formula: item.formula ?? '',
    };
  });

  rows.push({
    Number: null,
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
    const numberCellAddress = XLSX.utils.encode_cell({ r: rowIndex, c: 0 });
    const numberCell = worksheet[numberCellAddress];
    if (numberCell && (numberCell.v === null || numberCell.v === undefined || numberCell.v === '')) {
      delete worksheet[numberCellAddress];
    } else if (numberCell && typeof numberCell.v === 'number') {
      numberCell.t = 'n';
      numberCell.z = '0';
    }

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
