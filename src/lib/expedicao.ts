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
  destinoConfirmado: boolean;
  motivoDestino: string;
  erroAtrelamentoGaiola: boolean;
  diagnostico: 'Erro de atrelamento de gaiola' | 'Rota divergente' | 'Sem destino no despacho' | 'Local não confirmado';
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
    pacote: id(value(row,
      'Shipment ID', 'Shipment', 'shipment_id', 'shipment id', 'ID do pacote', 'Pacote',
      'ID da remessa', 'ID do envio', 'ID de envio', 'ID', 'shipmentid')),
    onda: value(row, 'Onda', 'Wave'),
    rotaOtimizada: value(row, 'Rota otimizada', 'Rota Otimizada', 'Optimized route', 'Route optimized'),
    rotaOriginal: value(row, 'Rota original', 'Rota Original', 'Original route'),
    doca: normalizeDock(value(row, 'Doca', 'Dock', 'Vaga')),
    placa: clean(value(row, 'Placa', 'Plate', 'Vehicle plate')).toUpperCase(),
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

function destinationFromShipment(rows: BaseDespachoRow[]) {
  if (!rows.length) return { row: undefined as BaseDespachoRow | undefined, confirmed: false, reason: 'Shipment ID não consta na Base Despacho' };
  const byDestination = new Map<string, BaseDespachoRow>();
  rows.forEach(row => {
    const k = `${normalizeDock(row.doca)}|${routeKey(row.rotaOtimizada)}|${key(row.onda)}`;
    byDestination.set(k, row);
  });
  if (byDestination.size !== 1) {
    return { row: undefined as BaseDespachoRow | undefined, confirmed: false, reason: 'Shipment ID aparece com destinos diferentes na Base Despacho' };
  }
  const row = [...byDestination.values()][0];
  if (!normalizeDock(row.doca)) {
    return { row, confirmed: false, reason: 'Shipment ID encontrado no Despacho, mas sem vaga/doca definida' };
  }
  return { row, confirmed: true, reason: 'Destino confirmado pelo Shipment ID na Base Despacho' };
}

function destinationFromAduanaPlate(rows: BaseDespachoRow[], plate: string) {
  const normalizedPlate = plateKey(plate);
  if (!normalizedPlate) {
    return { row: undefined as BaseDespachoRow | undefined, confirmed: false, reason: 'Aduana sem placa informada' };
  }
  if (!rows.length) {
    return { row: undefined as BaseDespachoRow | undefined, confirmed: false, reason: `Placa ${clean(plate).toUpperCase()} não consta na Base Despacho` };
  }

  const byDestination = new Map<string, BaseDespachoRow>();
  rows.forEach(row => {
    const dock = normalizeDock(row.doca);
    const optimizedRoute = routeKey(row.rotaOtimizada);
    const k = `${dock}|${optimizedRoute}`;
    byDestination.set(k, row);
  });

  if (byDestination.size !== 1) {
    return { row: undefined as BaseDespachoRow | undefined, confirmed: false, reason: `Placa ${clean(plate).toUpperCase()} aparece em destinos diferentes na Base Despacho` };
  }

  const row = [...byDestination.values()][0];
  if (!routeKey(row.rotaOtimizada)) {
    return { row, confirmed: false, reason: `Placa ${clean(plate).toUpperCase()} encontrada no Despacho, mas sem Rota otimizada` };
  }
  if (!normalizeDock(row.doca)) {
    return { row, confirmed: false, reason: `Placa ${clean(plate).toUpperCase()} encontrada no Despacho, mas sem vaga/doca definida` };
  }

  return {
    row,
    confirmed: true,
    reason: `Destino confirmado pela placa ${clean(plate).toUpperCase()}; Rota otimizada do Despacho = destino esperado`,
  };
}

/**
 * Precisão primeiro:
 * - Aduana: ID da rota = local onde o pacote foi encontrado;
 * - Aduana: Placa -> Base Despacho -> Rota otimizada/Doca = onde o pacote deveria estar;
 * - se a rota da Aduana divergir da Rota otimizada vinculada à placa, o pacote foi encontrado em outra rota;
 * - Auditoria preserva o cruzamento por Shipment ID quando esse dado existir na Base Despacho;
 * - localização encontrada e destino esperado são independentes;
 * - nenhuma vaga é inventada quando rota/placa forem ambíguas.
 */
