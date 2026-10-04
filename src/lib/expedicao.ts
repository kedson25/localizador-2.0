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

export interface EnrichedExpedicaoRow extends ExpedicaoRow {
  onda: string;
  rotaOtimizada: string;
  doca: string;
  placa: string;
  classificacao: 'A mais' | 'Faltante';
  vagaOperacional: string;
  encontradoRota: string;
  encontradoPlaca: string;
  encontradoDoca: string;
  destinoRota: string;
  destinoDoca: string;
  destinoOnda: string;
  localizacaoConfirmada: boolean;
  motivoLocalizacao: string;
}

const clean = (value: unknown) => String(value ?? '').replace(/^\uFEFF/, '').trim();
const key = (value: unknown) => clean(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const id = (value: unknown) => {
  const text = clean(value).replace(/\.0+$/, '');
  return text.replace(/\D/g, '') || text.toUpperCase();
};
const plateKey = (value: unknown) => clean(value).toUpperCase().replace(/[^A-Z0-9]/g, '');
const routeKey = (value: unknown) => key(clean(value).split('|')[0].trim());
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

export function dateScore(value: string) {
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
    if (!current || dateScore(row.dataRegistro) >= dateScore(current.dataRegistro)) result.set(row.pacote, row);
  });
  return Array.from(result.values());
}

export function parseBaseDespacho(text: string): BaseDespachoRow[] {
  const records = csv(text).map(row => ({
    pacote: id(value(row, 'Shipment ID', 'Shipment', 'shipment_id', 'ID do pacote', 'Pacote', 'ID da remessa', 'ID do envio', 'ID de envio', 'ID')),
    onda: value(row, 'Onda'),
    rotaOtimizada: value(row, 'Rota otimizada', 'Rota Otimizada'),
    rotaOriginal: value(row, 'Rota original', 'Rota Original'),
    doca: normalizeDock(value(row, 'Doca')),
    placa: clean(value(row, 'Placa')).toUpperCase(),
  })).filter(row => row.pacote || row.rotaOtimizada || row.rotaOriginal || row.placa);

  return Array.from(new Map<string, BaseDespachoRow>(records.map(row => [
    `${row.pacote}|${key(row.rotaOtimizada)}|${key(row.rotaOriginal)}|${plateKey(row.placa)}|${row.doca}|${key(row.onda)}`,
    row,
  ] as [string, BaseDespachoRow])).values());
}

export function parseExpedicaoRows(text: string, origem: FonteExpedicao): ExpedicaoRow[] {
  const rows = csv(text).map(raw => ({
    pacote: id(value(raw, 'Shipment ID', 'ID do pacote', 'ID do pacote,', 'Pacote', 'ID')),
    rotaInformada: value(raw, 'ID da rota', 'Rota', 'Rota sugerida', 'Contenedor'),
    placaInformada: clean(value(raw, 'Placa')).toUpperCase(),
    estado: value(raw, 'Estado', 'Status de resolução', 'Status'),
    dataRegistro: value(raw, 'Data auditoria', 'Data da auditoria', 'Data/Hora', 'Data hora', 'Timestamp', 'Data'),
    detalhe: origem === 'aduana'
      ? value(raw, 'Rep auditoria', 'Responsável', 'Data auditoria')
      : value(raw, 'Rep auditoria', 'Problema', 'Motivo', 'Problem Solver'),
    origem,
    raw: Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, clean(v)])),
  })).filter(row => row.pacote);
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
    if (key(before.estado) !== key(row.estado) || key(before.rotaInformada) !== key(row.rotaInformada) || plateKey(before.placaInformada) !== plateKey(row.placaInformada)) {
      changes.push({ pacote: row.pacote, origem, tipo: 'alterado', estado: row.estado, estadoAnterior: before.estado, registradoEm: now });
    }
  });
  old.forEach(row => {
    if (!current.has(row.pacote)) changes.push({ pacote: row.pacote, origem, tipo: 'removido', estado: '', estadoAnterior: row.estado, registradoEm: now });
  });
  return changes;
}

function uniqueDock(rows: BaseDespachoRow[]) {
  const docks = [...new Set(rows.map(row => normalizeDock(row.doca)).filter(Boolean))];
  return docks.length === 1 ? docks[0] : '';
}

function currentDockPlateMap(base: BaseDespachoRow[]) {
  const map = new Map<string, Set<string>>();
  base.forEach(row => {
    const dock = normalizeDock(row.doca);
    const plate = plateKey(row.placa);
    if (!dock || !plate) return;
    if (!map.has(dock)) map.set(dock, new Set());
    map.get(dock)?.add(plate);
  });
  return map;
}

