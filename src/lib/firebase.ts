// Facade público do Firebase.
// Mantém o núcleo original em firebase-core.ts e consolida as leituras usadas
// pelas métricas permanentes e pelo painel Admin.
export * from './firebase-core';

import {
  listenToListas as listenToCoreListas,
  listenToRefugoHistoricoMetricas as listenToLegacyRefugoHistoricoMetricas,
  listenToRefugoScans as listenToTransientRefugoScans,
  listenToRefugoScansIncremental as listenToCoreRefugoScansIncremental,
  searchItemsAcrossAllListas as searchItemsAcrossAllListasCore,
  getAllItemsForExport as getAllItemsForExportCore,
} from './firebase-core';
import type { RefugoScan, RefugoScanChange } from './firebase-core';
import type { ColetaItem, ColetaLista, RefugoHistoricoMetrica } from '../types';
import {
  listenToRefugoMetricItems,
  persistRefugoMetricScan,
  RefugoMetricItem,
} from './refugoMetrics';

let todayListasCache: ColetaLista[] = [];

function getTodayDateKeys(now = new Date()) {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());

  return {
    br: `${day}/${month}/${year}`,
    iso: `${year}-${month}-${day}`,
  };
}

function isListaFromToday(lista: ColetaLista, now = new Date()): boolean {
  const { br, iso } = getTodayDateKeys(now);
  const rawData = String(lista.data || '').trim();

  if (rawData === br || rawData === iso || rawData.startsWith(`${br} `) || rawData.startsWith(`${iso}T`)) {
    return true;
  }

  const createdAt: any = lista.createdAt;
  let createdDate: Date | null = null;

  try {
    if (createdAt?.toDate && typeof createdAt.toDate === 'function') {
      createdDate = createdAt.toDate();
    } else if (createdAt?.seconds) {
      createdDate = new Date(Number(createdAt.seconds) * 1000);
    } else if (createdAt) {
      const parsed = new Date(createdAt);
      if (!Number.isNaN(parsed.getTime())) createdDate = parsed;
    }
  } catch (_) {
    createdDate = null;
  }

  if (!createdDate || Number.isNaN(createdDate.getTime())) return false;

  return (
    createdDate.getFullYear() === now.getFullYear() &&
    createdDate.getMonth() === now.getMonth() &&
    createdDate.getDate() === now.getDate()
  );
}

function normalizeLookupCode(value: string): { upper: string; digits: string } {
  const upper = String(value || '').trim().toUpperCase();
  const digits = upper.replace(/\D/g, '');
  return { upper, digits };
}

function deriveListaAccuracy(lista: ColetaLista): number {
  const explicit = Number(lista.porcentagemAcerto);
  if (lista.porcentagemAcerto !== undefined && Number.isFinite(explicit)) {
    return Math.max(0, Math.min(100, explicit));
  }

  const total = Math.max(0, Number(lista.totalItens || 0));
  if (total <= 0) return 0;

  if (lista.itensFaltaram !== undefined && Number.isFinite(Number(lista.itensFaltaram))) {
    const faltantes = Math.max(0, Math.min(total, Number(lista.itensFaltaram || 0)));
    return Number((((total - faltantes) / total) * 100).toFixed(2));
  }

  const validados = Math.max(0, Math.min(total, Number(lista.totalValidados || 0)));
  return Number(((validados / total) * 100).toFixed(2));
}

export function listenToListas(
  callback: (listas: ColetaLista[]) => void
): () => void {
  return listenToCoreListas(listas => {
    const listasDoDia = listas
      .filter(lista => isListaFromToday(lista))
      .map(lista => ({
        ...lista,
        porcentagemAcerto: deriveListaAccuracy(lista),
      }));

    todayListasCache = listasDoDia;
    callback(listasDoDia);
  });
}

/**
 * Consulta IDs apenas nas listas do dia atual.
 * O núcleo antigo ainda pode localizar um registro histórico primeiro, então a
 * resposta é filtrada e, quando necessário, fazemos uma conferência direta nas
 * listas de hoje para garantir que um ID repetido em dias diferentes priorize hoje.
 */
