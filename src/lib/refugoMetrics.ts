import {
  collection,
  doc,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from './firebase-core';
import type { RefugoScan } from './firebase-core';

export const REFUGO_METRIC_ITEMS_COLLECTION = 'refugo_metricas_items';
export const REFUGO_DAILY_METRICS_COLLECTION = 'refugo_metricas_diarias';

export interface RefugoMetricItem {
  id: string;
  packageId: string;
  normalizedId: string;
  everFoundInBase: boolean;
  everRouteFound: boolean;
  everBranca: boolean;
  firstSeenAt: string;
  firstSeenTimestamp: number;
  firstSeenDate: string;
  lastSeenAt: string;
  lastSeenTimestamp: number;
  lastSeenDate: string;
  firstRouteFoundAt?: string;
  firstRouteFoundTimestamp?: number;
  firstRouteFoundDate?: string;
  rotaEncontrada?: string;
  firstBrancaAt?: string;
  firstBrancaTimestamp?: number;
  firstBrancaDate?: string;
  lastStatus: 'found' | 'not_found';
  lastRota: string;
  firstFoundBy?: string;
  lastFoundBy?: string;
  scanCount: number;
  lastEventKey: string;
  createdAt?: unknown;
  updatedAt?: unknown;
}

export interface RefugoDailyMetric {
  id: string;
  date: string;
  totalUniqueBipados: number;
  totalRotasEncontradas: number;
  totalBrancasEncontradas: number;
  updatedAt?: unknown;
}

export interface RefugoPermanentSummary {
  totalUniqueBipados: number;
  totalRotasEncontradas: number;
  totalBrancasEncontradas: number;
  taxaLocalizacao: number;
  rotas: Record<string, number>;
}

function toDateKey(timestamp: number): string {
  const date = new Date(timestamp);
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeRoute(route: string | undefined): string {
  return String(route || '').trim();
}

export function isBrancaRefugoScan(scan: Pick<RefugoScan, 'status' | 'rota'>): boolean {
  const route = normalizeRoute(scan.rota);
  const upper = route.toUpperCase();

  return (
    scan.status !== 'found' ||
    !route ||
    upper.includes('SEM ROTA') ||
    upper.includes('BRANCA')
  );
}

export function hasValidRouteRefugoScan(scan: Pick<RefugoScan, 'status' | 'rota'>): boolean {
  if (scan.status !== 'found') return false;

  const route = normalizeRoute(scan.rota);
  const upper = route.toUpperCase();

  return Boolean(
    route &&
    !upper.includes('SEM ROTA') &&
    !upper.includes('BRANCA')
  );
}

function inPeriod(dateKey: string | undefined, startDate?: string, endDate?: string): boolean {
  if (!dateKey) return false;
  if (startDate && dateKey < startDate) return false;
  if (endDate && dateKey > endDate) return false;
  return true;
}

/**
 * Persiste um bip como dado histórico permanente e idempotente.
 *
 * Regras:
 * - 1 documento por pacote normalizado: nunca infla a métrica por retry/reload.
 * - retries do mesmo bip são ignorados via lastEventKey.
 * - "rota encontrada" nunca volta para falso.
 * - "branca" nunca volta para falso depois de identificada.
 * - limpar a mesa do Refugo NÃO toca nesta coleção.
 * - agregados diários são atualizados somente na primeira ocorrência de cada marco.
 */
export async function persistRefugoMetricScan(
  scan: Omit<RefugoScan, 'firestoreId'>
): Promise<RefugoMetricItem> {
  if (!scan?.normalizedId) {
    throw new Error('Não foi possível salvar a métrica: ID normalizado ausente.');
  }

  const normalizedId = scan.normalizedId;
  const timestamp = Number(scan.timestamp) || Date.now();
  const dateKey = toDateKey(timestamp);
  const eventKey = `${normalizedId}:${timestamp}`;
  const route = normalizeRoute(scan.rota);
  const foundInBase = scan.status === 'found';
  const routeFoundNow = hasValidRouteRefugoScan(scan);
  const brancaNow = isBrancaRefugoScan(scan);

  const metricRef = doc(db, REFUGO_METRIC_ITEMS_COLLECTION, normalizedId);
  const dailyRef = doc(db, REFUGO_DAILY_METRICS_COLLECTION, dateKey);

  return runTransaction(db, async transaction => {
    const snap = await transaction.get(metricRef);
    const previous = snap.exists() ? (snap.data() as Partial<RefugoMetricItem>) : null;

    if (previous?.lastEventKey === eventKey) {
      return {
        ...(previous as RefugoMetricItem),
        id: normalizedId,
      };
    }

    const isFirstSeen = !previous;
    const isFirstRouteFound = routeFoundNow && !previous?.everRouteFound;
    const isFirstBranca = brancaNow && !previous?.everBranca;

    const firstSeenTimestamp = previous?.firstSeenTimestamp || timestamp;
    const firstSeenAt = previous?.firstSeenAt || scan.scannedAt || new Date(timestamp).toISOString();
    const firstSeenDate = previous?.firstSeenDate || toDateKey(firstSeenTimestamp);

    const next: RefugoMetricItem = {
      id: normalizedId,
      packageId: previous?.packageId || scan.id,
      normalizedId,
      everFoundInBase: Boolean(previous?.everFoundInBase || foundInBase),
      everRouteFound: Boolean(previous?.everRouteFound || routeFoundNow),
      everBranca: Boolean(previous?.everBranca || brancaNow),
      firstSeenAt,
      firstSeenTimestamp,
      firstSeenDate,
      lastSeenAt: scan.scannedAt || new Date(timestamp).toISOString(),
      lastSeenTimestamp: timestamp,
      lastSeenDate: dateKey,
      firstRouteFoundAt: previous?.firstRouteFoundAt || (isFirstRouteFound ? (scan.scannedAt || new Date(timestamp).toISOString()) : undefined),
      firstRouteFoundTimestamp: previous?.firstRouteFoundTimestamp || (isFirstRouteFound ? timestamp : undefined),
      firstRouteFoundDate: previous?.firstRouteFoundDate || (isFirstRouteFound ? dateKey : undefined),
      rotaEncontrada: previous?.rotaEncontrada || (isFirstRouteFound ? route : undefined),
      firstBrancaAt: previous?.firstBrancaAt || (isFirstBranca ? (scan.scannedAt || new Date(timestamp).toISOString()) : undefined),
      firstBrancaTimestamp: previous?.firstBrancaTimestamp || (isFirstBranca ? timestamp : undefined),
      firstBrancaDate: previous?.firstBrancaDate || (isFirstBranca ? dateKey : undefined),
      lastStatus: scan.status,
      lastRota: route,
      firstFoundBy: previous?.firstFoundBy || (isFirstRouteFound ? scan.foundBy : undefined),
      lastFoundBy: scan.foundBy || previous?.lastFoundBy,
      scanCount: Math.max(0, Number(previous?.scanCount || 0)) + 1,
      lastEventKey: eventKey,
      createdAt: previous?.createdAt || serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    transaction.set(metricRef, next, { merge: true });

    const dailyUpdates: Record<string, unknown> = {
      id: dateKey,
      date: dateKey,
      updatedAt: serverTimestamp(),
    };

    if (isFirstSeen) dailyUpdates.totalUniqueBipados = increment(1);
    if (isFirstRouteFound) dailyUpdates.totalRotasEncontradas = increment(1);
    if (isFirstBranca) dailyUpdates.totalBrancasEncontradas = increment(1);

    if (isFirstSeen || isFirstRouteFound || isFirstBranca) {
      transaction.set(dailyRef, dailyUpdates, { merge: true });
    }

    return next;
  });
}

export function listenToRefugoMetricItems(
  callback: (items: RefugoMetricItem[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(
    collection(db, REFUGO_METRIC_ITEMS_COLLECTION),
    orderBy('lastSeenTimestamp', 'desc')
  );

  return onSnapshot(
    q,
    snap => {
      callback(
        snap.docs.map(document => ({
          ...(document.data() as RefugoMetricItem),
          id: document.id,
        }))
      );
    },
    error => {
      console.error('Erro ao carregar métricas permanentes do Refugo:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export function listenToRefugoDailyMetrics(
  callback: (items: RefugoDailyMetric[]) => void,
  onError?: (error: Error) => void
): () => void {
  const q = query(
    collection(db, REFUGO_DAILY_METRICS_COLLECTION),
    orderBy('date', 'desc')
  );

  return onSnapshot(
    q,
    snap => {
      callback(
        snap.docs.map(document => ({
          id: document.id,
          date: document.id,
          totalUniqueBipados: Number(document.data().totalUniqueBipados || 0),
          totalRotasEncontradas: Number(document.data().totalRotasEncontradas || 0),
          totalBrancasEncontradas: Number(document.data().totalBrancasEncontradas || 0),
          updatedAt: document.data().updatedAt,
        }))
      );
    },
    error => {
      console.error('Erro ao carregar agregados diários do Refugo:', error);
      onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  );
}

export function calculateRefugoPermanentSummary(
  items: RefugoMetricItem[],
  startDate?: string,
  endDate?: string
): RefugoPermanentSummary {
  let totalUniqueBipados = 0;
  let totalRotasEncontradas = 0;
  let totalBrancasEncontradas = 0;
  const rotas: Record<string, number> = {};

  for (const item of items) {
    if (inPeriod(item.firstSeenDate, startDate, endDate)) {
      totalUniqueBipados++;
    }

    if (item.everRouteFound && inPeriod(item.firstRouteFoundDate, startDate, endDate)) {
      totalRotasEncontradas++;
      const route = normalizeRoute(item.rotaEncontrada) || 'SEM ROTA';
      rotas[route] = (rotas[route] || 0) + 1;
    }

    if (item.everBranca && inPeriod(item.firstBrancaDate, startDate, endDate)) {
      totalBrancasEncontradas++;
    }
  }

  return {
    totalUniqueBipados,
    totalRotasEncontradas,
    totalBrancasEncontradas,
    taxaLocalizacao: totalUniqueBipados > 0
      ? Math.round((totalRotasEncontradas / totalUniqueBipados) * 100)
      : 0,
    rotas,
  };
}
