import Papa from 'papaparse';

export type FonteExpedicao = 'aduana' | 'auditoria';

export interface BaseDespachoRow {
  pacote: string;
  onda: string;
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
  localizados?: Record<string, boolean>;
  historico?: ExpedicaoHistorico[];
  encerramentos?: ExpedicaoEncerramento[];
  updatedAt?: string;
  filenames?: Partial<Record<'base' | FonteExpedicao, string>>;
}

export interface ExpedicaoHistorico {
  pacote: string;
  origem: FonteExpedicao;
  tipo: 'novo' | 'alterado';
  estado: string;
  estadoAnterior?: string;
  registradoEm: string;
}

export interface ExpedicaoEncerramento {
  id: string;
  encerradoEm: string;
  amais: number;
  faltantes: number;
  localizados: number;
  porDoca: Array<{ doca: string; amais: number; faltantes: number }>;
}

export function getChanges(previous: ExpedicaoRow[], next: ExpedicaoRow[], origem: FonteExpedicao): ExpedicaoHistorico[] {
  const recordKey = (row: ExpedicaoRow) => `${row.pacote}|${key(row.rotaInformada)}`;
  const old = new Map(previous.map(row => [recordKey(row), row]));
  const now = new Date().toISOString();
  return next.flatMap(row => {
    const before = old.get(recordKey(row));
    if (!before) return [{ pacote: row.pacote, origem, tipo: 'novo' as const, estado: row.estado, registradoEm: now }];
    if (key(before.estado) !== key(row.estado) || key(before.rotaInformada) !== key(row.rotaInformada)) return [{ pacote: row.pacote, origem, tipo: 'alterado' as const, estado: row.estado, estadoAnterior: before.estado, registradoEm: now }];
    return [];
  });
}

const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const key = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const id = (value: unknown) => clean(value).replace(/\D/g, '') || clean(value).toUpperCase();
const isErrorState = (value: string) => {
  const normalized = key(value);
  return normalized.includes('a mais') || normalized.includes('amais') || normalized.includes('faltante');
};

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
    pacote: id(value(
      row,
      'Shipment ID',
      'Shipment',
      'shipment_id',
      'ID do pacote',
      'ID do pacote,',
      'Pacote',
      'ID da remessa',
      'ID do envio',
      'ID de envio',
      'ID',
    )),
    onda: value(row, 'Onda'),
    rotaOtimizada: value(row, 'Rota otimizada'),
    rotaOriginal: value(row, 'Rota original'),
    doca: value(row, 'Doca'),
    placa: value(row, 'Placa'),
  })).filter(row => row.pacote || row.rotaOtimizada || row.rotaOriginal || row.placa);

  return Array.from(new Map(records.map(row => [
    `${row.pacote}|${key(row.rotaOtimizada)}|${key(row.rotaOriginal)}|${key(row.placa)}`,
    row,
  ])).values());
}

export function parseExpedicaoRows(text: string, origem: FonteExpedicao): ExpedicaoRow[] {
  const rows = csv(text).map(raw => {
    const pacote = id(value(raw, 'Shipment ID', 'ID do pacote', 'ID do pacote,', 'Pacote', 'ID'));
    const rotaInformada = value(raw, 'ID da rota', 'Rota', 'Rota sugerida', 'Contenedor');
    const placaInformada = value(raw, 'Placa');
    const estado = value(raw, 'Estado', 'Status de resolução', 'Status');
    const detalhe = origem === 'aduana'
      ? value(raw, 'Rep auditoria', 'Data auditoria')
      : value(raw, 'Problema', 'Motivo', 'Problem Solver');
    return { pacote, rotaInformada, placaInformada, estado, detalhe, origem, raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])) };
  }).filter(row => row.pacote && isErrorState(row.estado));
  return Array.from(new Map(rows.map(row => [`${row.pacote}|${key(row.rotaInformada)}|${key(row.estado)}`, row])).values());
}

export interface EnrichedExpedicaoRow extends ExpedicaoRow {
  onda: string;
  rotaOtimizada: string;
  doca: string;
  placa: string;
  classificacao: 'A mais' | 'Faltante' | 'Em ambos';
}

function routeCandidates(route: string) {
  const parts = clean(route).split('|').map(part => key(part)).filter(Boolean);
  return new Set([key(route), ...parts]);
}

function classificationFromEstado(estado: string): EnrichedExpedicaoRow['classificacao'] | null {
  const normalized = key(estado);
  if (normalized.includes('a mais') || normalized.includes('amais')) return 'A mais';
  if (normalized.includes('faltante')) return 'Faltante';
  return null;
}

export function enrichExpedicao(store: ExpedicaoStore): EnrichedExpedicaoRow[] {
  const byPackage = new Map<string, BaseDespachoRow>();
  const byRoute = new Map<string, BaseDespachoRow>();
  const byPlate = new Map<string, BaseDespachoRow>();

  store.base.forEach(row => {
    if (row.pacote) byPackage.set(row.pacote, row);
    [row.rotaOtimizada, row.rotaOriginal].forEach(route => routeCandidates(route).forEach(candidate => {
      if (candidate) byRoute.set(candidate, row);
    }));
    if (key(row.placa)) byPlate.set(key(row.placa), row);
  });

  const aduanaIds = new Set(store.aduana.map(row => row.pacote));
  const auditoriaIds = new Set(store.auditoria.map(row => row.pacote));

  return [...store.aduana, ...store.auditoria].map(row => {
    // O ID do pacote é a fonte mais confiável para descobrir onde ele deveria estar.
    // Isso é essencial para itens "A mais", pois a rota/placa informada pode ser justamente a errada.
    const base = byPackage.get(row.pacote)
      || Array.from(routeCandidates(row.rotaInformada)).map(candidate => byRoute.get(candidate)).find(Boolean)
      || byPlate.get(key(row.placaInformada));
    const inAduana = aduanaIds.has(row.pacote);
    const inAuditoria = auditoriaIds.has(row.pacote);
    // Na Aduana, "Estado" é o apontamento oficial do auditor. A comparação
    // entre as duas abas só é usada quando o arquivo não traz esse campo.
    const classificationFromFile = classificationFromEstado(row.estado);
    return {
      ...row,
      onda: base?.onda || '',
      rotaOtimizada: base?.rotaOtimizada || '',
      doca: base?.doca || '',
      placa: base?.placa || row.placaInformada,
      classificacao: classificationFromFile || (inAduana && inAuditoria ? 'Em ambos' : inAduana ? 'A mais' : 'Faltante'),
    };
  });
}