export async function searchItemsAcrossAllListas(
  terms: string[]
): Promise<Map<string, { item: ColetaItem; listaId: string }>> {
  const results = new Map<string, { item: ColetaItem; listaId: string }>();
  if (!terms || terms.length === 0) return results;

  const allowedListaIds = new Set(todayListasCache.map(lista => lista.id));
  if (allowedListaIds.size === 0) return results;

  try {
    const coreResults = await searchItemsAcrossAllListasCore(terms);
    coreResults.forEach((value, key) => {
      if (allowedListaIds.has(value.listaId)) {
        results.set(key, value);
      }
    });
  } catch (error) {
    console.warn('Busca global indisponível; conferindo diretamente as listas de hoje:', error);
  }

  const normalizedTerms = terms
    .map(normalizeLookupCode)
    .filter(term => term.upper || term.digits);

  const missingTerms = normalizedTerms.filter(term => {
    return !results.has(term.upper) && (!term.digits || !results.has(term.digits));
  });

  if (missingTerms.length === 0) return results;

  const wanted = new Set<string>();
  missingTerms.forEach(term => {
    if (term.upper) wanted.add(term.upper);
    if (term.digits) wanted.add(term.digits);
  });

  const listaIds = Array.from(allowedListaIds);
  const listasResults = await Promise.allSettled(
    listaIds.map(async listaId => ({
      listaId,
      itens: await getAllItemsForExportCore(listaId),
    }))
  );

  listasResults.forEach(listaResult => {
    if (listaResult.status !== 'fulfilled') return;

    const { listaId, itens } = listaResult.value;
    for (const rawItem of itens || []) {
      const codigo = String(rawItem.codigo || '').trim();
      if (!codigo) continue;

      const normalized = normalizeLookupCode(codigo);
      if (!wanted.has(normalized.upper) && (!normalized.digits || !wanted.has(normalized.digits))) {
        continue;
      }

      const item: ColetaItem = {
        ...rawItem,
        codigo,
        codigoClean: rawItem.codigoClean || normalized.digits,
      };

      if (normalized.upper) results.set(normalized.upper, { item, listaId });
      if (normalized.digits) results.set(normalized.digits, { item, listaId });
    }
  });

  return results;
}

function eventKeyFromScan(scan: RefugoScan): string {
  return `${scan.normalizedId}:${Number(scan.timestamp) || 0}`;
}

function isBrancaOrWithoutRoute(scan: RefugoScan): boolean {
  const route = String(scan.rota || '').trim();
  const upper = route.toUpperCase();
  return (
    scan.status !== 'found' ||
    !route ||
    upper.includes('SEM ROTA') ||
    upper.includes('BRANCA')
  );
}

/**
 * O AdminPanel historicamente recebe `scannedAt` e faz `new Date(scannedAt)`.
 * Strings pt-BR como `22/09/2026, 03:55:27` não são portáveis entre browsers e
 * podem virar Invalid Date, fazendo o painel descartar o scan até em "Todas as Datas".
 * Para o dashboard usamos sempre o timestamp numérico como fonte e entregamos ISO.
 */
function normalizeScanForDashboard(scan: RefugoScan): RefugoScan {
  const timestamp = Number(scan.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return {
      ...scan,
      scannedAt: new Date(timestamp).toISOString(),
    };
  }

  const raw = String(scan.scannedAt || '').trim();
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = br;
    const parsed = new Date(
      Number(yyyy),
      Number(mm) - 1,
      Number(dd),
      Number(hh),
      Number(min),
      Number(ss)
    );
    if (!Number.isNaN(parsed.getTime())) {
      return {
        ...scan,
        scannedAt: parsed.toISOString(),
      };
    }
  }

  return scan;
}

const metricBackfillKeys = new Set<string>();
let metricBackfillChain: Promise<void> = Promise.resolve();

function schedulePermanentBackfill(scans: RefugoScan[]): void {
  const unique: RefugoScan[] = [];

  for (const scan of scans) {
    if (!scan?.normalizedId) continue;
    const key = eventKeyFromScan(scan);
    if (metricBackfillKeys.has(key)) continue;
    metricBackfillKeys.add(key);
    unique.push(scan);
  }

  if (unique.length === 0) return;

  metricBackfillChain = metricBackfillChain
    .then(async () => {
      const concurrency = 4;
      for (let i = 0; i < unique.length; i += concurrency) {
        const chunk = unique.slice(i, i + concurrency);
        await Promise.allSettled(
          chunk.map(scan => persistRefugoMetricScan(scan))
        );
      }
    })
    .catch(error => {
      console.warn('Falha parcial ao migrar scans atuais para métricas permanentes:', error);
    });
}

export function listenToRefugoScansIncremental(
  callback: (changes: RefugoScanChange[], isInitial: boolean, initialScans?: RefugoScan[]) => void,
  onError?: (error: any) => void
): () => void {
  return listenToCoreRefugoScansIncremental(
    (changes, isInitial, initialScans) => {
      if (isInitial && initialScans?.length) {
        schedulePermanentBackfill(initialScans);
      } else if (changes.length > 0) {
        schedulePermanentBackfill(
          changes
            .filter(change => change.type !== 'removed')
            .map(change => change.scan)
        );
      }

      callback(changes, isInitial, initialScans);
    },
    onError
  );
}

