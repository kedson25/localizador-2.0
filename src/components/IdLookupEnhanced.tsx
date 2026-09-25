import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Layers, ListPlus, Loader2, X } from 'lucide-react';
import type { ColetaLista, CsvRow } from '../types';
import { cleanDigits } from '../utils/csvParser';
import { getItemsOfGrupo, listenToListas } from '../lib/firebase';
import { IdLookup } from './IdLookup';
import {
  searchTodayListOccurrences,
  type TodayListOccurrence,
} from '../lib/listaMultiSearch';

interface IdLookupEnhancedProps {
  rows: CsvRow[];
  onNavigateToUpload: () => void;
}

type Cycle = 'AM' | 'PM' | 'SD';

function parseTerms(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n\r,;\t\s]+/)
      .map(term => term.trim())
      .filter(Boolean)
  ));
}

function cycleKey(value: unknown): Cycle | '' {
  const text = String(value || '').toUpperCase();
  if (/(^|[^A-Z])SD([^A-Z]|$)/.test(text)) return 'SD';
  if (/(^|[^A-Z])PM([^A-Z]|$)/.test(text)) return 'PM';
  if (/(^|[^A-Z])AM([^A-Z]|$)/.test(text)) return 'AM';
  return '';
}

function cycleShort(value: string): string {
  return cycleKey(value) || value || '-';
}

function effectiveTodayCycle(lista: ColetaLista): Cycle | '' {
  const nameCycle = cycleKey(lista.nome);
  const configuredCycle = cycleKey(lista.saidaPadrao);
  if (nameCycle && configuredCycle && nameCycle !== configuredCycle) return nameCycle;
  return configuredCycle || nameCycle;
}

function occurrenceKey(occurrence: TodayListOccurrence): string {
  return `${occurrence.listaId}:${occurrence.item.id || occurrence.item.codigo}:${occurrence.grupoId || ''}`;
}

function isListaFromToday(lista: ColetaLista, now = new Date()): boolean {
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
  let date: Date | null = null;
  try {
    if (createdAt?.toDate) date = createdAt.toDate();
    else if (createdAt?.seconds) date = new Date(Number(createdAt.seconds) * 1000);
    else if (createdAt) date = new Date(createdAt);
  } catch (_) {
    date = null;
  }

  if (!date || Number.isNaN(date.getTime())) return false;
  return (
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()
  );
}

function setNativeTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
  textarea.dispatchEvent(new Event('change', { bubbles: true }));
}

