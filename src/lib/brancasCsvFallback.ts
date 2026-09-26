import Papa from 'papaparse';
import {
  BrancaRelatorioResponse,
  ItemNaoRoteirizado,
  MovimentacaoPacote,
} from './brancasApi';
import { buildVisaoGeral, translateRoutingPattern } from './operationalTranslator';

type CsvRecord = Record<string, string>;

type BaseRow = {
  idPacote: string;
  dataBranca: string;
  base: string;
  cicloOrigem: string;
  etapaFluxo: string;
  motivoMacro: string;
  detalheDescartes: string;
  statusTraduzido: string;
};

type RotaInfo = {
  idPacote: string;
  ciclo: string;
  rota: string;
  data: string;
};

type CsvSequenceState = {
  flowId: string;
  baseRows: BaseRow[];
  baseDate: string;
  baseCycle: string;
  unresolved: ItemNaoRoteirizado[];
  lastAttemptKey: string;
  movements: Record<string, MovimentacaoPacote[]>;
  routedByList?: Record<string, string[]>;
  lastReport?: BrancaRelatorioResponse;
};

const STORAGE_KEY = 'brancas_csv_sequence_v2';
let memoryState: CsvSequenceState | null = null;

function normalizeHeader(value: string): string {
  return String(value || '')
    .replace(/^\uFEFF/, '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePackageId(value: unknown): string {
  if (value === null || value === undefined) return '';

  let text = String(value)
    .replace(/^\uFEFF/, '')
    .trim()
    .replace(/^['"]+|['"]+$/g, '')
    .trim();

  if (/^\d+\.0$/.test(text)) {
    text = text.slice(0, -2);
  }

  return text;
}

function normalizeCycle(raw: string): string {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';

  const am = value.match(/(?:^|[^A-Z0-9])AM(?:[-_ ]?(\d+))?(?=$|[^A-Z0-9])/i);
  if (am) return `AM${am[1] || '1'}`;

  const pm = value.match(/(?:^|[^A-Z0-9])PM(?:[-_ ]?(\d+))?(?=$|[^A-Z0-9])/i);
  if (pm) return `PM${pm[1] || '1'}`;

  const sd = value.match(/(?:^|[^A-Z0-9])SD(?:[-_ ]?(\d+))?(?=$|[^A-Z0-9])/i);
  if (sd) return `SD${sd[1] || '1'}`;

  return value.replace(/\s+/g, ' ');
}

function cycleRank(raw: string): number {
  const value = normalizeCycle(raw);
  const suffix = Number(value.match(/(\d+)$/)?.[1] || 1);

  if (value.startsWith('AM')) return 100 + suffix;
  if (value.startsWith('PM')) return 200 + suffix;
  if (value.startsWith('SD')) return 300 + suffix;

  return 50;
}

function todayKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());

  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseDateKey(raw: string): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  const iso = value.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  }

  const br = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (br) {
    return `${br[3]}-${String(Number(br[2])).padStart(2, '0')}-${String(Number(br[1])).padStart(2, '0')}`;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function prepareCsvText(text: string): { text: string; delimiter?: string } {
  let cleanText = String(text || '').replace(/^\uFEFF/, '');
  const sepMatch = cleanText.match(/^sep=(.)\r?\n/i);

  if (sepMatch) {
    cleanText = cleanText.replace(/^sep=.\r?\n/i, '');
    return { text: cleanText, delimiter: sepMatch[1] };
  }

  return { text: cleanText };
}

function parseCsv(text: string): CsvRecord[] {
  const prepared = prepareCsvText(text);
  if (!prepared.text.trim()) return [];

  const parsed = Papa.parse<string[]>(prepared.text, {
    delimiter: prepared.delimiter,
    skipEmptyLines: 'greedy',
  });

  const rows = (parsed.data || [])
    .map((row) => (Array.isArray(row) ? row.map((cell) => String(cell ?? '').trim()) : []))
    .filter((row) => row.some((cell) => cell !== ''));

  if (rows.length < 2) return [];

  const headerIndex = rows.findIndex((row) => row.filter((cell) => cell.trim()).length >= 1);
  if (headerIndex < 0 || headerIndex >= rows.length - 1) return [];

  const headers = rows[headerIndex].map(normalizeHeader);
  const records: CsvRecord[] = [];

  for (let i = headerIndex + 1; i < rows.length; i++) {
    const cells = rows[i];
    const record: CsvRecord = {};

    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? '';
    });

    if (Object.values(record).some((value) => String(value || '').trim())) {
      records.push(record);
    }
  }

  return records;
}

