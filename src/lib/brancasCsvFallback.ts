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
  lastReport?: BrancaRelatorioResponse;
};

const STORAGE_KEY = 'brancas_csv_sequence_v2';

function normalizeHeader(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePackageId(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value).trim().replace(/^"|"$/g, '');
  if (text.endsWith('.0')) text = text.slice(0, -2);
  return text.trim();
}

function normalizeCycle(raw: string): string {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';
  const am = value.match(/\bAM\s*[-_ ]?(\d+)?\b/i);
  if (am) return `AM${am[1] || '1'}`;
  const pm = value.match(/\bPM\s*[-_ ]?(\d+)?\b/i);
  if (pm) return `PM${pm[1] || '1'}`;
  return value.replace(/\s+/g, ' ');
}

function cycleRank(raw: string): number {
  const value = normalizeCycle(raw);
  const suffix = Number(value.match(/(\d+)$/)?.[1] || 1);
  if (value.startsWith('AM')) return 100 + suffix;
  if (value.startsWith('PM')) return 200 + suffix;
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
  if (iso) return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  const br = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (br) return `${br[3]}-${String(Number(br[2])).padStart(2, '0')}-${String(Number(br[1])).padStart(2, '0')}`;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function detectDelimiter(text: string): string {
  const sample = text.split(/\r?\n/).filter((line) => line.trim()).slice(0, 8);
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestScore = -1;
  for (const delimiter of candidates) {
    const score = sample.reduce((sum, line) => {
      let insideQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') i++;
          else insideQuotes = !insideQuotes;
        } else if (!insideQuotes && char === delimiter) count++;
      }
      return sum + count;
    }, 0);
    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }
  return best;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else insideQuotes = !insideQuotes;
      continue;
    }
    if (char === delimiter && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }
    current += char;
  }
  values.push(current.trim());
  return values;
}

function parseCsv(text: string): CsvRecord[] {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleanText.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length < 2) return [];
  const delimiter = detectDelimiter(cleanText);
  const headers = parseCsvLine(lines[0], delimiter).map(normalizeHeader);
  const records: CsvRecord[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const record: CsvRecord = {};
    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? '';
    });
    if (Object.values(record).some((value) => String(value || '').trim())) records.push(record);
  }
  return records;
}

function valueFrom(record: CsvRecord, aliases: string[]): string {
  const normalizedAliases = aliases.map(normalizeHeader);
  for (const alias of normalizedAliases) {
    if (record[alias] !== undefined && String(record[alias]).trim() !== '') return String(record[alias]).trim();
  }
  for (const [key, value] of Object.entries(record)) {
    if (normalizedAliases.some((alias) => key.includes(alias) || alias.includes(key)) && String(value || '').trim()) {
      return String(value).trim();
    }
  }
  return '';
}

function getPackageId(record: CsvRecord): string {
  const direct = valueFrom(record, ['ID_PACOTE', 'ID', 'PACOTE', 'TRACKING', 'SHIPMENT_ID', 'CODIGO_PACOTE']);
  if (direct) return normalizePackageId(direct);
  for (const value of Object.values(record)) {
    const candidate = normalizePackageId(value);
    if (/^[0-9]{6,18}$/.test(candidate)) return candidate;
  }
  return '';
}

function parseBrancas(text: string): BaseRow[] {
  const unique = new Map<string, BaseRow>();
  for (const record of parseCsv(text)) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;
    unique.set(idPacote, {
      idPacote,
      dataBranca: valueFrom(record, ['DATA', 'DATE', 'DATA_CRIACAO', 'DATA_BRANCA', 'DATA_HORA']),
      base: valueFrom(record, ['BASE', 'HUB', 'FACILITY', 'ESTACAO', 'STATION', 'UNIDADE']),
      cicloOrigem: normalizeCycle(valueFrom(record, ['CICLO', 'CICLO_ORIGEM', 'CYCLE', 'TURNO', 'WAVE'])) || 'AM1',
      etapaFluxo: valueFrom(record, ['ETAPA_FLUXO', 'ETAPA', 'FLUXO', 'STEP', 'STAGE']),
      motivoMacro: valueFrom(record, ['MOTIVO_MACRO', 'MOTIVO', 'REASON', 'MACRO', 'MOTIVO_FALHA', 'MOTIVO_DESCARTE']) || 'NÃO INFORMADO',
      detalheDescartes: valueFrom(record, ['DETALHE_DESCARTES', 'DETALHE', 'DETAIL', 'DESCARTES', 'SUB_MOTIVO', 'DETALHE_DESCARTE']),
      statusTraduzido: valueFrom(record, ['STATUS_TRADUZIDO', 'STATUS', 'TRADUCAO', 'STATUS_OPERACIONAL', 'SITUACAO', 'DESCRICAO']) || 'Sem rota',
    });
  }
  return Array.from(unique.values());
}

function parseRotas(text: string): Map<string, RotaInfo> {
  const result = new Map<string, RotaInfo>();
  for (const record of parseCsv(text)) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;
    result.set(idPacote, {
      idPacote,
      ciclo: normalizeCycle(valueFrom(record, ['CICLO', 'CYCLE', 'TURNO', 'WAVE'])),
      rota: valueFrom(record, ['ROTA', 'ROUTE', 'ID_ROTA']),
      data: valueFrom(record, ['DATA', 'DATE', 'DATA_ROTA', 'DATA_HORA', 'CREATED_AT']),
    });
  }
  return result;
}

