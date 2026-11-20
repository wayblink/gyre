import { createUniver, LocaleType, mergeLocales } from '@univerjs/presets';
import { UniverSheetsCorePreset } from '@univerjs/preset-sheets-core';
import sheetsCoreZhCN from '@univerjs/preset-sheets-core/locales/zh-CN';
import sheetsCoreEnUS from '@univerjs/preset-sheets-core/locales/en-US';
import { UniverSheetsFindReplacePreset } from '@univerjs/preset-sheets-find-replace';
import sheetsFindReplaceZhCN from '@univerjs/preset-sheets-find-replace/locales/zh-CN';
import sheetsFindReplaceEnUS from '@univerjs/preset-sheets-find-replace/locales/en-US';
import type { AppLanguage } from '../i18n.js';
import { createWorkbookCellDetail, type CellDetailSource, type WorkbookCellDetail } from './workbookCellDetail.js';
import * as XLSX from 'xlsx';
import '@univerjs/design/lib/index.css';
import '@univerjs/ui/lib/index.css';
import '@univerjs/sheets-ui/lib/index.css';

export type WorkbookSearchResult = { total: number; index: number };

type WorkbookMatch = { getA1Notation?: () => string; activate?: () => void };

type WorkbookTextFinder = {
  findAll: () => WorkbookMatch[];
  getCurrentMatch: () => WorkbookMatch | null;
};

type CreateWorkbookViewerOptions = {
  container: HTMLElement;
  workbookData: object;
  readOnly?: boolean;
  /** Univer ships its own UI copy (context menus, sheet tabs, toolbar), so it needs the same language. */
  language?: AppLanguage;
};

export function createWorkbookViewer({
  container,
  workbookData,
  readOnly = false,
  language = 'zh-CN',
}: CreateWorkbookViewerOptions) {
  const univerLocale = language === 'en-US' ? LocaleType.EN_US : LocaleType.ZH_CN;
  const coreLocale = language === 'en-US' ? sheetsCoreEnUS : sheetsCoreZhCN;
  const findReplaceLocale = language === 'en-US' ? sheetsFindReplaceEnUS : sheetsFindReplaceZhCN;
  const { univer, univerAPI } = createUniver({
    locale: univerLocale,
    locales: {
      [univerLocale]: mergeLocales(coreLocale, findReplaceLocale),
    },
    presets: [
      UniverSheetsFindReplacePreset(),
      UniverSheetsCorePreset({
        container,
        header: true,
        toolbar: !readOnly,
        formulaBar: true,
        footer: {
          sheetBar: true,
          statisticBar: true,
          zoomSlider: true,
        },
      }),
    ],
  });

  let workbookFinder: WorkbookTextFinder | null = null;
  let workbookMatches: WorkbookMatch[] = [];
  let workbookMatchIndex = -1;

  function clearWorkbookSearch() {
    // The find plugin paints its matches onto the sheet, and dropping our references is not enough
    // to repaint it: disposing the model (the only handle the facade gives us) removes the marks.
    try {
      (workbookFinder as unknown as { _model?: { dispose?: () => void } } | null)?._model?.dispose?.();
    } catch (error) {
      console.error('Failed to clear the workbook find highlights', error);
    }
    workbookFinder = null;
    workbookMatches = [];
    workbookMatchIndex = -1;
  }

  let cellDetail: WorkbookCellDetail | null = null;
  univerAPI.createWorkbook(workbookData);
  if (readOnly) {
    void applyReadOnlyPermission(univerAPI);
    // Read-only mode blocks the cell editor and answers with a "range is protected" dialog, so the
    // exact value behind a number format has no way out. The card takes over the double-click.
    cellDetail = createWorkbookCellDetail({
      container,
      language,
      readActiveCell: () => readActiveCell(univerAPI),
    });
  }

  return {
    /**
     * Search the active sheet for `query`, returning how many cells matched and which one (1-based)
     * is current. The first call after a workbook mounts can come back empty because the sheet's
     * find provider indexes asynchronously, so an empty result is retried briefly before giving up.
     */
    async searchWorkbook(query: string): Promise<WorkbookSearchResult> {
      clearWorkbookSearch();
      const text = query.trim();
      if (!text) return { total: 0, index: 0 };
      const createFinder = (
        univerAPI as unknown as {
          createTextFinderAsync?: (text: string) => Promise<WorkbookTextFinder | null>;
        }
      ).createTextFinderAsync;
      if (!createFinder) return { total: 0, index: 0 };
      workbookFinder = await createFinder.call(univerAPI, text);
      let found = workbookFinder?.findAll() ?? [];
      for (let attempt = 0; attempt < 6 && !found.length; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 100));
        found = workbookFinder?.findAll() ?? [];
      }
      workbookMatches = found;
      if (!workbookMatches.length) return { total: 0, index: 0 };
      workbookMatchIndex = 0;
      workbookMatches[0]?.activate?.();
      return { total: workbookMatches.length, index: 1 };
    },
    /** Move to the next/previous match, wrapping like Excel's find. */
    stepWorkbookSearch(direction: 1 | -1): WorkbookSearchResult {
      const total = workbookMatches.length;
      if (!total) return { total: 0, index: 0 };
      workbookMatchIndex = (workbookMatchIndex + direction + total) % total;
      workbookMatches[workbookMatchIndex]?.activate?.();
      return { total, index: workbookMatchIndex + 1 };
    },
    clearWorkbookSearch,
    exportXlsxBlob() {
      return snapshotToXlsxBlob(univerAPI);
    },
    dispose() {
      cellDetail?.dispose();
      univer.dispose();
    },
  };
}

async function applyReadOnlyPermission(univerAPI: any) {
  try {
    const permission = univerAPI.getActiveWorkbook?.()?.getWorkbookPermission?.();
    if (!permission?.setReadOnly) return;
    await permission.setReadOnly();
  } catch (error) {
    console.error('Failed to switch workbook into read-only mode', error);
  }
}

/** The cell under the selection, in the shape the read-only detail card renders. */
function readActiveCell(univerAPI: any): CellDetailSource | null {
  try {
    const workbook = univerAPI.getActiveWorkbook?.();
    const sheet = workbook?.getActiveSheet?.();
    const cell = sheet?.getActiveCell?.();
    if (!sheet || !cell) return null;
    const address = cell.getA1Notation?.() ?? '';
    if (!address) return null;
    return {
      sheetName: sheet.getSheetName?.() ?? '',
      address,
      rawValue: cell.getRawValue?.(),
      formula: cell.getFormula?.(),
      numberPattern: readCellNumberPattern(workbook, sheet, cell),
    };
  } catch (error) {
    console.error('Failed to read the selected cell', error);
    return null;
  }
}

/** The stored number format (`#,##0`); the workbook snapshot is the only facade handle on it. */
function readCellNumberPattern(workbook: any, sheet: any, cell: any): string {
  try {
    const range = cell.getRange?.();
    const sheetData = workbook?.getSnapshot?.()?.sheets?.[sheet.getSheetId?.()];
    const pattern = sheetData?.cellData?.[range?.startRow]?.[range?.startColumn]?.s?.n?.pattern;
    return typeof pattern === 'string' ? pattern : '';
  } catch {
    return '';
  }
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
            xlsxCell.t = typeof cell.v === 'number' ? 'n' : typeof cell.v === 'boolean' ? 'b' : 's';
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