function valueFrom(record: CsvRecord, aliases: string[]): string {
  const normalizedAliases = aliases.map(normalizeHeader).filter(Boolean);

  for (const alias of normalizedAliases) {
    if (record[alias] !== undefined && String(record[alias]).trim() !== '') {
      return String(record[alias]).trim();
    }
  }

  const fuzzyAliases = normalizedAliases.filter((alias) => alias.length >= 4);

  for (const [key, value] of Object.entries(record)) {
    if (!String(value || '').trim()) continue;

    const matched = fuzzyAliases.some((alias) => {
      if (key === alias) return true;
      if (key.startsWith(`${alias}_`) || key.endsWith(`_${alias}`)) return true;
      if (alias.startsWith(`${key}_`) || alias.endsWith(`_${key}`)) return true;
      return false;
    });

    if (matched) return String(value).trim();
  }

  return '';
}

function getPackageId(record: CsvRecord): string {
  const direct = valueFrom(record, [
    'ID_PACOTE',
    'ID_DO_PACOTE',
    'PACKAGE_ID',
    'PACOTE_ID',
    'SHIPMENT_ID',
    'ID_SHIPMENT',
    'SHIPMENT',
    'SHP_ID',
    'TRACKING_ID',
    'TRACKING',
    'CODIGO_PACOTE',
    'CODIGO_DO_PACOTE',
    'ID_ENVIO',
    'ID_DO_ENVIO',
    'ID',
  ]);

  if (direct) return normalizePackageId(direct);

  for (const [key, value] of Object.entries(record)) {
    if (!/(PACOTE|PACKAGE|SHIPMENT|TRACKING|ENVIO|SHP)/i.test(key)) continue;
    const candidate = normalizePackageId(value);
    if (candidate) return candidate;
  }

  for (const value of Object.values(record)) {
    const candidate = normalizePackageId(value);
    if (/^\d{8,24}$/.test(candidate)) return candidate;
  }

  return '';
}

function parseBrancas(text: string): BaseRow[] {
  const records = parseCsv(text);
  const unique = new Map<string, BaseRow>();

  for (const record of records) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;

    unique.set(idPacote, {
      idPacote,
      dataBranca: valueFrom(record, [
        'DATA',
        'DATE',
        'DATA_CRIACAO',
        'DATA_BRANCA',
        'DATA_HORA',
        'CREATED_AT',
      ]),
      base: valueFrom(record, [
        'BASE',
        'HUB',
        'FACILITY',
        'ESTACAO',
        'STATION',
        'UNIDADE',
        'SITE',
      ]),
      cicloOrigem:
        normalizeCycle(
          valueFrom(record, [
            'CICLO',
            'CICLO_ORIGEM',
            'CYCLE',
            'TURNO',
            'WAVE',
            'PROMESSA',
          ])
        ) || 'AM1',
      etapaFluxo: valueFrom(record, [
        'ETAPA_FLUXO',
        'ETAPA',
        'FLUXO',
        'STEP',
        'STAGE',
      ]),
      motivoMacro:
        valueFrom(record, [
          'MOTIVO_MACRO',
          'MOTIVO',
          'REASON',
          'MACRO',
          'MOTIVO_FALHA',
          'MOTIVO_DESCARTE',
        ]) || 'NÃO INFORMADO',
      detalheDescartes: valueFrom(record, [
        'DETALHE_DESCARTES',
        'DETALHE',
        'DETAIL',
        'DESCARTES',
        'SUB_MOTIVO',
        'DETALHE_DESCARTE',
      ]),
      statusTraduzido:
        valueFrom(record, [
          'STATUS_TRADUZIDO',
          'STATUS',
          'TRADUCAO',
          'STATUS_OPERACIONAL',
          'SITUACAO',
          'DESCRICAO',
        ]) || 'Sem rota',
    });
  }

  return Array.from(unique.values());
}

