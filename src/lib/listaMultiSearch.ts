import { collection, getDocs, query, where } from 'firebase/firestore';
import type { ColetaItem, ColetaLista } from '../types';
import { db } from './firebase-core';

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

function isListaFromToday(lista: Partial<ColetaLista> & Record<string, any>, now = new Date()): boolean {
  const day = String(now.getDate()).padStart(2, '0');
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const year = String(now.getFullYear());
  const br = `${day}/${month}/${year}`;
  const iso = `${year}-${month}-${day}`;
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

function resolveTodayListaSaida(lista: Record<string, any>, item?: Partial<ColetaItem>): string {
  const nameCycle = cycleKey(lista.nome);
  const configuredCycle = cycleKey(lista.saidaPadrao);

  // Nas listas do dia, o nome operacional foi gerado no momento da criação e
  // serve como proteção visual para o legado PM/SD até o reparo do metadado rodar.
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
 * Busca TODAS as ocorrências de cada ID somente nas listas do dia atual.
 * Diferente da busca antiga, não sobrescreve uma ocorrência quando o mesmo ID
 * está em duas ou mais listas/grupos.
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

  const listasSnapshot = await getDocs(collection(db, 'coleta_listas'));
  const todayListas = listasSnapshot.docs.filter(docSnap => isListaFromToday(docSnap.data() as any));
  const CHUNK_SIZE = 30;

  await Promise.all(todayListas.map(async listaDoc => {
    const listaId = listaDoc.id;
    const lista = listaDoc.data() as Record<string, any>;

    if (Array.isArray(lista.itens)) {
      lista.itens.forEach((item: ColetaItem) => addOccurrence(item, listaId, lista));
    }

    const itensRef = collection(db, 'coleta_listas', listaId, 'itens');

    for (let i = 0; i < uniqueUpper.length; i += CHUNK_SIZE) {
      const chunk = uniqueUpper.slice(i, i + CHUNK_SIZE);
      if (chunk.length === 0) continue;
      try {
        const snap = await getDocs(query(itensRef, where('codigo', 'in', chunk)));
        snap.docs.forEach(itemDoc => {
          addOccurrence({ ...itemDoc.data(), id: itemDoc.id } as ColetaItem, listaId, lista);
        });
      } catch (error) {
        console.warn(`[Busca multi-lista] Falha por código na lista ${listaId}:`, error);
      }
    }

    for (let i = 0; i < uniqueDigits.length; i += CHUNK_SIZE) {
      const chunk = uniqueDigits.slice(i, i + CHUNK_SIZE);
      if (chunk.length === 0) continue;
      try {
        const snap = await getDocs(query(itensRef, where('codigoClean', 'in', chunk)));
        snap.docs.forEach(itemDoc => {
          addOccurrence({ ...itemDoc.data(), id: itemDoc.id } as ColetaItem, listaId, lista);
        });
      } catch (error) {
        console.warn(`[Busca multi-lista] Falha por código limpo na lista ${listaId}:`, error);
      }
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
