import Papa from 'papaparse';

export type FonteExpedicao = 'aduana' | 'auditoria';

export interface BaseDespachoRow {
  rotaOtimizada: string;
  rotaOriginal: string;
  doca: string;
  placa: string;
}

export interface ExpedicaoRow {
  pacote: string;
  rotaInformada: string;
  placaInformada: string;
  estado: string;
  detalhe: string;
  origem: FonteExpedicao;
  raw: Record<string, string>;
}

export interface ExpedicaoStore {
  base: BaseDespachoRow[];
  aduana: ExpedicaoRow[];
  auditoria: ExpedicaoRow[];
  updatedAt?: string;
  filenames?: Partial<Record<'base' | FonteExpedicao, string>>;
}

const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const key = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const id = (value: unknown) => clean(value).replace(/\D/g, '') || clean(value).toUpperCase();

function value(row: Record<string, unknown>, ...names: string[]) {
  const found = Object.keys(row).find(column => names.some(name => key(column) === key(name)));
  return found ? clean(row[found]) : '';
}

function csv(text: string) {
  return Papa.parse<Record<string, unknown>>(text, {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: header => clean(header),
  }).data;
}

export function parseBaseDespacho(text: string): BaseDespachoRow[] {
  const records = csv(text).map(row => ({
    rotaOtimizada: value(row, 'Rota otimizada'),
    rotaOriginal: value(row, 'Rota original'),
    doca: value(row, 'Doca'),
    placa: value(row, 'Placa'),
  })).filter(row => row.rotaOtimizada || row.rotaOriginal || row.placa);
  return Array.from(new Map(records.map(row => [`${key(row.rotaOtimizada)}|${key(row.rotaOriginal)}|${key(row.placa)}`, row])).values());
}

export function parseExpedicaoRows(text: string, origem: FonteExpedicao): ExpedicaoRow[] {
  const rows = csv(text).map(raw => {
    const pacote = id(value(raw, 'Shipment ID', 'ID do pacote', 'ID do pacote,', 'Pacote', 'ID'));
    const rotaInformada = value(raw, 'ID da rota', 'Rota', 'Rota sugerida');
    const placaInformada = value(raw, 'Placa');
    const estado = value(raw, 'Estado', 'Status de resolução', 'Status');
    const detalhe = origem === 'aduana'
      ? value(raw, 'Rep auditoria', 'Data auditoria')
      : value(raw, 'Problema', 'Motivo', 'Problem Solver');
    return { pacote, rotaInformada, placaInformada, estado, detalhe, origem, raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])) };
  }).filter(row => row.pacote);
  return Array.from(new Map(rows.map(row => [row.pacote, row])).values());
}

export interface EnrichedExpedicaoRow extends ExpedicaoRow {
  rotaOtimizada: string;
  doca: string;
  placa: string;
  classificacao: 'A mais' | 'Faltante' | 'Em ambos';
}

function routeCandidates(route: string) {
  const parts = clean(route).split('|').map(part => key(part)).filter(Boolean);
  return new Set([key(route), ...parts]);
}

export function enrichExpedicao(store: ExpedicaoStore): EnrichedExpedicaoRow[] {
  const byRoute = new Map<string, BaseDespachoRow>();
  const byPlate = new Map<string, BaseDespachoRow>();
  store.base.forEach(row => {
    [row.rotaOtimizada, row.rotaOriginal].forEach(route => routeCandidates(route).forEach(candidate => {
      if (candidate) byRoute.set(candidate, row);
    }));
    if (key(row.placa)) byPlate.set(key(row.placa), row);
  });
  const aduanaIds = new Set(store.aduana.map(row => row.pacote));
  const auditoriaIds = new Set(store.auditoria.map(row => row.pacote));
  return [...store.aduana, ...store.auditoria].map(row => {
    const base = Array.from(routeCandidates(row.rotaInformada)).map(candidate => byRoute.get(candidate)).find(Boolean)
      || byPlate.get(key(row.placaInformada));
    const inAduana = aduanaIds.has(row.pacote);
    const inAuditoria = auditoriaIds.has(row.pacote);
    return {
      ...row,
      rotaOtimizada: base?.rotaOtimizada || '',
      doca: base?.doca || '',
      placa: base?.placa || row.placaInformada,
      classificacao: inAduana && inAuditoria ? 'Em ambos' : inAduana ? 'A mais' : 'Faltante',
    };
  });
}