function parseRotas(text: string): Map<string, RotaInfo> {
  const records = parseCsv(text);
  const result = new Map<string, RotaInfo>();

  for (const record of records) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;

    result.set(idPacote, {
      idPacote,
      ciclo: normalizeCycle(
        valueFrom(record, [
          'CICLO',
          'CYCLE',
          'TURNO',
          'WAVE',
          'PROMESSA',
          'CICLO_DESTINO',
        ])
      ),
      rota: valueFrom(record, [
        'ROTA',
        'ROUTE',
        'ID_ROTA',
        'ROTA_ID',
        'ROUTE_ID',
      ]),
      data: valueFrom(record, [
        'DATA',
        'DATE',
        'DATA_ROTA',
        'DATA_HORA',
        'CREATED_AT',
      ]),
    });
  }

  return result;
}

function loadState(): CsvSequenceState | null {
  if (memoryState) return memoryState;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    memoryState = JSON.parse(raw) as CsvSequenceState;
    return memoryState;
  } catch {
    return null;
  }
}

function saveState(state: CsvSequenceState): boolean {
  memoryState = state;

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch (error) {
    console.warn('[Brancas CSV] Falha ao salvar estado completo no localStorage.', error);
  }

  try {
    const compactMovements = Object.fromEntries(
      Object.entries(state.movements || {}).map(([id, items]) => [id, items.slice(-3)])
    );

    const compactReport = state.lastReport
      ? {
          ...state.lastReport,
          itemsAll: [],
          itemsRecuperados: [],
          recentRuns: [],
        }
      : undefined;

    const compactState: CsvSequenceState = {
      ...state,
      movements: compactMovements,
      lastReport: compactReport,
    };

    localStorage.setItem(STORAGE_KEY, JSON.stringify(compactState));
    return true;
  } catch (error) {
    console.warn(
      '[Brancas CSV] Sem espaço para persistir a análise. O fluxo continuará funcionando enquanto esta aba estiver aberta.',
      error
    );
    return false;
  }
}

export function hasBrancasCsvBase(): boolean {
  return Boolean(loadState()?.baseRows?.length);
}

export function clearBrancasCsvSequence() {
  memoryState = null;
  localStorage.removeItem(STORAGE_KEY);
}

export function getBrancasCsvHistory(idPacote: string): MovimentacaoPacote[] {
  return loadState()?.movements?.[normalizePackageId(idPacote)] || [];
}

export function getLastBrancasCsvReport(): BrancaRelatorioResponse | null {
  const state = loadState();
  if (!state?.lastReport) return null;

  if ((state.lastReport.itemsNaoRoteirizados || []).length > 0) {
    return state.lastReport;
  }

  const hydratedUnresolved = state.unresolved || [];

  return {
    ...state.lastReport,
    itemsNaoRoteirizados: hydratedUnresolved,
    itemsAll: hydratedUnresolved,
    visaoGeralSistema: buildVisaoGeral(hydratedUnresolved),
  };
}

