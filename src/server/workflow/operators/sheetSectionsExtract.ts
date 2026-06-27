import { defineWorkflowOperator, normalizeWorkflowTaskDependencies } from './types.js';

type SheetSectionConfig = {
  key: string;
  title?: string;
  range: string;
  headerRow?: number | null;
};

function normalizeSectionConfig(raw: unknown, index: number): SheetSectionConfig | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const key = String(record.key ?? record.title ?? `section_${index + 1}`).trim() || `section_${index + 1}`;
  const title = String(record.title ?? '').trim();
  const range = String(record.range ?? '').trim();
  const rawHeaderRow = record.headerRow;
  const headerRow =
    typeof rawHeaderRow === 'number' && Number.isFinite(rawHeaderRow)
      ? rawHeaderRow
      : rawHeaderRow === null || rawHeaderRow === undefined || rawHeaderRow === ''
        ? null
        : Number(rawHeaderRow);

  if (!range) return null;
  return {
    key,
    title,
    range,
    headerRow: Number.isFinite(headerRow) ? headerRow : null,
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

export const sheetSectionsExtractOperator = defineWorkflowOperator({
  code: 'sheet.sections.extract',
  name: 'Excel Sections Extract',
  version: '1.0.0',
  category: 'Input',
  description: '从同一个 Excel Sheet 中提取多个不连续区块，合并为一个 dataframe，并附带区块元数据。',
  inputSlots: [],
  outputSlots: [{ slot: 'dataframe', type: 'table', contentType: 'application/json', label: 'DataFrame' }],
  paramsSchema: {
    fileId: { type: 'number', label: '文件 ID', required: true, default: null },
    sheetName: { type: 'string', label: 'Sheet 名称', required: true, default: '' },
    sections: {
      type: 'array',
      label: 'Sections',
      required: true,
      default: [{ key: 'section_1', title: 'Section 1', range: '', headerRow: null }],
    },
    sectionColumn: { type: 'string', label: '区块列名', required: false, default: 'section' },
    sectionIndexColumn: { type: 'string', label: '区块序号列名', required: false, default: 'sectionIndex' },
    sourceRangeColumn: { type: 'string', label: '来源范围列名', required: false, default: 'sourceRange' },
  },
  normalizeTask(task) {
    task.inputs = {};
    normalizeWorkflowTaskDependencies(task);
  },
  async execute({ task, runtime }) {
    const fileId = typeof task.params.fileId === 'number' && Number.isFinite(task.params.fileId) ? task.params.fileId : null;
    const sheetName = String(task.params.sheetName ?? '').trim();
    const sections = normalizeSections(task.params.sections);

    if (!fileId) throw new Error(`Task ${task.name} is missing fileId`);
    if (!sheetName) throw new Error(`Task ${task.name} requires sheetName`);
    if (!sections.length) throw new Error(`Task ${task.name} requires at least one section with a range`);

    const sectionColumn = metadataColumnName(task.params.sectionColumn, 'section');
    const sectionIndexColumn = metadataColumnName(task.params.sectionIndexColumn, 'sectionIndex');
    const sourceRangeColumn = metadataColumnName(task.params.sourceRangeColumn, 'sourceRange');

    const buffer = await runtime.getProductFileBufferById(fileId);
    const rows: Array<Record<string, unknown>> = [];
    const sourceRanges: string[] = [];

    sections.forEach((section, index) => {
      try {
        const dataframe = runtime.extractSheetRangeAsDataFrame(buffer, sheetName, {
          range: section.range,
          headerRow: section.headerRow ?? null,
        });
        sourceRanges.push(dataframe.range.a1Range);
        dataframe.rows.forEach((row) => {
          rows.push({
            ...row,
            [sectionColumn]: section.title || section.key,
            [sectionIndexColumn]: index + 1,
            [sourceRangeColumn]: dataframe.range.a1Range,
          });
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Section ${section.key || index + 1} extraction failed: ${message}`);
      }
    });

    return runtime.rowsToDataFrame(rows, {
      sheetName,
      a1Range: sourceRanges.join(', '),
    });
  },
});
