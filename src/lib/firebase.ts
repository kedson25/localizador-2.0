// Facade público do Firebase.
// Mantém o núcleo original em firebase-core.ts e adiciona uma camada resiliente
// de persistência local para evitar perda visual de dados em refresh/instabilidade.
export * from './firebase-core';

import {
  listenToListas as listenToCoreListas,
  saveLista as saveListaCore,
  deleteLista as deleteListaCore,
  listenToListaItens as listenToListaItensCore,
  addItemToLista as addItemToListaCore,
  updateItemInLista as updateItemInListaCore,
  deleteItemFromLista as deleteItemFromListaCore,
  addItemsBatchToLista as addItemsBatchToListaCore,
  deleteItemsBatchFromLista as deleteItemsBatchFromListaCore,
  updateItemsBatchMotivo as updateItemsBatchMotivoCore,
  saveRefugo as saveRefugoCore,
  clearRefugo as clearRefugoCore,
  listenToRefugo as listenToRefugoCore,
  listenToRefugoHistoricoMetricas as listenToLegacyRefugoHistoricoMetricas,
  listenToRefugoScans as listenToTransientRefugoScans,
  listenToRefugoScansIncremental as listenToCoreRefugoScansIncremental,
  addRefugoScan as addRefugoScanCore,
  deleteRefugoScan as deleteRefugoScanCore,
  clearRefugoScans as clearRefugoScansCore,
  searchItemsAcrossAllListas as searchItemsAcrossAllListasCore,
  getAllItemsForExport as getAllItemsForExportCore,
} from './firebase-core';
import type { RefugoData, RefugoScan, RefugoScanChange } from './firebase-core';
import type { ColetaItem, ColetaLista, RefugoHistoricoMetrica } from '../types';
import {
  listenToRefugoMetricItems,
  persistRefugoMetricScan,
  RefugoMetricItem,
} from './refugoMetrics';
import {
  deleteLocalValue,
  getLocalValue,
  mutateLocalValue,
  setLocalValue,
} from './localPersistence';

const LOCAL_LISTAS_KEY = 'coleta:listas:v3';
const LOCAL_REFUGO_KEY = 'refugo:base:v3';
const LOCAL_REFUGO_SCANS_KEY = 'refugo:scans:v3';
const localListaItensKey = (listaId: string) => `coleta:lista:${listaId}:itens:v3`;