function dockForPlateAtTime(store: ExpedicaoStore, plate: string, eventDate: string) {
  const normalizedPlate = plateKey(plate);
  if (!normalizedPlate) return '';
  const eventTime = dateScore(eventDate);
  const state = currentDockPlateMap(store.base);
  const changes = [...(store.historicoDoca || [])]
    .filter(change => change.fonte === 'base' && dateScore(change.registradoEm) > eventTime)
    .sort((a, b) => dateScore(b.registradoEm) - dateScore(a.registradoEm));

  changes.forEach(change => {
    const dock = normalizeDock(change.doca);
    if (!dock) return;
    if (!state.has(dock)) state.set(dock, new Set());
    const set = state.get(dock)!;
    if (change.tipo === 'nova_placa' && change.placa) set.delete(plateKey(change.placa));
    if (change.tipo === 'placa_removida' && change.placaAnterior) set.add(plateKey(change.placaAnterior));
    if (change.tipo === 'troca_placa') {
      if (change.placa) set.delete(plateKey(change.placa));
      if (change.placaAnterior) set.add(plateKey(change.placaAnterior));
    }
  });

  const docks = [...state.entries()].filter(([, plates]) => plates.has(normalizedPlate)).map(([dock]) => dock);
  return docks.length === 1 ? docks[0] : '';
}

/**
 * Precisão primeiro:
 * - o estado ativo é sempre o evento MAIS RECENTE entre Aduana e Auditoria;
 * - se o último evento for Correto/Pendente/etc, o pacote sai da lista de erro;
 * - destino usa somente Shipment ID da Base Despacho (sem fallback por placa);
 * - Auditoria usa Contenedor/rua como localização principal;
 * - Aduana tenta confirmar vaga pela placa no horário do evento; se não houver confirmação única,
 *   usa a rota apenas quando ela aponta para uma única vaga. Em ambiguidade, não chuta.
 */
