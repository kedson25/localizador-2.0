import Papa from 'papaparse';

export interface DynamicCsvSource {
  id: string;
  name: string;
  fileName: string;
  columns: string[];
  rows: Record<string, string>[];
}
export interface SearchMapping { sourceId: string; searchColumn: string; returnColumns: string[] }
export interface CrossMapping { sourceAId: string; sourceAColumn: string; sourceBId: string; sourceBColumn: string; returnColumns: string[] }
export interface CsvTemplate { id: string; name: string; columns: string[]; searchColumn: string; returnColumns: string[]; sourceAColumns?: string[]; sourceAColumn?: string }
export const TEMPLATE_KEY = 'dynamic-csv-templates-v1';

export function parseDynamicCsv(text: string, fileName: string): DynamicCsvSource {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy', dynamicTyping: false });
  const errors = parsed.errors.filter(error => error.code !== 'UndetectableDelimiter');
  if (errors.length) throw new Error(`CSV inválido: ${errors[0].message}`);
  const [columns, ...data] = parsed.data;
  if (!columns?.length || columns.some(column => !column.trim())) throw new Error('O CSV precisa de um cabeçalho com nomes em todas as colunas.');
  if (new Set(columns).size !== columns.length) throw new Error('Existem nomes de colunas repetidos. Diferencie os cabeçalhos para mapear sem perder dados.');
  if (data.some(row => row.length !== columns.length)) throw new Error('Há linhas com quantidade de campos diferente do cabeçalho. Verifique o CSV.');
  return { id: crypto.randomUUID(), name: fileName, fileName, columns, rows: data.map(values => Object.fromEntries(columns.map((column, index) => [column, values[index]]))) };
}

export function indexSource(source: DynamicCsvSource, column: string) {
  if (!source.columns.includes(column)) throw new Error('Selecione uma coluna existente.');
  const index = new Map<string, Record<string, string>[]>();
  for (const row of source.rows) {
    const value = row[column];
    if (value === '') continue;
    const matches = index.get(value);
    if (matches) matches.push(row); else index.set(value, [row]);
  }
  return index;
}

export function crossSources(a: DynamicCsvSource, b: DynamicCsvSource, mapping: CrossMapping) {
  if (mapping.sourceAId !== a.id || mapping.sourceBId !== b.id || !a.columns.includes(mapping.sourceAColumn) || !mapping.returnColumns.length || mapping.returnColumns.some(column => !b.columns.includes(column))) throw new Error('Mapeamento inválido.');
  const index = indexSource(b, mapping.sourceBColumn);
  return a.rows.flatMap((row, sourceIndex) => {
    const value = row[mapping.sourceAColumn];
    const matches = index.get(value) || [];
    return matches.length ? matches.map(match => ({ value, sourceIndex, found: true, data: Object.fromEntries(mapping.returnColumns.map(column => [column, match[column]])) })) : [{ value, sourceIndex, found: false, data: {} as Record<string, string> }];
  });
}

export function sameColumns(a: string[], b: string[]) { return a.length === b.length && a.every(column => b.includes(column)); }
export function loadTemplates(): CsvTemplate[] {
  try {
    const value = JSON.parse(localStorage.getItem(TEMPLATE_KEY) || '[]');
    return Array.isArray(value) ? value.filter(item => item && typeof item.name === 'string' && Array.isArray(item.columns) && item.columns.every((v: unknown) => typeof v === 'string') && typeof item.searchColumn === 'string' && Array.isArray(item.returnColumns) && item.returnColumns.every((v: unknown) => typeof v === 'string')) : [];
  } catch { return []; }
}
