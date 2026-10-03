import Papa from 'papaparse';

export type FonteExpedicao = 'aduana' | 'auditoria';
export type FonteImportacaoExpedicao = 'base' | FonteExpedicao;

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
  dataRegistro: string;
  origem: FonteExpedicao;
  raw: Record<string, string>;
}

export interface ExpedicaoHistorico {
  pacote: string;
  origem: FonteExpedicao;
  tipo: 'novo' | 'alterado' | 'removido';
  estado: string;
  estadoAnterior?: string;
  registradoEm: string;
}

export type TipoMudancaDoca =
  | 'nova_placa'
  | 'placa_removida'
  | 'troca_placa'
  | 'novo_erro'
  | 'erro_removido'
  | 'erro_alterado'
  | 'mudou_doca';

export interface ExpedicaoDocaChange {
  id: string;
  tipo: TipoMudancaDoca;
  fonte: FonteImportacaoExpedicao;
  doca: string;
  docaAnterior?: string;
  pacote?: string;
  placa?: string;
  placaAnterior?: string;
  classificacao?: 'A mais' | 'Faltante';
  classificacaoAnterior?: 'A mais' | 'Faltante';
  mensagem: string;
  registradoEm: string;
}

export interface ExpedicaoImportacao {
  fonte: FonteImportacaoExpedicao;
  arquivo: string;
  registradoEm: string;
  alteracoes: number;
}

export interface ExpedicaoStore {
  base: BaseDespachoRow[];
  aduana: ExpedicaoRow[];
  auditoria: ExpedicaoRow[];
  localizados?: Record<string, boolean>;
  historico?: ExpedicaoHistorico[];
  historicoDoca?: ExpedicaoDocaChange[];
  ultimaComparacao?: ExpedicaoDocaChange[];
  ultimaImportacao?: ExpedicaoImportacao;
  encerramentos?: ExpedicaoEncerramento[];
  updatedAt?: string;
  filenames?: Partial<Record<FonteImportacaoExpedicao, string>>;
}

export interface ExpedicaoEncerramento {
  id: string;
  encerradoEm: string;
  amais: number;
  faltantes: number;
  localizados: number;
  porDoca: Array<{ doca: string; amais: number; faltantes: number }>;
}

const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const key = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const id = (value: unknown) => {
  const text = clean(value).replace(/\.0+$/, '');
  return text.replace(/\D/g, '') || text.toUpperCase();
};
const plateKey = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const normalizeDock = (value: unknown) => {
  const text = clean(value);
  const match = text.match(/\d+/);
  return match ? String(Number(match[0])) : text;
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

function dateScore(value: string) {
  const text = clean(value);
  if (!text) return 0;

  const br = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, day, month, year, hour = '0', minute = '0', second = '0'] = br;
    return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).getTime();
  }

  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function classificationFromEstado(estado: string): 'A mais' | 'Faltante' | null {
  const normalized = key(estado);
  if (normalized.includes('a mais') || normalized.includes('amais')) return 'A mais';
  if (normalized.includes('faltante')) return 'Faltante';
  return null;
}

function dedupeLatestByPackage(rows: ExpedicaoRow[]) {
  const result = new Map<string, ExpedicaoRow>();

  rows.forEach(row => {
    const current = result.get(row.pacote);
    if (!current || dateScore(row.dataRegistro) >= dateScore(current.dataRegistro)) {
      result.set(row.pacote, row);
    }
  });

  return Array.from(result.values());
}

export function parseBaseDespacho(text: string): BaseDespachoRow[] {
  const records = csv(text).map(row => ({
    pacote: id(value(
      row,
      'Shipment ID',
      'Shipment',
      'shipment_id',
      'ID do pacote',
      'Pacote',
      'ID da remessa',
      'ID do envio',
      'ID de envio',
      'ID',
    )),
    onda: value(row, 'Onda'),
    rotaOtimizada: value(row, 'Rota otimizada', 'Rota Otimizada'),
    rotaOriginal: value(row, 'Rota original', 'Rota Original'),
    doca: normalizeDock(value(row, 'Doca')),
    placa: clean(value(row, 'Placa')).toUpperCase(),
  })).filter(row => row.pacote || row.rotaOtimizada || row.rotaOriginal || row.placa);

  return Array.from(new Map(records.map(row => [
    `${row.pacote}|${key(row.rotaOtimizada)}|${key(row.rotaOriginal)}|${plateKey(row.placa)}|${row.doca}|${key(row.onda)}`,
    row,
  ])).values());
}

