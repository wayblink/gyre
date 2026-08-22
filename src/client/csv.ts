const SPREADSHEET_FORMULA_PREFIX = /^\s*[=+\-@]/;

export function escapeCsvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const safeText = SPREADSHEET_FORMULA_PREFIX.test(text) ? `'${text}` : text;
  if (!/[",\r\n]/.test(safeText)) return safeText;
  return `"${safeText.replace(/"/g, '""')}"`;
}

export function csvRow(values: unknown[]): string {
  return values.map(escapeCsvCell).join(',');
}