export function enrichExpedicao(store: ExpedicaoStore): EnrichedExpedicaoRow[] {
  const byPackage = new Map<string, BaseDespachoRow[]>();
  const byRoute = new Map<string, BaseDespachoRow[]>();
  const byPlate = new Map<string, BaseDespachoRow[]>();

  store.base.forEach(row => {
    if (row.pacote) {
      const packageRows = byPackage.get(row.pacote) || [];
      packageRows.push(row);
      byPackage.set(row.pacote, packageRows);
    }

    const normalizedPlate = plateKey(row.placa);
    if (normalizedPlate) {
      const plateRows = byPlate.get(normalizedPlate) || [];
      plateRows.push(row);
      byPlate.set(normalizedPlate, plateRows);
    }

    [row.rotaOtimizada, row.rotaOriginal].forEach(route => {
      const normalized = routeKey(route);
      if (!normalized) return;
      const rows = byRoute.get(normalized) || [];
      rows.push(row);
      byRoute.set(normalized, rows);
    });
  });

  const result: EnrichedExpedicaoRow[] = [];

  [...store.aduana, ...store.auditoria].forEach(stateRow => {
    const pacote = stateRow.pacote;
    const classificacao = classificationFromEstado(stateRow.estado);
    if (!classificacao) return;

    const encontradoRota = clean(stateRow.rotaInformada);
    const encontradoPlaca = clean(stateRow.placaInformada).toUpperCase();
    const routeRows = encontradoRota ? (byRoute.get(routeKey(encontradoRota)) || []) : [];
    const routeDock = uniqueDock(routeRows);
    const locationBase = routeDock ? routeRows.find(row => normalizeDock(row.doca) === routeDock) : undefined;

    const destination = stateRow.origem === 'aduana'
      ? destinationFromAduanaPlate(byPlate.get(plateKey(encontradoPlaca)) || [], encontradoPlaca)
      : destinationFromShipment(byPackage.get(pacote) || []);
    const destinationBase = destination.row;

    // Na Aduana, a rota informada é o local REAL encontrado. A placa serve somente
    // para descobrir o destino esperado no Despacho, nunca para sobrescrever o local encontrado.
    const encontradoDoca = routeDock;
    const localizacaoConfirmada = stateRow.origem === 'auditoria'
      ? Boolean(encontradoRota && routeDock)
      : Boolean(encontradoRota && routeDock);
    const motivoLocalizacao = stateRow.origem === 'auditoria'
      ? routeDock
        ? 'Vaga localizada pela rota informada na Auditoria'
        : encontradoRota
          ? 'Rota da Auditoria não localizada no Despacho'
          : 'Auditoria sem rota/Contenedor'
      : routeDock
        ? 'Local encontrado confirmado pelo ID da rota informado na Aduana'
        : encontradoRota
          ? 'ID da rota da Aduana não localizado na Base Despacho'
          : 'Aduana sem ID da rota';

    const destinationRoutes = destinationBase
      ? [destinationBase.rotaOtimizada, destinationBase.rotaOriginal].map(routeKey).filter(Boolean)
      : [];
    const erroAtrelamentoGaiola = Boolean(
      stateRow.origem === 'auditoria'
      && destination.confirmed
      && encontradoRota
      && destinationRoutes.includes(routeKey(encontradoRota)),
    );
    const diagnostico: EnrichedExpedicaoRow['diagnostico'] = erroAtrelamentoGaiola
      ? 'Erro de atrelamento de gaiola'
      : !destination.confirmed
        ? 'Sem destino no despacho'
        : !localizacaoConfirmada
          ? 'Local não confirmado'
          : 'Rota divergente';

    result.push({
      ...stateRow,
      classificacao,
      encontradoRota,
      encontradoPlaca,
      encontradoDoca,
      localizacaoConfirmada,
      motivoLocalizacao,
      destinoConfirmado: destination.confirmed,
      motivoDestino: destination.reason,
      erroAtrelamentoGaiola,
      diagnostico,
      destinoRota: destinationBase?.rotaOtimizada || '',
      destinoDoca: destinationBase?.doca || '',
      destinoOnda: destinationBase?.onda || '',
      placa: encontradoPlaca || destinationBase?.placa || locationBase?.placa || '',
      onda: locationBase?.onda || '',
      rotaOtimizada: locationBase?.rotaOtimizada || '',
      doca: encontradoDoca || '',
      vagaOperacional: localizacaoConfirmada ? encontradoDoca : '',
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
  const rowKey = (row: EnrichedExpedicaoRow) => `${row.origem}:${row.pacote}`;
  const before = new Map(previous.map(row => [rowKey(row), row]));
  const after = new Map(next.map(row => [rowKey(row), row]));
  const changes: ExpedicaoDocaChange[] = [];
  after.forEach(row => {
    const old = before.get(rowKey(row));
    const rowDoca = row.vagaOperacional;
    const oldDoca = old?.vagaOperacional || '';
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
    const rowDoca = row.vagaOperacional;
    if (after.has(rowKey(row)) || !rowDoca) return;
    changes.push({ id: makeChangeId('erro-removido', registradoEm, `${row.pacote}-${rowDoca}`), tipo: 'erro_removido', fonte, doca: rowDoca, pacote: row.pacote, placaAnterior: row.placa, classificacaoAnterior: row.classificacao, mensagem: `${row.classificacao} removido: ${row.pacote}`, registradoEm });
  });
  return changes;
}
