import Papa from 'papaparse';

export interface HighValuePackage {
  pacote: string;
  valorBr: number | null;
  valorUsd: number | null;
}

export const HIGH_VALUE_LIMIT = 300;

const normalizeHeader = (text: string) => text.trim().replace(/^\uFEFF/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
export const normalizeHighValueId = (value: unknown): string => String(value ?? '').trim().replace(/\.0+$/, '').replace(/\s+/g, '').toUpperCase();

export function parseMoney(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  let raw = String(value ?? '').replace(/[^\d,.-]/g, '').trim();
  if (!raw || raw === '-') return null;
  const lastComma = raw.lastIndexOf(',');
  const lastDot = raw.lastIndexOf('.');
  if (lastComma >= 0 && lastDot >= 0) {
    raw = lastComma > lastDot ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastComma >= 0) {
    raw = /,\d{1,2}$/.test(raw) ? raw.replace(/\./g, '').replace(',', '.') : raw.replace(/,/g, '');
  } else if (lastDot >= 0) {
    raw = /\.\d{3}$/.test(raw) ? raw.replace(/\./g, '') : raw;
  }
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function isHighValue(item: HighValuePackage): boolean {
  // O valor em BRL é a referência; USD é usado quando o BRL não foi informado.
  return item.valorBr !== null ? item.valorBr > HIGH_VALUE_LIMIT : (item.valorUsd ?? 0) > HIGH_VALUE_LIMIT;
}

export function parseHighValueCsv(text: string): HighValuePackage[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => header.trim().replace(/^\uFEFF/, ''),
  });
  const headerNames = (result.meta.fields || []).map(normalizeHeader);
  const findField = (candidates: string[]) => (result.meta.fields || []).find(field => candidates.includes(normalizeHeader(field)));
  const idField = findField(['id', 'unitid', 'shipmentid', 'pacote', 'iddopacote']);
  const brField = findField(['valorbr', 'valorbrl', 'valorbrasileiro', 'valorreal', 'valorreais']);
  const usdField = findField(['valorusd', 'valordolar', 'valor$', 'usd']);
  if (!idField || (!brField && !usdField)) {
    throw new Error('CSV inválido: informe as colunas id, valor br e/ou valor usd.');
  }
  if (result.errors.some(error => error.code === 'MissingQuotes')) {
    throw new Error('CSV inválido: verifique as aspas e o separador.');
  }
  const entries = new Map<string, HighValuePackage>();
  result.data.forEach(row => {
    const pacote = normalizeHighValueId(row[idField]);
    if (!pacote) return;
    const valorBr = brField ? parseMoney(row[brField]) : null;
    const valorUsd = usdField ? parseMoney(row[usdField]) : null;
    if (valorBr === null && valorUsd === null) return;
    entries.set(pacote, { pacote, valorBr, valorUsd });
  });
  if (!entries.size) throw new Error('Nenhum ID com valor válido foi encontrado no CSV.');
  return [...entries.values()];
}

export function formatHighValue(item: HighValuePackage): string {
  const format = (number: number, currency: string) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(number);
  return [item.valorBr !== null ? format(item.valorBr, 'BRL') : null, item.valorUsd !== null ? format(item.valorUsd, 'USD') : null].filter(Boolean).join(' • ');
}