export function parseExpedicaoRows(text: string, origem: FonteExpedicao): ExpedicaoRow[] {
  const rows = csv(text).map(raw => {
    const pacote = id(value(raw, 'Shipment ID', 'ID do pacote', 'ID do pacote,', 'Pacote', 'ID'));
    const rotaInformada = value(raw, 'ID da rota', 'Rota', 'Rota sugerida', 'Contenedor');
    const placaInformada = clean(value(raw, 'Placa')).toUpperCase();
    const estado = value(raw, 'Estado', 'Status de resolução', 'Status');
    const dataRegistro = value(raw, 'Data auditoria', 'Data da auditoria', 'Data/Hora', 'Data hora', 'Timestamp', 'Data');
    const detalhe = origem === 'aduana'
      ? value(raw, 'Rep auditoria', 'Responsável', 'Data auditoria')
      : value(raw, 'Rep auditoria', 'Problema', 'Motivo', 'Problem Solver');

    return {
      pacote,
      rotaInformada,
      placaInformada,
      estado,
      detalhe,
      dataRegistro,
      origem,
      raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])),
    };
  }).filter(row => row.pacote);

  return dedupeLatestByPackage(rows);
}

export function getChanges(previous: ExpedicaoRow[], next: ExpedicaoRow[], origem: FonteExpedicao): ExpedicaoHistorico[] {
  const old = new Map(previous.map(row => [row.pacote, row]));
  const current = new Map(next.map(row => [row.pacote, row]));
  const now = new Date().toISOString();
  const changes: ExpedicaoHistorico[] = [];

  current.forEach(row => {
    const before = old.get(row.pacote);
    if (!before) {
      changes.push({ pacote: row.pacote, origem, tipo: 'novo', estado: row.estado, registradoEm: now });
      return;
    }

    if (
      key(before.estado) !== key(row.estado)
      || key(before.rotaInformada) !== key(row.rotaInformada)
      || plateKey(before.placaInformada) !== plateKey(row.placaInformada)
    ) {
      changes.push({
        pacote: row.pacote,
        origem,
        tipo: 'alterado',
        estado: row.estado,
        estadoAnterior: before.estado,
        registradoEm: now,
      });
    }
  });

  old.forEach(row => {
    if (!current.has(row.pacote)) {
      changes.push({
        pacote: row.pacote,
        origem,
        tipo: 'removido',
        estado: '',
        estadoAnterior: row.estado,
        registradoEm: now,
      });
    }
  });

  return changes;
}

export interface EnrichedExpedicaoRow extends ExpedicaoRow {
  onda: string;
  rotaOtimizada: string;
  doca: string;
  placa: string;
  classificacao: 'A mais' | 'Faltante';
  encontradoRota: string;
  encontradoPlaca: string;
  destinoRota: string;
  destinoDoca: string;
  destinoOnda: string;
}

/**
 * Regra operacional da Expedição:
 * - Auditoria representa ONDE o pacote foi encontrado (placa + ID da rota).
 * - A placa da Auditoria é cruzada com a Base Despacho.
 * - O resultado da Base Despacho representa ONDE o pacote DEVERIA estar
 *   (doca + rota otimizada + onda).
 * - Quando não existe Auditoria para o ID, Aduana é usada como fallback.
 * - Cada Shipment ID aparece uma única vez.
 */
