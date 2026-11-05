import { collection, getDocs } from 'firebase/firestore';
import type { ColetaItem } from '../types';
import {
  db,
  fetchOrGetCachedListaItens,
  getCachedListasMetadata,
  isListaFromTodayCore,
} from './firebase-core';

export type ListaCycle = 'AM' | 'PM' | 'SD';

export interface TodayListOccurrence {
  item: ColetaItem;
  listaId: string;
  listaNome: string;
  listaData: string;
  listaSaida: string;
  listaTipo: string;
  grupoId?: string;
  grupoNome: string;
}

function cleanDigits(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function normalizeCode(value: unknown): { upper: string; digits: string } {
  const upper = String(value || '').trim().toUpperCase();
  return { upper, digits: cleanDigits(upper) };
}

function cycleKey(value: unknown): ListaCycle | '' {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/(^|[^A-Z])AM([^A-Z]|$)/.test(raw)) return 'AM';
  if (/(^|[^A-Z])PM([^A-Z]|$)/.test(raw)) return 'PM';
  if (/(^|[^A-Z])SD([^A-Z]|$)/.test(raw)) return 'SD';
  return '';
}

function canonicalSaida(cycle: ListaCycle): string {
  if (cycle === 'AM') return 'Ciclo 1 - Saída AM';
  if (cycle === 'SD') return 'Ciclo 3 - Saída SD';
  return 'Ciclo 2 - Saída PM';
}

function resolveTodayListaSaida(lista: Record<string, any>, item?: Partial<ColetaItem>): string {
  const nameCycle = cycleKey(lista.nome);
  const configuredCycle = cycleKey(lista.saidaPadrao);

  if (nameCycle && configuredCycle && nameCycle !== configuredCycle) {
    return canonicalSaida(nameCycle);
  }

  if (configuredCycle) return canonicalSaida(configuredCycle);
  if (nameCycle) return canonicalSaida(nameCycle);

  const itemCycle = cycleKey(item?.saida);
  if (itemCycle) return canonicalSaida(itemCycle);

  return String(lista.saidaPadrao || item?.saida || '').trim();
}

function groupNameFor(lista: Record<string, any>, grupoId?: string): string {
  if (!grupoId || !Array.isArray(lista.grupos)) return '';
  const grupo = lista.grupos.find((entry: any) => String(entry?.id || '') === grupoId);
  return String(grupo?.nome || '').trim();
}

/**
 * Busca TODAS as ocorrências de cada ID somente nas listas do dia atual,
 * compartilhando o cache em memória e requisições em voo com o searchItemsAcrossAllListas.
 */
export async function searchTodayListOccurrences(
  terms: string[]
): Promise<Map<string, TodayListOccurrence[]>> {
  const resultMaps = new Map<string, Map<string, TodayListOccurrence>>();
  if (!terms || terms.length === 0) return new Map();

  const normalizedTerms = terms
    .map(normalizeCode)
    .filter(term => term.upper || term.digits);

  const uniqueUpper = Array.from(new Set(normalizedTerms.map(term => term.upper).filter(Boolean)));
  const uniqueDigits = Array.from(new Set(normalizedTerms.map(term => term.digits).filter(Boolean)));
  const wanted = new Set([...uniqueUpper, ...uniqueDigits]);
  if (wanted.size === 0) return new Map();

  const addOccurrence = (
    rawItem: ColetaItem,
    listaId: string,
    lista: Record<string, any>
  ) => {
    const codigo = String(rawItem.codigo || '').trim();
    if (!codigo) return;

    const normalized = normalizeCode(codigo);
    if (!wanted.has(normalized.upper) && (!normalized.digits || !wanted.has(normalized.digits))) return;

    const item: ColetaItem = {
      ...rawItem,
      codigo,
      codigoClean: rawItem.codigoClean || normalized.digits,
    };
    const occurrence: TodayListOccurrence = {
      item,
      listaId,
      listaNome: String(lista.nome || listaId),
      listaData: String(lista.data || ''),
      listaSaida: resolveTodayListaSaida(lista, item),
      listaTipo: String(lista.tipo || ''),
      grupoId: item.grupoId,
      grupoNome: groupNameFor(lista, item.grupoId),
    };
    const occurrenceKey = `${listaId}:${String(item.id || normalized.upper)}:${occurrence.grupoId || ''}`;

    const keys = [normalized.upper, normalized.digits].filter(Boolean);
    keys.forEach(key => {
      if (!resultMaps.has(key)) resultMaps.set(key, new Map());
      resultMaps.get(key)!.set(occurrenceKey, occurrence);
    });
  };

  let allListas: Array<Record<string, any> & { id: string }> = getCachedListasMetadata();
  if (allListas.length === 0) {
    const listasSnapshot = await getDocs(collection(db, 'coleta_listas'));
    allListas = listasSnapshot.docs.map(docSnap => ({
      ...(docSnap.data() as Record<string, any>),
      id: docSnap.id,
    }));
  }

  const todayListas = allListas.filter(lista => isListaFromTodayCore(lista));

  await Promise.all(todayListas.map(async lista => {
    const listaId = lista.id;

    if (Array.isArray(lista.itens) && lista.itens.length > 0) {
      lista.itens.forEach((item: ColetaItem) => addOccurrence(item, listaId, lista));
    }

    try {
      const items = await fetchOrGetCachedListaItens(listaId, 30000);
      items.forEach(item => addOccurrence(item, listaId, lista));
    } catch (error) {
      console.warn(`[Busca multi-lista] Falha ao consultar itens da lista ${listaId}:`, error);
    }
  }));

  const results = new Map<string, TodayListOccurrence[]>();
  resultMaps.forEach((occurrences, key) => {
    const list = Array.from(occurrences.values()).sort((a, b) => {
      const aCycle = cycleKey(a.listaSaida);
      const bCycle = cycleKey(b.listaSaida);
      if (aCycle !== bCycle) return aCycle.localeCompare(bCycle);
      return a.listaNome.localeCompare(b.listaNome, undefined, { numeric: true, sensitivity: 'base' });
    });
    results.set(key, list);
  });

  return results;
}