export const IdLookupEnhanced: React.FC<IdLookupEnhancedProps> = (props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [occurrences, setOccurrences] = useState<Map<string, TodayListOccurrence[]>>(new Map());
  const [loading, setLoading] = useState(false);
  const [listas, setListas] = useState<ColetaLista[]>([]);
  const [showTodayGroups, setShowTodayGroups] = useState(false);
  const [loadingGroupKey, setLoadingGroupKey] = useState('');

  useEffect(() => {
    const unsubscribe = listenToListas(data => setListas(data));
    return unsubscribe;
  }, []);

  // Intercepta o botão "Importar Grupo" do componente original para impedir que
  // o modal antigo mostre listas de outros dias.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;

    const handleClickCapture = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      const button = target?.closest('button');
      if (!button || !root.contains(button)) return;
      const text = button.textContent?.replace(/\s+/g, ' ').trim() || '';
      if (!/Importar Grupo/i.test(text)) return;

      event.preventDefault();
      event.stopPropagation();
      setShowTodayGroups(true);
    };

    root.addEventListener('click', handleClickCapture, true);
    return () => root.removeEventListener('click', handleClickCapture, true);
  }, []);

  // Acompanha o textarea controlado do IdLookup inclusive quando IDs entram via
  // importação de grupo, não apenas quando o usuário digita manualmente.
  useEffect(() => {
    let lastValue = '';

    const readSearch = () => {
      const textarea = rootRef.current?.querySelector(
        'textarea[placeholder*="Cole os IDs aqui"]'
      ) as HTMLTextAreaElement | null;

      const value = textarea?.value || '';
      if (value === lastValue) return;
      lastValue = value;
      setTerms(parseTerms(value));
    };

    readSearch();
    const interval = window.setInterval(readSearch, 300);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (terms.length === 0) {
      setOccurrences(new Map());
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);

    const timer = window.setTimeout(async () => {
      try {
        const result = await searchTodayListOccurrences(terms);
        if (!cancelled) setOccurrences(result);
      } catch (error) {
        console.warn('Falha ao buscar ocorrências em múltiplas listas:', error);
        if (!cancelled) setOccurrences(new Map());
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [terms]);

  const todayGroupLists = useMemo(() => {
    return listas
      .filter(lista => isListaFromToday(lista))
      .filter(lista => lista.tipo === 'grupos' && Array.isArray(lista.grupos) && lista.grupos.length > 0)
      .sort((a, b) => String(a.nome || '').localeCompare(String(b.nome || ''), undefined, { numeric: true }));
  }, [listas]);

  const duplicateRows = useMemo(() => {
    const rows: Array<{ term: string; occurrences: TodayListOccurrence[] }> = [];

    for (const term of terms) {
      const upper = term.toUpperCase();
      const digits = cleanDigits(term);
      const found = occurrences.get(upper) || (digits ? occurrences.get(digits) : undefined) || [];

      const dedup = new Map<string, TodayListOccurrence>();
      found.forEach(item => dedup.set(occurrenceKey(item), item));
      const values = Array.from(dedup.values());

      if (values.length > 1) rows.push({ term, occurrences: values });
    }

    return rows;
  }, [terms, occurrences]);

  const importGroup = async (lista: ColetaLista, grupoId: string) => {
    const key = `${lista.id}:${grupoId}`;
    if (loadingGroupKey) return;
    setLoadingGroupKey(key);

    try {
      const itens = await getItemsOfGrupo(lista.id, grupoId);
      const ids = itens.map(item => String(item.codigo || '').trim()).filter(Boolean);
      if (ids.length === 0) {
        window.alert('Este grupo não possui IDs.');
        return;
      }

      const textarea = rootRef.current?.querySelector(
        'textarea[placeholder*="Cole os IDs aqui"]'
      ) as HTMLTextAreaElement | null;

      if (!textarea) return;

      const current = textarea.value.trim();
      const combined = current ? `${current}\n${ids.join('\n')}` : ids.join('\n');
      setNativeTextareaValue(textarea, combined);
      setShowTodayGroups(false);
    } catch (error) {
      console.error('Erro ao importar grupo do dia:', error);
      window.alert('Não foi possível importar este grupo.');
    } finally {
      setLoadingGroupKey('');
    }
  };

  const groupsModal = showTodayGroups ? createPortal(
    <div className="fixed inset-0 z-[10020] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="flex max-h-[82vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-purple-100 text-purple-700">
              <ListPlus className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h3 className="text-sm font-black text-gray-900">Importar grupo de hoje</h3>
              <p className="text-[11px] text-gray-500">
                Somente listas da data atual. O ciclo de cada lista aparece ao lado.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setShowTodayGroups(false)}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="overflow-y-auto p-4">
          {todayGroupLists.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 p-8 text-center">
              <Layers className="mx-auto mb-2 h-7 w-7 text-gray-300" />
              <p className="text-sm font-bold text-gray-600">Nenhuma lista com grupos criada hoje.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {todayGroupLists.map(lista => {
                const cycle = effectiveTodayCycle(lista);
                return (
                  <div key={lista.id} className="overflow-hidden rounded-xl border border-gray-200">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 bg-gray-50 px-4 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-black text-gray-800" title={lista.nome}>
                          {lista.nome}
                        </p>
                        <p className="mt-0.5 text-[10px] text-gray-500">{lista.data}</p>
                      </div>
                      {cycle && (
                        <span className="rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[10px] font-black text-blue-800">
                          Saída {cycle}
                        </span>
                      )}
                    </div>

                    <div className="grid gap-2 p-3 sm:grid-cols-2 lg:grid-cols-3">
                      {lista.grupos?.map(grupo => {
                        const key = `${lista.id}:${grupo.id}`;
                        const isLoading = loadingGroupKey === key;
                        return (
                          <button
                            key={grupo.id}
                            type="button"
                            disabled={Boolean(loadingGroupKey)}
                            onClick={() => void importGroup(lista, grupo.id)}
                            className="flex min-h-[64px] flex-col items-start justify-center rounded-lg border border-purple-100 bg-purple-50 p-3 text-left transition hover:border-purple-300 hover:bg-purple-100 disabled:opacity-60"
                          >
                            <div className="flex w-full items-center justify-between gap-2">
                              <span className="truncate text-xs font-black text-purple-900">{grupo.nome}</span>
                              {isLoading && <Loader2 className="h-3.5 w-3.5 animate-spin text-purple-700" />}
                            </div>
                            {grupo.lider && (
                              <span className="mt-1 truncate text-[10px] font-medium text-purple-600">
                                Líder: {grupo.lider}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return (
    <div ref={rootRef} className="space-y-4">
      <IdLookup {...props} />

      {(loading || duplicateRows.length > 0) && (
        <section className="overflow-hidden rounded-2xl border border-purple-200 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-purple-100 bg-purple-50/70 px-4 py-3">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-100 text-purple-700">
                <Layers className="h-4 w-4" />
              </div>
              <div>
                <h3 className="text-xs font-black uppercase tracking-wide text-purple-950">
                  IDs em múltiplas listas do dia
                </h3>
                <p className="text-[10px] font-medium text-purple-700">
                  Mostra todos os grupos e todas as saídas encontradas para o mesmo ID.
                </p>
              </div>
            </div>

            {loading && (
              <span className="inline-flex items-center gap-1.5 text-[10px] font-bold text-purple-700">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Conferindo listas
              </span>
            )}
          </div>

          {duplicateRows.length > 0 && (
            <div className="divide-y divide-gray-100">
              {duplicateRows.map(({ term, occurrences: found }) => {
                const cycles = Array.from(new Set(found.map(item => cycleShort(item.listaSaida))));

                return (
                  <div key={term} className="p-4">
                    <div className="mb-2 flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-black text-gray-900">{term}</span>
                      <span className="rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-[10px] font-black text-purple-700">
                        {found.length} ocorrências
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {cycles.map(cycle => (
                          <span
                            key={cycle}
                            className="rounded-md border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-800"
                          >
                            Saída {cycle}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                      {found.map(item => (
                        <div
                          key={occurrenceKey(item)}
                          className="rounded-xl border border-gray-200 bg-gray-50/70 p-3"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-[11px] font-black text-gray-800" title={item.listaNome}>
                                {item.listaNome}
                              </p>
                              <p className="mt-0.5 text-[10px] font-medium text-gray-500">
                                {item.grupoNome || 'Sem grupo'}
                              </p>
                            </div>
                            <span className="shrink-0 rounded-md border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-black text-blue-700">
                              {cycleShort(item.listaSaida)}
                            </span>
                          </div>

                          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-gray-500">
                            {item.listaData && <span>{item.listaData}</span>}
                            {item.item.motivo && <span>Motivo: {item.item.motivo}</span>}
                            {item.item.rota && <span>Rota: {item.item.rota}</span>}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {groupsModal}
    </div>
  );
};