function loadState(): CsvSequenceState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as CsvSequenceState;
  } catch {
    return null;
  }
}

function saveState(state: CsvSequenceState) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function hasBrancasCsvBase(): boolean {
  return Boolean(loadState()?.baseRows?.length);
}

export function clearBrancasCsvSequence() {
  localStorage.removeItem(STORAGE_KEY);
}

export function getBrancasCsvHistory(idPacote: string): MovimentacaoPacote[] {
  return loadState()?.movements?.[idPacote] || [];
}

export function getLastBrancasCsvReport(): BrancaRelatorioResponse | null {
  return loadState()?.lastReport || null;
}

function buildUnroutedItem(base: BaseRow, attemptCycle: string, transicao: ItemNaoRoteirizado['transicao'], attempts: number): ItemNaoRoteirizado {
  const translation = translateRoutingPattern(base.etapaFluxo, base.motivoMacro, base.detalheDescartes, base.statusTraduzido);
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
  const withoutSameAttempt = current.filter((item: any) => (item as any).sequencia !== attemptKey);
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
  if (rotasMap.size === 0) throw new Error('O CSV de Rotas está vazio ou não foi possível identificar IDs.');

  let state = loadState();
  let initial = false;

  if (!state) {
    const baseRows = parseBrancas(brancasText || '');
    if (baseRows.length === 0) {
      throw new Error('Na primeira análise selecione também a ext_brancas.csv para salvar a base.');
    }
    const baseDates = baseRows.map((row) => parseDateKey(row.dataBranca)).filter(Boolean).sort();
    const baseCycles = baseRows.map((row) => normalizeCycle(row.cicloOrigem)).filter(Boolean).sort((a, b) => cycleRank(a) - cycleRank(b));
    state = {
      flowId: `csv_${Date.now()}`,
      baseRows,
      baseDate: baseDates.at(-1) || todayKey(),
      baseCycle: baseCycles[0] || 'AM1',
      unresolved: [],
      lastAttemptKey: '',
      movements: {},
    };
    initial = true;
  }

  const routeValues = Array.from(rotasMap.values());
  const routeDates = routeValues.map((route) => parseDateKey(route.data)).filter(Boolean).sort();
  const routeCycles = routeValues.map((route) => normalizeCycle(route.ciclo)).filter(Boolean).sort((a, b) => cycleRank(a) - cycleRank(b));
  const attemptDate = initial ? state.baseDate : routeDates.at(-1) || todayKey();
  const attemptCycle = initial ? state.baseCycle : routeCycles.at(-1) || state.baseCycle;
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

  const previousMap = new Map(state.unresolved.map((item) => [item.idPacote, item]));
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
    const attempts = sameAttempt ? Math.max(1, previousAttempts || 1) : Math.max(1, previousAttempts + 1);

    if (rota) {
      const cicloDestino = normalizeCycle(rota.ciclo) || attemptCycle;
      const recovered = Boolean(prev) && !sameAttempt;
      if (recovered) recuperados++;
      const transicao = recovered ? 'RECUPERADO' : 'ROTEIRIZADO';
      const item: ItemNaoRoteirizado = {
        ...base,
        cicloDestino,
        cicloTentativa: cicloDestino,
        statusTraduzido: recovered ? `Roteirizou no ${cicloDestino}` : `Roteirizado no ${cicloDestino}`,
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
      ? (sameAttempt ? prev.transicao : 'CONTINUA_NAO_ROTEIRIZADO')
      : 'NOVO_NAO_ROTEIRIZADO';
    if (prev && !sameAttempt) continuamFalhando++;
    if (!prev) novosNaoRoteirizadosCount++;

    const item = buildUnroutedItem(base, attemptCycle, transicao, attempts);
    itemsNaoRoteirizados.push(item);
    motivos[item.motivoMacro || 'NÃO INFORMADO'] = (motivos[item.motivoMacro || 'NÃO INFORMADO'] || 0) + 1;
    statusCounts[item.statusTraduzido || 'Sem rota'] = (statusCounts[item.statusTraduzido || 'Sem rota'] || 0) + 1;
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
  const totalNaoRoteirizados = itemsNaoRoteirizados.length;
  const totalRoteirizados = Math.max(0, baseCount - totalNaoRoteirizados);
  const taxaRoteirizacao = baseCount > 0 ? Number(((totalRoteirizados / baseCount) * 100).toFixed(1)) : 0;

  const report: BrancaRelatorioResponse = {
    hasData: true,
    snapshotId: `${state.flowId}_${attemptKey}`,
    runId: `${state.flowId}_${attemptKey}`,
    ciclosDetectados: [attemptCycle],
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
    extBrancasCount: baseCount,
    extRotasCount: rotasMap.size,
    lastComparisonTime: nowIso,
    lastCheckTime: nowIso,
    statusBanner: initial
      ? `Base CSV salva: ${baseCount} Brancas no ${state.baseCycle}.`
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
      ? `A ${sourceNames?.brancas || 'ext_brancas.csv'} foi salva como base local. Agora basta atualizar ${sourceNames?.rotas || 'ext_rotas.csv'}.`
      : `Rotas atualizadas contra a base CSV salva usando ${sourceNames?.rotas || 'ext_rotas.csv'}.`,
  };

  state.unresolved = itemsNaoRoteirizados;
  state.lastAttemptKey = attemptKey;
  state.lastReport = report;
  saveState(state);
  return report;
}