export function listenToRefugoScans(
  callback: (scans: RefugoScan[]) => void
): () => void {
  let transientScans: RefugoScan[] = [];
  let permanentItems: RefugoMetricItem[] = [];
  let permanentReady = false;

  const emit = () => {
    if (!permanentReady) {
      callback(transientScans);
      return;
    }

    const permanentById = new Map(
      permanentItems.map(item => [item.normalizedId, item])
    );

    const pending = transientScans
      .filter(scan => {
        const permanent = permanentById.get(scan.normalizedId);
        return !permanent || permanent.lastEventKey !== eventKeyFromScan(scan);
      })
      .map(scan => {
        if (isBrancaOrWithoutRoute(scan)) {
          return { ...scan, status: 'not_found' as const };
        }
        return scan;
      });

    callback(pending);
  };

  const unsubTransient = listenToTransientRefugoScans(scans => {
    // Corrige imediatamente a métrica ativa, antes mesmo do backfill terminar.
    transientScans = scans.map(normalizeScanForDashboard);
    schedulePermanentBackfill(scans);
    emit();
  });

  const unsubPermanent = listenToRefugoMetricItems(
    items => {
      permanentItems = items;
      permanentReady = true;
      emit();
    },
    () => {
      permanentReady = false;
      emit();
    }
  );

  return () => {
    unsubTransient();
    unsubPermanent();
  };
}

interface DailyAccumulator {
  totalBipados: number;
  totalEncontrados: number;
  totalBrancas: number;
  rotasEncontradas: Record<string, number>;
}

function getDailyAccumulator(
  map: Map<string, DailyAccumulator>,
  date: string
): DailyAccumulator {
  let current = map.get(date);
  if (!current) {
    current = {
      totalBipados: 0,
      totalEncontrados: 0,
      totalBrancas: 0,
      rotasEncontradas: {},
    };
    map.set(date, current);
  }
  return current;
}

export function listenToRefugoHistoricoMetricas(
  callback: (metricas: RefugoHistoricoMetrica[]) => void
): () => void {
  let legacy: RefugoHistoricoMetrica[] = [];
  let permanentItems: RefugoMetricItem[] = [];
  let permanentReady = false;

  const emit = () => {
    if (!permanentReady || permanentItems.length === 0) {
      callback(legacy);
      return;
    }

    let firstPermanentTimestamp = Number.POSITIVE_INFINITY;
    for (const item of permanentItems) {
      if (item.firstSeenTimestamp > 0 && item.firstSeenTimestamp < firstPermanentTimestamp) {
        firstPermanentTimestamp = item.firstSeenTimestamp;
      }
    }

    const legacyBeforePermanent = Number.isFinite(firstPermanentTimestamp)
      ? legacy.filter(item => Number(item.timestamp || 0) < firstPermanentTimestamp)
      : legacy;

    const daily = new Map<string, DailyAccumulator>();

    for (const item of permanentItems) {
      if (item.firstSeenDate) {
        getDailyAccumulator(daily, item.firstSeenDate).totalBipados += 1;
      }

      if (item.everRouteFound && item.firstRouteFoundDate) {
        const bucket = getDailyAccumulator(daily, item.firstRouteFoundDate);
        bucket.totalEncontrados += 1;
        const route = String(item.rotaEncontrada || 'SEM ROTA').trim() || 'SEM ROTA';
        bucket.rotasEncontradas[route] = (bucket.rotasEncontradas[route] || 0) + 1;
      }

      if (item.everBranca && item.firstBrancaDate) {
        getDailyAccumulator(daily, item.firstBrancaDate).totalBrancas += 1;
      }
    }

    const permanentDaily: RefugoHistoricoMetrica[] = Array.from(daily.entries())
      .map(([date, totals]) => ({
        id: `permanent-day-${date}`,
        data: date,
        dataHora: `${date} • consolidado permanente`,
        timestamp: new Date(`${date}T12:00:00`).getTime(),
        responsavel: 'Sistema',
        totalBipados: totals.totalBipados,
        totalEncontrados: totals.totalEncontrados,
        totalBrancas: totals.totalBrancas,
        rotasEncontradas: totals.rotasEncontradas,
        origem: 'auto_sync' as const,
      }))
      .sort((a, b) => b.timestamp - a.timestamp);

    callback(
      [...permanentDaily, ...legacyBeforePermanent].sort(
        (a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0)
      )
    );
  };

  const unsubLegacy = listenToLegacyRefugoHistoricoMetricas(items => {
    legacy = items;
    emit();
  });

  const unsubPermanent = listenToRefugoMetricItems(
    items => {
      permanentItems = items;
      permanentReady = true;
      emit();
    },
    () => {
      permanentReady = false;
      emit();
    }
  );

  return () => {
    unsubLegacy();
    unsubPermanent();
  };
}