export function enrichExpedicao(store: ExpedicaoStore): EnrichedExpedicaoRow[] {
  const byPackage = new Map<string, BaseDespachoRow>();
  const byRoute = new Map<string, BaseDespachoRow[]>();

  store.base.forEach(row => {
    if (row.pacote && !byPackage.has(row.pacote)) byPackage.set(row.pacote, row);
    [row.rotaOtimizada, row.rotaOriginal].forEach(route => {
      const normalized = routeKey(route);
      if (!normalized) return;
      const rows = byRoute.get(normalized) || [];
      rows.push(row);
      byRoute.set(normalized, rows);
    });
  });

  const aduanaById = new Map(store.aduana.map(row => [row.pacote, row]));
  const auditoriaById = new Map(store.auditoria.map(row => [row.pacote, row]));
  const allIds = new Set([...aduanaById.keys(), ...auditoriaById.keys()]);
  const result: EnrichedExpedicaoRow[] = [];

  allIds.forEach(pacote => {
    const aduana = aduanaById.get(pacote);
    const auditoria = auditoriaById.get(pacote);
    const candidates = [aduana, auditoria].filter(Boolean) as ExpedicaoRow[];
    if (!candidates.length) return;

    const stateRow = candidates.sort((a, b) => dateScore(b.dataRegistro) - dateScore(a.dataRegistro))[0];
    const classificacao = classificationFromEstado(stateRow.estado);
    if (!classificacao) return;

    const destinationBase = byPackage.get(pacote);
    const encontradoRota = clean(stateRow.rotaInformada);
    const encontradoPlaca = clean(stateRow.placaInformada).toUpperCase();
    const routeRows = encontradoRota ? (byRoute.get(routeKey(encontradoRota)) || []) : [];
    const routeDock = uniqueDock(routeRows);
    const temporalDock = stateRow.origem === 'aduana'
      ? dockForPlateAtTime(store, encontradoPlaca, stateRow.dataRegistro)
      : '';
    const encontradoDoca = stateRow.origem === 'aduana' ? (temporalDock || routeDock) : '';
    const localizacaoConfirmada = stateRow.origem === 'auditoria'
      ? Boolean(encontradoRota)
      : Boolean(temporalDock || routeDock);
    const motivoLocalizacao = stateRow.origem === 'auditoria'
      ? (encontradoRota ? 'Contenedor informado pela Auditoria' : 'Auditoria sem Contenedor')
      : temporalDock
        ? 'Vaga confirmada pela placa no horário do evento'
        : routeDock
          ? 'Vaga confirmada por rota única no Despacho'
          : 'Vaga não confirmada: cruzamento ambíguo ou sem dados suficientes';

    result.push({
      ...stateRow,
      classificacao,
      encontradoRota,
      encontradoPlaca,
      encontradoDoca,
      localizacaoConfirmada,
      motivoLocalizacao,
      destinoRota: destinationBase?.rotaOtimizada || '',
      destinoDoca: destinationBase?.doca || '',
      destinoOnda: destinationBase?.onda || '',
      placa: destinationBase?.placa || encontradoPlaca,
      onda: destinationBase?.onda || '',
      rotaOtimizada: destinationBase?.rotaOtimizada || '',
      doca: destinationBase?.doca || '',
      vagaOperacional: stateRow.origem === 'aduana'
        ? (encontradoDoca || (classificacao === 'Faltante' ? destinationBase?.doca || '' : ''))
        : '',
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

export function getBaseDockChanges(previous: BaseDespachoRow[], next: BaseDespachoRow[], registradoEm = new Date().toISOString()): ExpedicaoDocaChange[] {
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
      changes.push({ id: makeChangeId('troca-placa', registradoEm, `${doca}-${removed[0]}-${added[0]}`), tipo: 'troca_placa', fonte: 'base', doca, placa: added[0], placaAnterior: removed[0], mensagem: `Carro alterado: ${removed[0]} → ${added[0]}`, registradoEm });
      return;
    }
    added.forEach(placa => changes.push({ id: makeChangeId('nova-placa', registradoEm, `${doca}-${placa}`), tipo: 'nova_placa', fonte: 'base', doca, placa, mensagem: `Nova placa ${placa} na doca`, registradoEm }));
    removed.forEach(placa => changes.push({ id: makeChangeId('placa-removida', registradoEm, `${doca}-${placa}`), tipo: 'placa_removida', fonte: 'base', doca, placaAnterior: placa, mensagem: `Placa ${placa} saiu da doca`, registradoEm }));
  });
  return changes;
}

export function getExpedicaoDockChanges(previous: EnrichedExpedicaoRow[], next: EnrichedExpedicaoRow[], fonte: FonteImportacaoExpedicao, registradoEm = new Date().toISOString()): ExpedicaoDocaChange[] {
  const before = new Map(previous.map(row => [row.pacote, row]));
  const after = new Map(next.map(row => [row.pacote, row]));
  const changes: ExpedicaoDocaChange[] = [];
  after.forEach(row => {
    const old = before.get(row.pacote);
    const rowDoca = row.vagaOperacional || row.doca;
    const oldDoca = old ? (old.vagaOperacional || old.doca) : '';
    if (!old) {
      if (!rowDoca) return;
      changes.push({ id: makeChangeId('novo-erro', registradoEm, `${row.pacote}-${rowDoca}`), tipo: 'novo_erro', fonte, doca: rowDoca, pacote: row.pacote, placa: row.placa, classificacao: row.classificacao, mensagem: `Novo ${row.classificacao}: ${row.pacote}`, registradoEm });
      return;
    }
    if (oldDoca !== rowDoca && (oldDoca || rowDoca)) {
      changes.push({ id: makeChangeId('mudou-doca', registradoEm, `${row.pacote}-${oldDoca}-${rowDoca}`), tipo: 'mudou_doca', fonte, doca: rowDoca || oldDoca, docaAnterior: oldDoca || undefined, pacote: row.pacote, placa: row.placa, placaAnterior: old.placa, classificacao: row.classificacao, classificacaoAnterior: old.classificacao, mensagem: `Pacote ${row.pacote}: ${oldDoca || 'sem vaga'} → ${rowDoca || 'sem vaga'}`, registradoEm });
    }
    if (old.classificacao !== row.classificacao) {
      const doca = rowDoca || oldDoca;
      if (!doca) return;
      changes.push({ id: makeChangeId('erro-alterado', registradoEm, `${row.pacote}-${doca}-${row.classificacao}`), tipo: 'erro_alterado', fonte, doca, pacote: row.pacote, placa: row.placa, classificacao: row.classificacao, classificacaoAnterior: old.classificacao, mensagem: `${row.pacote}: ${old.classificacao} → ${row.classificacao}`, registradoEm });
    }
  });
  before.forEach(row => {
    const rowDoca = row.vagaOperacional || row.doca;
    if (after.has(row.pacote) || !rowDoca) return;
    changes.push({ id: makeChangeId('erro-removido', registradoEm, `${row.pacote}-${rowDoca}`), tipo: 'erro_removido', fonte, doca: rowDoca, pacote: row.pacote, placaAnterior: row.placa, classificacaoAnterior: row.classificacao, mensagem: `${row.classificacao} removido: ${row.pacote}`, registradoEm });
  });
  return changes;
}
