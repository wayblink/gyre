import * as XLSX from 'xlsx';

export type UniverWorkbookData = {
  id: string;
  name?: string;
  sheetOrder: string[];
  sheets: Record<
    string,
    {
      id: string;
      name: string;
      cellData: Record<number, Record<number, Record<string, unknown>>>;
      rowCount: number;
      columnCount: number;
    }
  >;
};

export function bufferToUniverWorkbook(buffer: ArrayBuffer, displayName: string): UniverWorkbookData {
  const workbook = XLSX.read(buffer, {
    type: 'array',
    cellFormula: true,
    cellDates: true,
    cellNF: true,
  });

  const workbookId = `uploaded-${Date.now()}`;
  const sheetOrder: string[] = [];
  const sheets: UniverWorkbookData['sheets'] = {};
  const workbookSheetNames = new Set(workbook.SheetNames);

  workbook.SheetNames.forEach((sheetName, index) => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) return;

    const sheetId = `sheet-${index + 1}`;
    sheetOrder.push(sheetId);

    const ref = sheet['!ref'];
    const decodedRange = ref ? XLSX.utils.decode_range(ref) : null;
    const cellData: UniverWorkbookData['sheets'][string]['cellData'] = {};

    for (const address of Object.keys(sheet)) {
      if (address.startsWith('!')) continue;

      const cell = sheet[address];
      const position = XLSX.utils.decode_cell(address);
      const univerCell = sheetCellToUniverCell(cell as XLSX.CellObject, workbookSheetNames);

      if (!cellData[position.r]) cellData[position.r] = {};
      cellData[position.r]![position.c] = univerCell;
    }

    sheets[sheetId] = {
      id: sheetId,
      name: sheetName,
      cellData,
      rowCount: Math.max((decodedRange?.e.r ?? 99) + 1, 100),
      columnCount: Math.max((decodedRange?.e.c ?? 25) + 1, 26),
    };
  });

  if (sheetOrder.length === 0) {
    sheetOrder.push('sheet-1');
    sheets['sheet-1'] = {
      id: 'sheet-1',
      name: 'Sheet1',
      cellData: {},
      rowCount: 100,
      columnCount: 26,
    };
  }

  return {
    id: workbookId,
    name: displayName,
    sheetOrder,
    sheets,
  };
}

function sheetCellToUniverCell(cell: XLSX.CellObject, workbookSheetNames: Set<string>): Record<string, unknown> {
  const result: Record<string, unknown> = {};

  if (cell.f) {
    const normalizedFormula = normalizeWorkbookLocalFormula(cell.f, workbookSheetNames);
    if (normalizedFormula) {
      result.f = normalizedFormula.startsWith('=') ? normalizedFormula : `=${normalizedFormula}`;
    }
  }

  if (cell.v instanceof Date) {
    result.v = cell.v.toISOString().slice(0, 10);
  } else if (cell.v !== undefined) {
    result.v = cell.v;
  }

  if (cell.t) {
    result.t = mapSheetJsType(cell.t);
  }

  if (shouldAttachNumberFormat(cell)) {
    result.s = {
      n: {
        pattern: cell.z,
      },
    };
  }

  return result;
}

function mapSheetJsType(type: string): number | undefined {
  switch (type) {
    case 'n':
      return 2;
    case 's':
    case 'str':
      return 1;
    case 'b':
      return 4;
    default:
      return undefined;
  }
}

function shouldAttachNumberFormat(cell: XLSX.CellObject): cell is XLSX.CellObject & { z: string } {
  return typeof cell.z === 'string' && cell.z.length > 0 && cell.t === 'n' && typeof cell.v === 'number';
}

function normalizeWorkbookLocalFormula(formula: string, workbookSheetNames: Set<string>): string | null {
  const normalized = formula
    .replace(/'\[(\d+)\]([^']+)'!/g, (match, _bookIndex, sheetName: string) => {
      return workbookSheetNames.has(sheetName) ? `'${sheetName}'!` : match;
    })
    .replace(/\[(\d+)\]([^'!]+)!/g, (match, _bookIndex, sheetName: string) => {
      return workbookSheetNames.has(sheetName) ? `${sheetName}!` : match;
    });

  // If the formula still points to an unresolved external indexed workbook,
  // keep the cached cell value and skip recalculation to avoid `#NAME?`.
  if (/\[\d+\][^!]+!/.test(normalized)) {
    return null;
  }

  return normalized;
}
