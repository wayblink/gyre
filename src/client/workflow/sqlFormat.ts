/**
 * SQL pretty-printer for the workflow page's SQL editors.
 *
 * Pure string helpers: they protect string literals, canonicalize keywords and clause spacing,
 * split top-level select lists / conditions and re-indent, then restore the literals. Keeping them
 * out of workflowPage.ts makes them unit-testable without booting the 4.5k-line page factory.
 */

export function normalizeWorkflowSqlText(sql: string): string {
  const protectedSql = protectSqlLiterals(sql.trim());
  if (!protectedSql.text) return '';

  let formatted = canonicalizeSqlKeywords(protectedSql.text)
    .replace(/\s+/g, ' ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s*([()])\s*/g, ' $1 ')
    .replace(/\s*([=<>!]+)\s*/g, ' $1 ')
    .replace(/\s+/g, ' ')
    .trim();

  formatted = formatted
    .replace(/\s+(WITH|SELECT|FROM|WHERE|GROUP BY|HAVING|ORDER BY|LIMIT|OFFSET|UNION ALL|UNION)\b/g, '\n$1')
    .replace(/\s+((?:LEFT|RIGHT|INNER|FULL|CROSS)\s+JOIN|JOIN)\b/g, '\n$1')
    .replace(/\s+(ON)\b/g, '\n$1');

  formatted = formatSqlClauseLines(formatted);
  formatted = indentSqlLines(formatted);
  return restoreSqlLiterals(formatted, protectedSql.parts);
}

function protectSqlLiterals(sql: string): { text: string; parts: string[] } {
  const parts: string[] = [];
  const placeholderPrefix = '__GYRE_SQL_PART_';
  let text = '';
  for (let index = 0; index < sql.length; index += 1) {
    const char = sql[index];
    if (char === "'" || char === '"' || char === '`') {
      const quote = char;
      let part = quote;
      index += 1;
      while (index < sql.length) {
        const next = sql[index];
        part += next;
        if (next === quote) {
          if (sql[index + 1] === quote) {
            part += sql[index + 1];
            index += 2;
            continue;
          }
          break;
        }
        index += 1;
      }
      text += `${placeholderPrefix}${parts.length}__`;
      parts.push(part);
      continue;
    }
    if (char === '[') {
      let part = char;
      index += 1;
      while (index < sql.length) {
        const next = sql[index];
        part += next;
        if (next === ']') break;
        index += 1;
      }
      text += `${placeholderPrefix}${parts.length}__`;
      parts.push(part);
      continue;
    }
    text += char;
  }
  return { text, parts };
}

function restoreSqlLiterals(sql: string, parts: string[]): string {
  let restored = sql;
  parts.forEach((part, index) => {
    restored = restored.replace(new RegExp(`__GYRE_SQL_PART_${index}__`, 'g'), part);
  });
  return restored;
}

function canonicalizeSqlKeywords(sql: string): string {
  const replacements: Array<[RegExp, string]> = [
    [/\bunion\s+all\b/gi, 'UNION ALL'],
    [/\bgroup\s+by\b/gi, 'GROUP BY'],
    [/\border\s+by\b/gi, 'ORDER BY'],
    [/\bleft\s+join\b/gi, 'LEFT JOIN'],
    [/\bright\s+join\b/gi, 'RIGHT JOIN'],
    [/\binner\s+join\b/gi, 'INNER JOIN'],
    [/\bfull\s+join\b/gi, 'FULL JOIN'],
    [/\bcross\s+join\b/gi, 'CROSS JOIN'],
    [/\bselect\b/gi, 'SELECT'],
    [/\bdistinct\b/gi, 'DISTINCT'],
    [/\bfrom\b/gi, 'FROM'],
    [/\bwhere\b/gi, 'WHERE'],
    [/\bhaving\b/gi, 'HAVING'],
    [/\blimit\b/gi, 'LIMIT'],
    [/\boffset\b/gi, 'OFFSET'],
    [/\bunion\b/gi, 'UNION'],
    [/\bjoin\b/gi, 'JOIN'],
    [/\bon\b/gi, 'ON'],
    [/\bas\b/gi, 'AS'],
    [/\band\b/gi, 'AND'],
    [/\bor\b/gi, 'OR'],
    [/\bcase\b/gi, 'CASE'],
    [/\bwhen\b/gi, 'WHEN'],
    [/\bthen\b/gi, 'THEN'],
    [/\belse\b/gi, 'ELSE'],
    [/\bend\b/gi, 'END'],
    [/\bnull\b/gi, 'NULL'],
    [/\bis\b/gi, 'IS'],
    [/\bnot\b/gi, 'NOT'],
    [/\bin\b/gi, 'IN'],
  ];
  return replacements.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), sql);
}

function splitSqlTopLevelList(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  for (const char of text) {
    if (char === '(') depth += 1;
    if (char === ')') depth = Math.max(0, depth - 1);
    if (char === ',' && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function splitSqlTopLevelConditions(text: string): string[] {
  const parts: string[] = [];
  let current = '';
  let depth = 0;
  const words = text.split(' ');
  for (const word of words) {
    for (const char of word) {
      if (char === '(') depth += 1;
      if (char === ')') depth = Math.max(0, depth - 1);
    }
    if ((word === 'AND' || word === 'OR') && depth === 0 && current.trim()) {
      parts.push(current.trim());
      current = word;
      continue;
    }
    current = current ? `${current} ${word}` : word;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

function formatSqlExpressionList(prefix: string, body: string): string[] {
  const items = splitSqlTopLevelList(body);
  if (items.length <= 1) return [prefix, `  ${body}`];
  return [prefix, ...items.map((item, index) => `  ${item}${index < items.length - 1 ? ',' : ''}`)];
}

function formatSqlCondition(prefix: string, body: string): string[] {
  const parts = splitSqlTopLevelConditions(body);
  if (parts.length <= 1) return [`${prefix} ${body}`.trim()];
  return [prefix, ...parts.map((part) => `  ${part}`)];
}

function formatSqlClauseLines(sql: string): string {
  const lines: string[] = [];
  for (const rawLine of sql.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;

    const selectMatch = line.match(/^SELECT\s+(.+)$/);
    if (selectMatch) {
      lines.push(...formatSqlExpressionList('SELECT', selectMatch[1]));
      continue;
    }

    const listMatch = line.match(/^(GROUP BY|ORDER BY)\s+(.+)$/);
    if (listMatch) {
      lines.push(...formatSqlExpressionList(listMatch[1], listMatch[2]));
      continue;
    }

    const conditionMatch = line.match(/^(WHERE|HAVING|ON)\s+(.+)$/);
    if (conditionMatch) {
      lines.push(...formatSqlCondition(conditionMatch[1], conditionMatch[2]));
      continue;
    }

    lines.push(line);
  }
  return lines.join('\n');
}

function indentSqlLines(sql: string): string {
  let depth = 0;
  return sql
    .split('\n')
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => {
      const trimmed = line.trimStart();
      const leadingCloseParens = trimmed.match(/^\)+/)?.[0].length ?? 0;
      const extraIndent = line.startsWith('  ') ? 1 : 0;
      const indentDepth = Math.max(0, depth - leadingCloseParens) + extraIndent;
      const formatted = `${'  '.repeat(indentDepth)}${trimmed}`;
      const opens = (trimmed.match(/\(/g) ?? []).length;
      const closes = (trimmed.match(/\)/g) ?? []).length;
      depth = Math.max(0, depth + opens - closes);
      return formatted;
    })
    .join('\n')
    .trim();
}