export function enrichExpedicao(store: ExpedicaoStore): EnrichedExpedicaoRow[] {
  const byPlate = new Map<string, BaseDespachoRow>();

  // Mantém o mesmo comportamento de uma busca do tipo XLOOKUP: primeira placa válida vence.
  store.base.forEach(row => {
    const normalizedPlate = plateKey(row.placa);
    if (normalizedPlate && !byPlate.has(normalizedPlate)) byPlate.set(normalizedPlate, row);
  });

  const aduanaById = new Map(store.aduana.map(row => [row.pacote, row]));
  const auditoriaById = new Map(store.auditoria.map(row => [row.pacote, row]));
  const allIds = new Set([...aduanaById.keys(), ...auditoriaById.keys()]);
  const result: EnrichedExpedicaoRow[] = [];

  allIds.forEach(pacote => {
    const aduana = aduanaById.get(pacote);
    const auditoria = auditoriaById.get(pacote);

    // Estado pode continuar vindo da Aduana quando ela existe.
    const stateRow = aduana || auditoria;
    // Local encontrado deve priorizar Auditoria: é nela que temos placa e rota físicas.
    const foundRow = auditoria || aduana;
    if (!stateRow || !foundRow) return;

    const classificacao = classificationFromEstado(stateRow.estado)
      || classificationFromEstado(foundRow.estado);
    if (!classificacao) return;

    const encontradoPlaca = clean(foundRow.placaInformada || stateRow.placaInformada).toUpperCase();
    const encontradoRota = clean(foundRow.rotaInformada || stateRow.rotaInformada);
    const base = encontradoPlaca ? byPlate.get(plateKey(encontradoPlaca)) : undefined;
    const origem: FonteExpedicao = auditoria ? 'auditoria' : 'aduana';

    result.push({
      ...stateRow,
      pacote,
      origem,
      rotaInformada: encontradoRota,
      placaInformada: encontradoPlaca,
      detalhe: foundRow.detalhe || stateRow.detalhe,
      dataRegistro: foundRow.dataRegistro || stateRow.dataRegistro,
      placa: encontradoPlaca,
      onda: base?.onda || '',
      rotaOtimizada: base?.rotaOtimizada || '',
      doca: base?.doca || '',
      classificacao,
      encontradoRota,
      encontradoPlaca,
      destinoRota: base?.rotaOtimizada || '',
      destinoDoca: base?.doca || '',
      destinoOnda: base?.onda || '',
    });
  });

  return result;
}

function dockPlateSets(rows: BaseDespachoRow[]) {
  const map = new Map<string, Set<string>>();

  rows.forEach(row => {
    const doca = normalizeDock(row.doca);
    const placa = clean(row.placa).toUpperCase();
    if (!doca || !placa) return;
    if (!map.has(doca)) map.set(doca, new Set());
    map.get(doca)?.add(placa);
  });

  return map;
}

function makeChangeId(prefix: string, registeredAt: string, suffix: string) {
  return `${prefix}-${registeredAt}-${suffix}`.replace(/[^a-zA-Z0-9_-]/g, '');
}

export function getBaseDockChanges(
  previous: BaseDespachoRow[],
  next: BaseDespachoRow[],
  registradoEm = new Date().toISOString(),
): ExpedicaoDocaChange[] {
  if (!previous.length) return [];

  const before = dockPlateSets(previous);
  const after = dockPlateSets(next);
  const docks = new Set([...before.keys(), ...after.keys()]);
  const changes: ExpedicaoDocaChange[] = [];

  docks.forEach(doca => {
    const oldPlates = before.get(doca) || new Set<string>();
    const newPlates = after.get(doca) || new Set<string>();
    const added = [...newPlates].filter(placa => !oldPlates.has(placa));
    const removed = [...oldPlates].filter(placa => !newPlates.has(placa));

    if (added.length === 1 && removed.length === 1) {
      changes.push({
        id: makeChangeId('troca-placa', registradoEm, `${doca}-${removed[0]}-${added[0]}`),
        tipo: 'troca_placa',
        fonte: 'base',
        doca,
        placa: added[0],
        placaAnterior: removed[0],
        mensagem: `Carro alterado: ${removed[0]} → ${added[0]}`,
        registradoEm,
      });
      return;
    }

    added.forEach(placa => changes.push({
      id: makeChangeId('nova-placa', registradoEm, `${doca}-${placa}`),
      tipo: 'nova_placa',
      fonte: 'base',
      doca,
      placa,
      mensagem: `Nova placa ${placa} na doca`,
      registradoEm,
    }));

    removed.forEach(placa => changes.push({
      id: makeChangeId('placa-removida', registradoEm, `${doca}-${placa}`),
      tipo: 'placa_removida',
      fonte: 'base',
      doca,
      placaAnterior: placa,
      mensagem: `Placa ${placa} saiu da doca`,
      registradoEm,
    }));
  });

  return changes;
}

