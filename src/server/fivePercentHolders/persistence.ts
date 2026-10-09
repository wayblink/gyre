export type FivePercentHolderRow = {
  rowType: 'holder' | 'total';
  name: string;
  commonStock: number | null;
  totalCses: number | null;
  pctOfClass: number | null;
  pctFullyDiluted: number | null;
  sc13Filing: string | null;
  note: string | null;
};

export type FivePercentHoldersWorkbook = {
  asOfDate: string | null;
  fullyDiluted: number | null;
  commonStockOs: number | null;
  holders: FivePercentHolderRow[];
};

function asText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  if (!text || text === '--') return null;
  return text;
}

function parseGroupedNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? Math.round(parsed) : null;
}

function parsePercent(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).replace(/%/g, '').trim();
  if (!text) return null;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed / 100 : null;
}

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}

function parseStructuredFivePercentHoldersGrid(grid: unknown[][]): FivePercentHoldersWorkbook | null {
  const rawHeaders = grid[0] ?? [];
  const headers = rawHeaders.map(normalizeHeader);
  const columnIndex = (candidates: string[]): number => {
    const normalizedCandidates = candidates.map(normalizeHeader);
    return headers.findIndex((header) => normalizedCandidates.includes(header));
  };
  const columnIndexWhere = (predicate: (rawHeader: string, normalizedHeader: string) => boolean): number =>
    rawHeaders.findIndex((header, index) => predicate(String(header ?? ''), headers[index] ?? ''));

  const nameIndex = columnIndex(['Name', 'Shareholder']);
  const commonStockIndex = columnIndex(['Common Stock']);
  const totalCsesIndex = columnIndex(['Total CSEs']);
  if (nameIndex < 0 || commonStockIndex < 0 || totalCsesIndex < 0) return null;

  const rowTypeIndex = columnIndex(['Row Type']);
  const pctOfClassIndex = columnIndex(['% of Class', 'Pct Of Class']);
  const pctFullyDilutedIndex = columnIndex(['% Fully Diluted', 'Pct Fully Diluted']);
  const sc13Index = columnIndex(['SC13 Filing']);
  const noteIndex = columnIndex(['Note']);
  const asOfDateIndex = columnIndex(['As Of Date']);
  const fullyDilutedIndex = columnIndexWhere((rawHeader, normalizedHeader) =>
    normalizedHeader === 'fullydiluted' && !rawHeader.includes('%'));
  const commonStockOsIndex = columnIndex(['Common Stock OS']);

  const holders: FivePercentHolderRow[] = [];
  let asOfDate: string | null = null;
  let fullyDiluted: number | null = null;
  let commonStockOs: number | null = null;

  for (let i = 1; i < grid.length; i += 1) {
    const row = grid[i] ?? [];
    const name = asText(row[nameIndex]);
    if (!name) continue;
    const rowTypeText = rowTypeIndex >= 0 ? asText(row[rowTypeIndex])?.toLowerCase() : null;
    const commonStock = parseGroupedNumber(row[commonStockIndex]);
    const totalCses = parseGroupedNumber(row[totalCsesIndex]);
    const rowAsOfDate = asOfDateIndex >= 0 ? asText(row[asOfDateIndex]) : null;
    const rowFullyDiluted = fullyDilutedIndex >= 0 ? parseGroupedNumber(row[fullyDilutedIndex]) : null;
    const rowCommonStockOs = commonStockOsIndex >= 0 ? parseGroupedNumber(row[commonStockOsIndex]) : null;

    asOfDate ??= rowAsOfDate;
    fullyDiluted ??= rowFullyDiluted;
    commonStockOs ??= rowCommonStockOs;

    holders.push({
      rowType: rowTypeText === 'total' || name.toLowerCase().startsWith('total') ? 'total' : 'holder',
      name,
      commonStock,
      totalCses,
      pctOfClass: pctOfClassIndex >= 0 ? parsePercent(row[pctOfClassIndex]) : null,
      pctFullyDiluted: pctFullyDilutedIndex >= 0 ? parsePercent(row[pctFullyDilutedIndex]) : null,
      sc13Filing: sc13Index >= 0 ? asText(row[sc13Index]) : null,
      note: noteIndex >= 0 ? asText(row[noteIndex]) : null,
    });
  }

  return { asOfDate, fullyDiluted, commonStockOs, holders };
}

export function parseFivePercentHoldersGrid(grid: unknown[][]): FivePercentHoldersWorkbook {
  const structured = parseStructuredFivePercentHoldersGrid(grid);
  if (structured) return structured;

  const cell = (row: number, col: number): string | null => asText((grid[row] ?? [])[col]);
  const findRow = (col: number, needle: string): number =>
    grid.findIndex((row) => (asText((row ?? [])[col]) ?? '').toLowerCase().includes(needle.toLowerCase()));

  const edgarRow = findRow(0, 'edgar');
  const fullyDilutedRow = grid.findIndex((row) => (asText((row ?? [])[1]) ?? '').toLowerCase().includes('fully diluted'));
  const commonOsRow = grid.findIndex((row) => (asText((row ?? [])[1]) ?? '').toLowerCase().includes('common stock os'));
  const headerRow = findRow(0, 'shareholder');

  const holders: FivePercentHolderRow[] = [];
  if (headerRow >= 0) {
    for (let i = headerRow + 1; i < grid.length; i += 1) {
      const name = cell(i, 0);
      if (!name) continue;
      if (name.startsWith('*')) break;
      if (name.toLowerCase().includes('5% holders')) continue;
      const commonStock = parseGroupedNumber((grid[i] ?? [])[1]);
      const totalCses = parseGroupedNumber((grid[i] ?? [])[2]);
      if (commonStock === null && totalCses === null) break;
      holders.push({
        rowType: name.toLowerCase().startsWith('total') ? 'total' : 'holder',
        name,
        commonStock,
        totalCses,
        pctOfClass: parsePercent((grid[i] ?? [])[3]),
        pctFullyDiluted: parsePercent((grid[i] ?? [])[4]),
        sc13Filing: cell(i, 5),
        note: cell(i, 6),
      });
    }
  }

  return {
    asOfDate: edgarRow >= 0 ? cell(edgarRow, 1) : null,
    fullyDiluted: fullyDilutedRow >= 0 ? parseGroupedNumber((grid[fullyDilutedRow] ?? [])[0]) : null,
    commonStockOs: commonOsRow >= 0 ? parseGroupedNumber((grid[commonOsRow] ?? [])[0]) : null,
    holders,
  };
}

