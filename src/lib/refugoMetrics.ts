import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  onSnapshot,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  writeBatch,
} from 'firebase/firestore';
import { db, REFUGO_HISTORICO_COLLECTION } from './firebase-core';
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
  return String(route || '').trim().toUpperCase();
}

export function isBrancaRefugoScan(scan: Pick<RefugoScan, 'status' | 'rota'>): boolean {
  const route = normalizeRoute(scan.rota);

  return (
    scan.status !== 'found' ||
    !route ||
    route.includes('SEM ROTA') ||
    route.includes('BRANCA')
  );
}

export function hasValidRouteRefugoScan(scan: Pick<RefugoScan, 'status' | 'rota'>): boolean {
  if (scan.status !== 'found') return false;

  const route = normalizeRoute(scan.rota);

  return Boolean(
    route &&
    !route.includes('SEM ROTA') &&
    !route.includes('BRANCA')
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
      rotaEncontrada: previous?.rotaEncontrada ? normalizeRoute(previous.rotaEncontrada) : (isFirstRouteFound ? route : undefined),
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
      const uniqueById = new Map<string, RefugoMetricItem>();
      snap.docs.forEach(document => {
        const data = document.data() as RefugoMetricItem;
        const key = String(data.normalizedId || document.id).trim();
        if (!key || uniqueById.has(key)) return;
        uniqueById.set(key, {
          ...data,
          id: document.id,
          normalizedId: key,
        });
      });
      callback(Array.from(uniqueById.values()));
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
  const seenIds = new Set<string>();

  for (const item of items) {
    const key = String(item.normalizedId || item.id || item.packageId || '').trim();
    if (!key || seenIds.has(key)) continue;
    seenIds.add(key);

    if (inPeriod(item.firstSeenDate, startDate, endDate)) {
      totalUniqueBipados++;
    }

    const candidateRoute = normalizeRoute(item.rotaEncontrada || item.lastRota);
    const hasValidRoute =
      item.everRouteFound &&
      hasValidRouteRefugoScan({ status: 'found', rota: candidateRoute });

    if (hasValidRoute && inPeriod(item.firstRouteFoundDate || item.firstSeenDate, startDate, endDate)) {
      totalRotasEncontradas++;
      rotas[candidateRoute] = (rotas[candidateRoute] || 0) + 1;
    }

    if (item.everBranca && inPeriod(item.firstBrancaDate || item.firstSeenDate, startDate, endDate)) {
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

/**
 * Exclui permanentemente um item de métrica do Refugo (e também o scan ativo se existir).
 */
export async function deleteRefugoMetricItem(normalizedId: string): Promise<void> {
  const id = String(normalizedId || '').trim();
  if (!id) return;

  await Promise.allSettled([
    deleteDoc(doc(db, REFUGO_METRIC_ITEMS_COLLECTION, id)),
    deleteDoc(doc(db, 'refugo_scans_items', id)),
  ]);
}

/**
 * Exclui todos os itens encontrados de uma rota específica (no período informado, se houver)
 * tanto na coleção permanente quanto nos scans ativos e nos registros históricos legados.
 */
export async function deleteRefugoMetricRoute(
  rawRoute: string,
  startDate?: string,
  endDate?: string
): Promise<void> {
  const targetRoute = normalizeRoute(rawRoute);
  if (!targetRoute) return;

  // 1. Remove da coleção permanente refugo_metricas_items
  const permSnap = await getDocs(collection(db, REFUGO_METRIC_ITEMS_COLLECTION));
  const permToDelete = permSnap.docs.filter(d => {
    const data = d.data() as RefugoMetricItem;
    const itemRoute = normalizeRoute(data.rotaEncontrada || data.lastRota);
    if (itemRoute !== targetRoute) return false;
    const dateKey = data.firstRouteFoundDate || data.firstSeenDate;
    return !dateKey || inPeriod(dateKey, startDate, endDate);
  });

  for (let i = 0; i < permToDelete.length; i += 400) {
    const batch = writeBatch(db);
    permToDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. Remove dos scans ativos refugo_scans_items
  const scansSnap = await getDocs(collection(db, 'refugo_scans_items'));
  const scansToDelete = scansSnap.docs.filter(d => {
    const data = d.data() as RefugoScan;
    return normalizeRoute(data.rota) === targetRoute;
  });

  for (let i = 0; i < scansToDelete.length; i += 400) {
    const batch = writeBatch(db);
    scansToDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 3. Atualiza sessões legadas em refugo_historico_metricas que contenham essa rota
  const histSnap = await getDocs(collection(db, REFUGO_HISTORICO_COLLECTION));
  const histBatch = writeBatch(db);
  let histCount = 0;

  histSnap.docs.forEach(d => {
    const data = d.data();
    const rawRotas: Record<string, number> = data.rotasEncontradas || {};
    let removedQty = 0;
    const nextRotas: Record<string, number> = {};

    for (const [k, v] of Object.entries(rawRotas)) {
      if (normalizeRoute(k) === targetRoute) {
        removedQty += Number(v || 0);
      } else {
        nextRotas[k] = Number(v || 0);
      }
    }

    if (removedQty > 0) {
      const nextEncontrados = Math.max(0, Number(data.totalEncontrados || 0) - removedQty);
      const nextBipados = Math.max(0, Number(data.totalBipados || 0) - removedQty);
      if (nextEncontrados === 0 && Number(data.totalBrancas || 0) === 0) {
        histBatch.delete(d.ref);
      } else {
        histBatch.update(d.ref, {
          rotasEncontradas: nextRotas,
          totalEncontrados: nextEncontrados,
          totalBipados: nextBipados,
        });
      }
      histCount++;
    }
  });

  if (histCount > 0) {
    await histBatch.commit();
  }
}

/**
 * Exclui todos os registros permanentes, diários e legados de uma data específica (YYYY-MM-DD).
 */
export async function deleteRefugoMetricsByDate(dateIso: string): Promise<void> {
  const targetDate = String(dateIso || '').trim();
  if (!targetDate) return;

  // 1. Exclui itens permanentes daquela data
  const permSnap = await getDocs(collection(db, REFUGO_METRIC_ITEMS_COLLECTION));
  const permToDelete = permSnap.docs.filter(d => {
    const data = d.data() as RefugoMetricItem;
    return (
      data.firstSeenDate === targetDate ||
      data.firstRouteFoundDate === targetDate ||
      data.firstBrancaDate === targetDate ||
      data.lastSeenDate === targetDate
    );
  });

  for (let i = 0; i < permToDelete.length; i += 400) {
    const batch = writeBatch(db);
    permToDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }

  // 2. Exclui consolidado diário refugo_metricas_diarias/{targetDate}
  await deleteDoc(doc(db, REFUGO_DAILY_METRICS_COLLECTION, targetDate)).catch(() => {});

  // 3. Exclui registros legados daquela data em refugo_historico_metricas
  const histSnap = await getDocs(collection(db, REFUGO_HISTORICO_COLLECTION));
  const histToDelete = histSnap.docs.filter(d => {
    const data = d.data();
    const itemDate = String(data.data || '').trim();
    if (itemDate === targetDate) return true;
    if (data.timestamp && Number.isFinite(Number(data.timestamp))) {
      const dt = new Date(Number(data.timestamp));
      const iso = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      return iso === targetDate;
    }
    return false;
  });

  for (let i = 0; i < histToDelete.length; i += 400) {
    const batch = writeBatch(db);
    histToDelete.slice(i, i + 400).forEach(d => batch.delete(d.ref));
    await batch.commit();
  }
}