let todayListasCache: ColetaLista[] = [];
let todayListasCacheReady = false;

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

  if (rawData) {
    return (
      rawData === br ||
      rawData === iso ||
      rawData.startsWith(`${br} `) ||
      rawData.startsWith(`${iso}T`)
    );
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

function prepareAllListas(listas: ColetaLista[]): ColetaLista[] {
  return listas.map(lista => ({
    ...lista,
    porcentagemAcerto: deriveListaAccuracy(lista),
  }));
}

function prepareTodayListas(listas: ColetaLista[]): ColetaLista[] {
  return prepareAllListas(listas.filter(lista => isListaFromToday(lista)));
}

function listaWithoutEmbeddedItems(lista: Partial<ColetaLista> & { id: string }): ColetaLista {
  const { itens: _itens, ...metadata } = lista as any;
  return metadata as ColetaLista;
}

async function upsertListaLocal(lista: Partial<ColetaLista> & { id: string }): Promise<void> {
  const metadata = listaWithoutEmbeddedItems(lista);
  await mutateLocalValue<ColetaLista[]>(LOCAL_LISTAS_KEY, current => {
    const existing = current || [];
    const index = existing.findIndex(item => item.id === metadata.id);
    if (index < 0) return [metadata, ...existing];
    const next = [...existing];
    next[index] = { ...next[index], ...metadata };
    return next;
  });
}

async function ensureTodayListasCache(): Promise<void> {
  if (todayListasCacheReady) return;

  await new Promise<void>((resolve) => {
    let finished = false;
    let unsubscribe: (() => void) | null = null;

    const finish = (listas?: ColetaLista[]) => {
      if (finished) return;
      finished = true;

      if (listas) {
        todayListasCache = prepareTodayListas(listas);
        todayListasCacheReady = true;
      }

      if (unsubscribe) unsubscribe();
      resolve();
    };

    unsubscribe = listenToCoreListas(listas => finish(listas));
    window.setTimeout(() => finish(), 2500);
  });

  if (!todayListasCacheReady) {
    const cached = await getLocalValue<ColetaLista[]>(LOCAL_LISTAS_KEY);
    if (cached) {
      todayListasCache = prepareTodayListas(cached);
      todayListasCacheReady = true;
    }
  }
}

/**
 * Entrega TODAS as listas para que filtros de Hoje/Ontem/7 dias/15 dias funcionem.
 * A regra "consulta apenas listas do dia" fica isolada em searchItemsAcrossAllListas.
 * IndexedDB é usado apenas como fallback visual/local; o Firestore continua sendo
 * a fonte compartilhada principal.
 */
export function listenToListas(
  callback: (listas: ColetaLista[]) => void
): () => void {
  let remoteSeen = false;
  let remoteWasEmpty = false;
  let cachedListas: ColetaLista[] = [];

  void getLocalValue<ColetaLista[]>(LOCAL_LISTAS_KEY).then(cached => {
    cachedListas = prepareAllListas(cached || []);
    if (cachedListas.length > 0 && (!remoteSeen || remoteWasEmpty)) {
      callback(cachedListas);
    }
  });

  return listenToCoreListas(listas => {
    remoteSeen = true;
    remoteWasEmpty = listas.length === 0;

    if (listas.length === 0 && cachedListas.length > 0) {
      todayListasCache = prepareTodayListas(cachedListas);
      todayListasCacheReady = true;
      callback(cachedListas);
      return;
    }

    const prepared = prepareAllListas(listas);
    todayListasCache = prepareTodayListas(prepared);
    todayListasCacheReady = true;

    void setLocalValue(LOCAL_LISTAS_KEY, prepared);
    callback(prepared);
  });
}

export async function saveLista(
  lista: Partial<ColetaLista> & { id: string },
  immediate = false
): Promise<boolean> {
  await upsertListaLocal(lista);

  if (Array.isArray((lista as any).itens)) {
    await setLocalValue(localListaItensKey(lista.id), (lista as any).itens as ColetaItem[]);
  }

  try {
    return await saveListaCore(lista, immediate);
  } catch (error) {
    console.warn('Lista preservada localmente; sincronização remota falhou:', error);
    throw error;
  }
}

export async function deleteLista(listaId: string): Promise<boolean> {
  const result = await deleteListaCore(listaId);
  if (result) {
    await mutateLocalValue<ColetaLista[]>(LOCAL_LISTAS_KEY, current =>
      (current || []).filter(lista => lista.id !== listaId)
    );
    await deleteLocalValue(localListaItensKey(listaId));
  }
  return result;
}

export function listenToListaItens(
  listaId: string,
  callback: (itens: ColetaItem[]) => void,
  maxLimit = 10000
): () => void {
  if (!listaId) return () => {};

  const key = localListaItensKey(listaId);
  let remoteSeen = false;
  let remoteWasEmpty = false;
  let cachedItens: ColetaItem[] = [];

  void getLocalValue<ColetaItem[]>(key).then(cached => {
    cachedItens = cached || [];
    if (cachedItens.length > 0 && (!remoteSeen || remoteWasEmpty)) {
      callback(cachedItens);
    }
  });

  return listenToListaItensCore(listaId, itens => {
    remoteSeen = true;
    remoteWasEmpty = itens.length === 0;

    if (itens.length === 0 && cachedItens.length > 0) {
      callback(cachedItens);
      return;
    }

    void setLocalValue(key, itens);
    callback(itens);
  }, maxLimit);
}

export async function addItemToLista(
  listaId: string,
  item: Omit<ColetaItem, 'id'> & { id?: string }
): Promise<ColetaItem> {
  const itemWithId = {
    ...item,
    id: item.id || `item-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
  } as ColetaItem;

  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current => [
    itemWithId,
    ...(current || []).filter(existing => existing.id !== itemWithId.id),
  ]);

  return addItemToListaCore(listaId, itemWithId);
}

export async function updateItemInLista(
  listaId: string,
  itemId: string,
  updates: Partial<ColetaItem>,
  prevItem?: Partial<ColetaItem>
): Promise<boolean> {
  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current =>
    (current || []).map(item => item.id === itemId ? { ...item, ...updates } : item)
  );
  return updateItemInListaCore(listaId, itemId, updates, prevItem);
}

export async function deleteItemFromLista(
  listaId: string,
  itemId: string,
  itemData?: Partial<ColetaItem>
): Promise<boolean> {
  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current =>
    (current || []).filter(item => item.id !== itemId)
  );
  return deleteItemFromListaCore(listaId, itemId, itemData);
}

export async function addItemsBatchToLista(listaId: string, items: ColetaItem[]): Promise<boolean> {
  if (!items || items.length === 0) return true;
  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current => {
    const byId = new Map((current || []).map(item => [item.id, item]));
    items.forEach(item => byId.set(item.id, item));
    return Array.from(byId.values());
  });
  return addItemsBatchToListaCore(listaId, items);
}

export async function deleteItemsBatchFromLista(listaId: string, itemIds: string[]): Promise<boolean> {
  if (!itemIds || itemIds.length === 0) return true;
  const ids = new Set(itemIds);
  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current =>
    (current || []).filter(item => !ids.has(item.id))
  );
  return deleteItemsBatchFromListaCore(listaId, itemIds);
}

export async function updateItemsBatchMotivo(
  listaId: string,
  itemIds: string[],
  novoMotivo: string
): Promise<boolean> {
  if (!itemIds || itemIds.length === 0) return true;
  const ids = new Set(itemIds);
  await mutateLocalValue<ColetaItem[]>(localListaItensKey(listaId), current =>
    (current || []).map(item => ids.has(item.id) ? { ...item, motivo: novoMotivo } : item)
  );
  return updateItemsBatchMotivoCore(listaId, itemIds, novoMotivo);
}

export async function saveRefugo(rawText: string, totalRows: number, fileName?: string): Promise<boolean> {
  const localData: RefugoData = {
    rawText,
    totalRows,
    fileName: fileName || 'refugo.csv',
    updatedAt: new Date().toISOString(),
  };
  await setLocalValue(LOCAL_REFUGO_KEY, localData);
  return saveRefugoCore(rawText, totalRows, fileName);
}

export async function clearRefugo(): Promise<boolean> {
  const result = await clearRefugoCore();
  if (result) await deleteLocalValue(LOCAL_REFUGO_KEY);
  return result;
}

export function listenToRefugo(callback: (data: RefugoData | null) => void): () => void {
  let remoteSeen = false;
  let remoteIsEmpty = false;
  let cachedData: RefugoData | null = null;

  void getLocalValue<RefugoData>(LOCAL_REFUGO_KEY).then(cached => {
    cachedData = cached;
    if (cachedData && (!remoteSeen || remoteIsEmpty)) callback(cachedData);
  });

  return listenToRefugoCore(data => {
    remoteSeen = true;
    remoteIsEmpty = !data;

    if (!data && cachedData) {
      callback(cachedData);
      return;
    }

    if (data) void setLocalValue(LOCAL_REFUGO_KEY, data);
    callback(data);
  });
}

/**
 * Consulta IDs apenas nas listas do dia atual.
 * Histórico continua visível nas telas de listas, mas IDs de dias anteriores
 * não são retornados na consulta operacional.
 */
export async function searchItemsAcrossAllListas(
  terms: string[]
): Promise<Map<string, { item: ColetaItem; listaId: string }>> {
  const results = new Map<string, { item: ColetaItem; listaId: string }>();
  if (!terms || terms.length === 0) return results;

  await ensureTodayListasCache();

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
      if (!wanted.has(normalized.upper) && (!normalized.digits || !wanted.has(normalized.digits))) continue;

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

function normalizeRefugoRouteStatus(scan: RefugoScan): RefugoScan {
  const route = String(scan.rota || '').trim();
  const upper = route.toUpperCase();
  const hasValidRoute = Boolean(route) && !upper.includes('SEM ROTA') && !upper.includes('BRANCA');

  if (hasValidRoute && scan.status !== 'found') {
    return { ...scan, rota: route, status: 'found' };
  }

  if (!hasValidRoute && scan.status !== 'not_found') {
    return { ...scan, rota: route, status: 'not_found' };
  }

  return route === scan.rota ? scan : { ...scan, rota: route };
}

function eventKeyFromScan(scan: RefugoScan): string {
  return `${scan.normalizedId}:${Number(scan.timestamp) || 0}`;
}

function isBrancaOrWithoutRoute(scan: RefugoScan): boolean {
  const normalized = normalizeRefugoRouteStatus(scan);
  return normalized.status !== 'found';
}

function normalizeScanForDashboard(scan: RefugoScan): RefugoScan {
  const normalized = normalizeRefugoRouteStatus(scan);
  const timestamp = Number(normalized.timestamp);
  if (Number.isFinite(timestamp) && timestamp > 0) {
    return {
      ...normalized,
      scannedAt: new Date(timestamp).toISOString(),
    };
  }

  const raw = String(normalized.scannedAt || '').trim();
  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = br;
    const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
    if (!Number.isNaN(parsed.getTime())) {
      return {
        ...normalized,
        scannedAt: parsed.toISOString(),
      };
    }
  }

  return normalized;
}

export async function addRefugoScan(scan: Omit<RefugoScan, 'firestoreId'>): Promise<void> {
  const normalized = normalizeRefugoRouteStatus(scan as RefugoScan);
  await mutateLocalValue<RefugoScan[]>(LOCAL_REFUGO_SCANS_KEY, current => [
    normalized,
    ...(current || []).filter(item => item.normalizedId !== normalized.normalizedId),
  ]);
  await addRefugoScanCore(normalized);
}

export async function deleteRefugoScan(normalizedId: string): Promise<void> {
  await mutateLocalValue<RefugoScan[]>(LOCAL_REFUGO_SCANS_KEY, current =>
    (current || []).filter(item => item.normalizedId !== normalizedId)
  );
  await deleteRefugoScanCore(normalizedId);
}

export async function clearRefugoScans(): Promise<boolean> {
  const result = await clearRefugoScansCore();
  if (result) await deleteLocalValue(LOCAL_REFUGO_SCANS_KEY);
  return result;
}

const metricBackfillKeys = new Set<string>();
let metricBackfillChain: Promise<void> = Promise.resolve();

function schedulePermanentBackfill(scans: RefugoScan[]): void {
  const unique: RefugoScan[] = [];

  for (const rawScan of scans) {
    const scan = normalizeRefugoRouteStatus(rawScan);
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
        await Promise.allSettled(chunk.map(scan => persistRefugoMetricScan(scan)));
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
  let remoteInitialSeen = false;
  let cachedScans: RefugoScan[] = [];

  void getLocalValue<RefugoScan[]>(LOCAL_REFUGO_SCANS_KEY).then(cached => {
    cachedScans = (cached || []).map(normalizeRefugoRouteStatus);
    if (!remoteInitialSeen && cachedScans.length > 0) {
      callback([], true, cachedScans);
    }
  });

  return listenToCoreRefugoScansIncremental(
    (changes, isInitial, initialScans) => {
      if (isInitial) {
        remoteInitialSeen = true;
        const normalizedInitial = (initialScans || []).map(normalizeRefugoRouteStatus);
        const effectiveInitial = normalizedInitial.length > 0 ? normalizedInitial : cachedScans;
        if (normalizedInitial.length > 0) void setLocalValue(LOCAL_REFUGO_SCANS_KEY, normalizedInitial);
        if (effectiveInitial.length > 0) schedulePermanentBackfill(effectiveInitial);
        callback([], true, effectiveInitial);
        return;
      }

      const normalizedChanges = changes.map(change => ({
        ...change,
        scan: normalizeRefugoRouteStatus(change.scan),
      }));

      if (normalizedChanges.length > 0) {
        void mutateLocalValue<RefugoScan[]>(LOCAL_REFUGO_SCANS_KEY, current => {
          const map = new Map((current || []).map(scan => [scan.normalizedId, scan]));
          normalizedChanges.forEach(change => {
            if (change.type === 'removed') map.delete(change.scan.normalizedId);
            else map.set(change.scan.normalizedId, change.scan);
          });
          return Array.from(map.values()).sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0));
        });

        schedulePermanentBackfill(
          normalizedChanges.filter(change => change.type !== 'removed').map(change => change.scan)
        );
      }

      callback(normalizedChanges, false);
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

    const permanentById = new Map(permanentItems.map(item => [item.normalizedId, item]));

    const pending = transientScans
      .filter(scan => {
        const permanent = permanentById.get(scan.normalizedId);
        return !permanent || permanent.lastEventKey !== eventKeyFromScan(scan);
      })
      .map(normalizeRefugoRouteStatus);

    callback(pending);
  };

  void getLocalValue<RefugoScan[]>(LOCAL_REFUGO_SCANS_KEY).then(cached => {
    if (transientScans.length === 0 && cached?.length) {
      transientScans = cached.map(normalizeScanForDashboard);
      emit();
    }
  });

  const unsubTransient = listenToTransientRefugoScans(scans => {
    transientScans = scans.map(normalizeScanForDashboard);
    void setLocalValue(LOCAL_REFUGO_SCANS_KEY, transientScans);
    schedulePermanentBackfill(transientScans);
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

function getDailyAccumulator(map: Map<string, DailyAccumulator>, date: string): DailyAccumulator {
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
      if (item.firstSeenDate) getDailyAccumulator(daily, item.firstSeenDate).totalBipados += 1;

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