function buildUnroutedItem(
  base: BaseRow,
  attemptCycle: string,
  transicao: ItemNaoRoteirizado['transicao'],
  attempts: number
): ItemNaoRoteirizado {
  const translation = translateRoutingPattern(
    base.etapaFluxo,
    base.motivoMacro,
    base.detalheDescartes,
    base.statusTraduzido
  );

  return {
    idPacote: base.idPacote,
    dataBranca: base.dataBranca,
    base: base.base,
    cicloOrigem: base.cicloOrigem,
    cicloTentativa: attemptCycle,
    etapaFluxo: base.etapaFluxo,
    motivoMacro: base.motivoMacro,
    detalheDescartes: base.detalheDescartes,
    statusTraduzido: base.statusTraduzido,
    transicao,
    tentativasCount: attempts,
    categoria: translation.categoria,
    categoriaLabel: translation.categoriaLabel,
    tituloOperacional: translation.titulo,
    explicacaoOperacional: translation.explicacao,
    badgeTipo: translation.badgeTipo,
    timestamp: Date.now(),
  };
}

function appendMovement(
  state: CsvSequenceState,
  idPacote: string,
  attemptKey: string,
  movement: MovimentacaoPacote
) {
  const current = state.movements[idPacote] || [];
  const withoutSameAttempt = current.filter(
    (item: any) => (item as any).sequencia !== attemptKey
  );

  state.movements[idPacote] = [
    ...withoutSameAttempt,
    { ...movement, sequencia: attemptKey } as MovimentacaoPacote,
  ];
}

