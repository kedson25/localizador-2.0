import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Loader2 } from 'lucide-react';
import type { CsvRow } from '../types';
import { cleanDigits } from '../utils/csvParser';
import { IdLookup } from './IdLookup';
import {
  searchTodayListOccurrences,
  type TodayListOccurrence,
} from '../lib/listaMultiSearch';

interface IdLookupEnhancedProps {
  rows: CsvRow[];
  onNavigateToUpload: () => void;
}

function parseTerms(value: string): string[] {
  return Array.from(new Set(
    value
      .split(/[\n\r,;\t\s]+/)
      .map(term => term.trim())
      .filter(Boolean)
  ));
}

function cycleShort(value: string): string {
  const text = String(value || '').toUpperCase();
  if (/\bSD\b/.test(text)) return 'SD';
  if (/\bPM\b/.test(text)) return 'PM';
  if (/\bAM\b/.test(text)) return 'AM';
  return value || '-';
}

function occurrenceKey(occurrence: TodayListOccurrence): string {
  return `${occurrence.listaId}:${occurrence.item.id || occurrence.item.codigo}:${occurrence.grupoId || ''}`;
}

export const IdLookupEnhanced: React.FC<IdLookupEnhancedProps> = (props) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const [terms, setTerms] = useState<string[]>([]);
  const [occurrences, setOccurrences] = useState<Map<string, TodayListOccurrence[]>>(new Map());
  const [loading, setLoading] = useState(false);

  // O IdLookup original continua responsável por toda a consulta/tabela atual.
  // Este wrapper apenas acompanha o textarea e complementa a resposta quando
  // o mesmo ID aparece em mais de uma lista/grupo do dia.
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

  const duplicateRows = useMemo(() => {
    const rows: Array<{ term: string; occurrences: TodayListOccurrence[] }> = [];

    for (const term of terms) {
      const upper = term.toUpperCase();
      const digits = cleanDigits(term);
      const found = occurrences.get(upper) || (digits ? occurrences.get(digits) : undefined) || [];

      const dedup = new Map<string, TodayListOccurrence>();
      found.forEach(item => dedup.set(occurrenceKey(item), item));
      const values = Array.from(dedup.values());

      if (values.length > 1) {
        rows.push({ term, occurrences: values });
      }
    }

    return rows;
  }, [terms, occurrences]);

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
    </div>
  );
};
