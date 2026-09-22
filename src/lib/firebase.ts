// Facade público do Firebase.
//
// O núcleo original permanece em `firebase-core.ts`. Esta camada mantém todos os
// exports existentes e substitui somente as leituras que precisam de semântica
// consolidada para o dashboard e para as métricas permanentes.
export * from './firebase-core';

import {
  listenToListas as listenToCoreListas,
  listenToRefugoHistoricoMetricas as listenToLegacyRefugoHistoricoMetricas,
  listenToRefugoScans as listenToTransientRefugoScans,
  listenToRefugoScansIncremental as listenToCoreRefugoScansIncremental,
} from './firebase-core';
import type { RefugoScan, RefugoScanChange } from './firebase-core';
import type { ColetaLista, RefugoHistoricoMetrica } from '../types';
import {
  listenToRefugoMetricItems,
  persistRefugoMetricScan,
  RefugoMetricItem,
} from './refugoMetrics';

/**
 * Normaliza a porcentagem de acerto das listas para a Visão Geral.
 *
 * Regra:
 * 1. Se já existe porcentagemAcerto gravada, ela é a fonte oficial.
 * 2. Se não existe e há total + itensFaltaram, deriva o acerto real.
 * 3. Se não existe fechamento, usa validação/total como fallback mensurável.
 * 4. Nunca assume 100% só porque o campo ainda não foi preenchido.
 */
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

/**
 * Mantém as listas vindas do servidor, mas garante que a média de acerto do
 * Admin não transforme automaticamente campo ausente em 100%.
 */
export function listenToListas(
  callback: (listas: ColetaLista[]) => void
): () => void {
  return listenToCoreListas(listas => {
    callback(
      listas.map(lista => ({
        ...lista,
        porcentagemAcerto: deriveListaAccuracy(lista),
      }))
    );
  });
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

// Evita que o backfill inicial de milhares de scans abra milhares de transações
// simultâneas. A carga é processada em pequenos grupos e cada item continua
// idempotente pelo eventKey no Firestore.
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

/**
 * Wrapper do listener operacional incremental.
 *
 * A UI recebe exatamente os mesmos eventos do core, mas todo scan já existente
 * na mesa (inclusive dados anteriores ao deploy desta versão) entra em backfill
 * para a coleção permanente. Assim, limpar a mesa depois do deploy não perde os
 * IDs que já estavam carregados.
 */
export function listenToRefugoScansIncremental(
  callback: (changes: RefugoScanChange[], isInitial: boolean, initialScans?: RefugoScan[]) => void,
  onError?: (error: any) => void
): () => void {
  return listenToCoreRefugoScansIncremental(
    (changes, isInitial, initialScans) => {
      if (isInitial && initialScans?.length) {
        schedulePermanentBackfill(initialScans);
      } else if (changes.length > 0) {
        const changedScans = changes
          .filter(change => change.type !== 'removed')
          .map(change => change.scan);
        schedulePermanentBackfill(changedScans);
      }

      callback(changes, isInitial, initialScans);
    },
    onError
  );
}

/**
 * Para o dashboard, "scans ativos" passam a significar somente gravações que
 * ainda não chegaram à coleção permanente. Assim que o registro permanente é
 * confirmado, ele sai desta lista e passa a ser representado pelo histórico
 * diário consolidado, eliminando dupla contagem.
 */
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
    transientScans = scans;
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

/**
 * Une o histórico legado (somente o período anterior ao primeiro registro
 * permanente) com resumos diários derivados dos documentos permanentes.
 *
 * O AdminPanel já sabe filtrar `RefugoHistoricoMetrica` por data, então esta
 * adaptação corrige automaticamente os cards "Rotas encontradas" e "Rotas
 * brancas" da visão geral sem depender da limpeza da mesa.
 */
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