export function getExpedicaoDockChanges(
  previous: EnrichedExpedicaoRow[],
  next: EnrichedExpedicaoRow[],
  fonte: FonteImportacaoExpedicao,
  registradoEm = new Date().toISOString(),
): ExpedicaoDocaChange[] {
  const before = new Map(previous.map(row => [row.pacote, row]));
  const after = new Map(next.map(row => [row.pacote, row]));
  const changes: ExpedicaoDocaChange[] = [];

  after.forEach(row => {
    const old = before.get(row.pacote);

    if (!old) {
      if (!row.doca) return;
      const found = row.encontradoRota || row.encontradoPlaca || 'local não informado';
      const destination = `D${row.doca}${row.rotaOtimizada ? ` ${row.rotaOtimizada}` : ''}`;
      changes.push({
        id: makeChangeId('novo-erro', registradoEm, `${row.pacote}-${row.doca}`),
        tipo: 'novo_erro',
        fonte,
        doca: row.doca,
        pacote: row.pacote,
        placa: row.placa,
        classificacao: row.classificacao,
        mensagem: row.classificacao === 'A mais'
          ? `Novo A mais ${row.pacote}: ${found} → ${destination}`
          : `Novo Faltante: ${row.pacote}`,
        registradoEm,
      });
      return;
    }

    if (old.doca !== row.doca && (old.doca || row.doca)) {
      changes.push({
        id: makeChangeId('mudou-doca', registradoEm, `${row.pacote}-${old.doca}-${row.doca}`),
        tipo: 'mudou_doca',
        fonte,
        doca: row.doca || old.doca,
        docaAnterior: old.doca || undefined,
        pacote: row.pacote,
        placa: row.placa,
        placaAnterior: old.placa,
        classificacao: row.classificacao,
        classificacaoAnterior: old.classificacao,
        mensagem: row.doca
          ? `Pacote ${row.pacote} mudou ${old.doca ? `da doca ${old.doca}` : 'de sem doca'} para ${row.doca}`
          : `Pacote ${row.pacote} ficou sem doca`,
        registradoEm,
      });
    }

    if (old.classificacao !== row.classificacao) {
      const doca = row.doca || old.doca;
      if (!doca) return;
      changes.push({
        id: makeChangeId('erro-alterado', registradoEm, `${row.pacote}-${doca}-${row.classificacao}`),
        tipo: 'erro_alterado',
        fonte,
        doca,
        pacote: row.pacote,
        placa: row.placa,
        classificacao: row.classificacao,
        classificacaoAnterior: old.classificacao,
        mensagem: `${row.pacote}: ${old.classificacao} → ${row.classificacao}`,
        registradoEm,
      });
    }
  });

  before.forEach(row => {
    if (after.has(row.pacote) || !row.doca) return;
    changes.push({
      id: makeChangeId('erro-removido', registradoEm, `${row.pacote}-${row.doca}`),
      tipo: 'erro_removido',
      fonte,
      doca: row.doca,
      pacote: row.pacote,
      placaAnterior: row.placa,
      classificacaoAnterior: row.classificacao,
      mensagem: `${row.classificacao} removido: ${row.pacote}`,
      registradoEm,
    });
  });

  return changes;
}