export function analisarBrancasPorCsv(
  brancasText: string | undefined,
  rotasText: string,
  sourceNames?: { brancas?: string; rotas?: string }
): BrancaRelatorioResponse {
  const rotasMap = parseRotas(rotasText);

  if (rotasMap.size === 0) {
    throw new Error(
      'O CSV de Rotas não possui IDs reconhecíveis. Confira se existe uma coluna de ID do pacote/shipment.'
    );
  }

  let state = loadState();
  const replacingBase = Boolean(state && brancasText?.trim());
  let initial = false;

  if (!state || brancasText?.trim()) {
    const baseRows = parseBrancas(brancasText || '');

    if (baseRows.length === 0) {
      throw new Error(
        'Não foi possível identificar IDs no CSV de Brancas. Selecione o arquivo correto e confira a coluna de ID do pacote.'
      );
    }

    const baseDates = baseRows
      .map((row) => parseDateKey(row.dataBranca))
      .filter(Boolean)
      .sort();

    const baseCycles = baseRows
      .map((row) => normalizeCycle(row.cicloOrigem))
      .filter(Boolean)
      .sort((a, b) => cycleRank(a) - cycleRank(b));

    state = {
      flowId: `csv_${Date.now()}`,
      baseRows,
      baseDate: baseDates.at(-1) || todayKey(),
      baseCycle: baseCycles[0] || 'AM1',
      unresolved: [],
      lastAttemptKey: '',
      movements: {},
      routedByList: {},
    };

    initial = true;
  }

  if (!state?.baseRows?.length) {
    throw new Error('Carregue primeiro um CSV de Brancas válido.');
  }

  const routeValues = Array.from(rotasMap.values());
  const routeDates = routeValues
    .map((route) => parseDateKey(route.data))
    .filter(Boolean)
    .sort();

  const routeCycles = routeValues
    .map((route) => normalizeCycle(route.ciclo))
    .filter(Boolean)
    .sort((a, b) => cycleRank(a) - cycleRank(b));

  const fileCycle = normalizeCycle(sourceNames?.rotas || '');
  const attemptDate = initial ? state.baseDate : routeDates.at(-1) || todayKey();
  const attemptCycle = routeCycles.at(-1) || fileCycle || state.baseCycle;
  const attemptKey = `${attemptDate}|${attemptCycle}`;
  const sameAttempt = state.lastAttemptKey === attemptKey;

  const sourceRows: BaseRow[] = initial
    ? state.baseRows
    : state.unresolved.map((item) => ({
        idPacote: item.idPacote,
        dataBranca: item.dataBranca,
        base: item.base,
        cicloOrigem: item.cicloOrigem,
        etapaFluxo: item.etapaFluxo,
        motivoMacro: item.motivoMacro,
        detalheDescartes: item.detalheDescartes,
        statusTraduzido: item.statusTraduzido,
      }));

  const previousMap = new Map(
    state.unresolved.map((item) => [item.idPacote, item])
  );

  const itemsNaoRoteirizados: ItemNaoRoteirizado[] = [];
  const itemsRecuperados: ItemNaoRoteirizado[] = [];
  const motivos: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};

  let recuperados = 0;
  let continuamFalhando = 0;
  let novosNaoRoteirizadosCount = 0;

  const now = new Date();
  const nowIso = now.toISOString();

  for (const base of sourceRows) {
    const prev = previousMap.get(base.idPacote);
    const rota = rotasMap.get(base.idPacote);
    const previousAttempts = Number(prev?.tentativasCount || 0);
    const attempts = sameAttempt
      ? Math.max(1, previousAttempts || 1)
      : Math.max(1, previousAttempts + 1);

    if (rota) {
      const cicloDestino = normalizeCycle(rota.ciclo) || attemptCycle;
      const recovered = Boolean(prev) && !sameAttempt;

      if (recovered) recuperados++;

      const transicao = recovered ? 'RECUPERADO' : 'ROTEIRIZADO';
      const item: ItemNaoRoteirizado = {
        ...base,
        cicloDestino,
        cicloTentativa: cicloDestino,
        statusTraduzido: recovered
          ? `Roteirizou no ${cicloDestino}`
          : `Roteirizado no ${cicloDestino}`,
        transicao,
        tentativasCount: attempts,
        categoria: recovered ? 'RECUPERADO' : 'ROTEIRIZADO',
        categoriaLabel: recovered ? 'Recuperado' : 'Roteirizado',
        tituloOperacional: recovered
          ? `Roteirizou (${base.cicloOrigem} ➔ ${cicloDestino})`
          : `Roteirizado no ${cicloDestino}`,
        explicacaoOperacional: `O ID apareceu no CSV de rotas do ciclo ${cicloDestino}.`,
        badgeTipo: 'FATO',
        timestamp: Date.now(),
      };

      itemsRecuperados.push(item);

      appendMovement(state, base.idPacote, attemptKey, {
        id: `csv_${attemptKey}_${base.idPacote}`,
        cicloTentativa: cicloDestino,
        resultado: 'ROTEIRIZADO',
        transicao,
        motivo: base.motivoMacro,
        status: item.statusTraduzido,
        dataRegistro: nowIso,
        timestamp: Date.now(),
        snapshotId: state.flowId,
      });

      continue;
    }

    const transicao = prev
      ? sameAttempt
        ? prev.transicao
        : 'CONTINUA_NAO_ROTEIRIZADO'
      : 'NOVO_NAO_ROTEIRIZADO';

    if (prev && !sameAttempt) continuamFalhando++;
    if (!prev) novosNaoRoteirizadosCount++;

    const item = buildUnroutedItem(base, attemptCycle, transicao, attempts);
    itemsNaoRoteirizados.push(item);

    motivos[item.motivoMacro || 'NÃO INFORMADO'] =
      (motivos[item.motivoMacro || 'NÃO INFORMADO'] || 0) + 1;

    statusCounts[item.statusTraduzido || 'Sem rota'] =
      (statusCounts[item.statusTraduzido || 'Sem rota'] || 0) + 1;

    appendMovement(state, base.idPacote, attemptKey, {
      id: `csv_${attemptKey}_${base.idPacote}`,
      cicloTentativa: attemptCycle,
      resultado: 'NAO_ROTEIRIZADO',
      transicao,
      motivo: base.motivoMacro,
      status: base.statusTraduzido,
      dataRegistro: nowIso,
      timestamp: Date.now(),
      snapshotId: state.flowId,
    });
  }

  const baseCount = state.baseRows.length;

  const routedByList = new Map<string, Set<string>>(
    Object.entries(state.routedByList || {}).map(([lista, ids]) => [
      lista,
      new Set(ids),
    ])
  );

  for (const base of state.baseRows) {
    const rota = rotasMap.get(base.idPacote);
    if (!rota) continue;

    const lista = normalizeCycle(rota.ciclo) || attemptCycle || 'SEM CICLO';
    const ids = routedByList.get(lista) || new Set<string>();
    ids.add(base.idPacote);
    routedByList.set(lista, ids);
  }

  state.routedByList = Object.fromEntries(
    Array.from(routedByList, ([lista, ids]) => [lista, Array.from(ids)])
  );

  const roteirizadosPorLista = Object.fromEntries(
    Object.entries(state.routedByList).map(([lista, ids]) => [lista, ids.length])
  );

  const totalNaoRoteirizados = itemsNaoRoteirizados.length;
  const totalRoteirizados = Math.max(0, baseCount - totalNaoRoteirizados);
  const taxaRoteirizacao =
    baseCount > 0
      ? Number(((totalRoteirizados / baseCount) * 100).toFixed(1))
      : 0;

  const report: BrancaRelatorioResponse = {
    hasData: true,
    snapshotId: `${state.flowId}_${attemptKey}`,
    runId: `${state.flowId}_${attemptKey}`,
    ciclosDetectados: [attemptCycle],
    baseDate: state.baseDate,
    baseCycle: state.baseCycle,
    attemptDate,
    attemptCycle,
    createdAt: nowIso,
    timestamp: now.getTime(),
    totalBrancas: baseCount,
    totalRotas: rotasMap.size,
    totalRoteirizados,
    totalNaoRoteirizados,
    totalRecuperados: recuperados,
    totalContinuamFalhando: continuamFalhando,
    totalMudaramMotivo: 0,
    roteirizados: totalRoteirizados,
    naoRoteirizados: totalNaoRoteirizados,
    recuperados,
    continuamFalhando,
    motivoAlteradoCount: 0,
    novosNaoRoteirizadosCount,
    mudancasMotivoDetalhes: [],
    taxaRoteirizacao,
    roteirizadosPorLista,
    extBrancasCount: baseCount,
    extRotasCount: rotasMap.size,
    lastComparisonTime: nowIso,
    lastCheckTime: nowIso,
    statusBanner: initial
      ? `${replacingBase ? 'Base CSV substituída' : 'Base CSV salva'}: ${baseCount} Brancas no ${state.baseCycle}.`
      : `${attemptDate} ${attemptCycle}: ${recuperados} recuperado(s) e ${totalNaoRoteirizados} ainda sem rota.`,
    motivos,
    statusCounts,
    itemsNaoRoteirizados,
    itemsRecuperados,
    itemsAll: [...itemsNaoRoteirizados, ...itemsRecuperados],
    visaoGeralSistema: buildVisaoGeral(itemsNaoRoteirizados),
    padroesDetectados: [],
    recentRuns: [],
    message: initial
      ? `${replacingBase ? 'Nova base carregada' : 'Base carregada'} de ${sourceNames?.brancas || 'ext_brancas.csv'} com ${baseCount} IDs. Rotas analisadas de ${sourceNames?.rotas || 'ext_rotas.csv'}.`
      : `Rotas atualizadas contra a base CSV salva usando ${sourceNames?.rotas || 'ext_rotas.csv'}.`,
  };

  state.unresolved = itemsNaoRoteirizados;
  state.lastAttemptKey = attemptKey;
  state.lastReport = report;

  const persisted = saveState(state);

  if (!persisted) {
    report.message = `${report.message} O navegador ficou sem espaço para persistir tudo, mas a análise continuará ativa nesta aba.`;
  }

  return report;
}
