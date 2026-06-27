import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import * as XLSX from 'xlsx';

type CreateWorkbookViewerOptions = {
  container: HTMLElement;
  workbookData: object;
};

export function createWorkbookViewer({ container, workbookData }: CreateWorkbookViewerOptions) {
  const { univer, univerAPI } = createUniver({
    locale: LocaleType.ZH_CN,
    locales: {
      [LocaleType.ZH_CN]: mergeLocales(sheetsCoreZhCN),
    },
    presets: [
      UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: true,
        formulaBar: true,
        footer: {
          sheetBar: true,
          statisticBar: true,
          zoomSlider: true,
        },
      }),
    ],
  });

  univerAPI.createWorkbook(workbookData);

  return {
    exportXlsxBlob() {
      return snapshotToXlsxBlob(univerAPI);
    },
    dispose() {
      univer.dispose();
    },
  };
}

function snapshotToXlsxBlob(univerAPI: any): Blob | null {
  try {
    const workbook = univerAPI.getActiveWorkbook?.();
    if (!workbook) return null;

    const snapshot = workbook.getSnapshot?.() ?? workbook.save?.();
    if (!snapshot) return null;

    const out = XLSX.utils.book_new();
    const sheetOrder: string[] = Array.isArray(snapshot.sheetOrder)
      ? snapshot.sheetOrder
      : Object.keys(snapshot.sheets || {});

    for (const sheetId of sheetOrder) {
      const sheet = snapshot.sheets?.[sheetId];
      if (!sheet) continue;

      const worksheet: XLSX.WorkSheet = {};
      const cellData = sheet.cellData || {};
      let minRow = Infinity;
      let minCol = Infinity;
      let maxRow = -Infinity;
      let maxCol = -Infinity;

      for (const [rowKey, row] of Object.entries(cellData)) {
        const rowIndex = Number(rowKey);
        for (const [colKey, cell] of Object.entries(row as Record<string, any>)) {
          const colIndex = Number(colKey);
          const xlsxCell: XLSX.CellObject = {} as XLSX.CellObject;

          if (cell?.f) {
            const formula = String(cell.f);
            xlsxCell.f = formula.startsWith('=') ? formula.slice(1) : formula;
          }

          if (cell?.v !== undefined && cell?.v !== null) {
            xlsxCell.v = cell.v;
            xlsxCell.t =
              typeof cell.v === 'number' ? 'n' : typeof cell.v === 'boolean' ? 'b' : 's';
          } else if (xlsxCell.f) {
            xlsxCell.t = 'n';
          }

          if (xlsxCell.v !== undefined || xlsxCell.f) {
            worksheet[XLSX.utils.encode_cell({ r: rowIndex, c: colIndex })] = xlsxCell;
            if (rowIndex < minRow) minRow = rowIndex;
            if (rowIndex > maxRow) maxRow = rowIndex;
            if (colIndex < minCol) minCol = colIndex;
            if (colIndex > maxCol) maxCol = colIndex;
          }
        }
      }

      worksheet['!ref'] =
        minRow === Infinity
          ? 'A1'
          : XLSX.utils.encode_range({
              s: { r: minRow, c: minCol },
              e: { r: maxRow, c: maxCol },
            });

      XLSX.utils.book_append_sheet(out, worksheet, String(sheet.name || sheetId).slice(0, 31));
    }

    const buffer = XLSX.write(out, {
      type: 'array',
      bookType: 'xlsx',
    });

    return new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
  } catch (error) {
    console.error('Failed to export workbook snapshot', error);
    return null;
  }
}
