import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Clock, PackageCheck, Search, Trash2, UploadCloud } from 'lucide-react';
import { getLocalValue, setLocalValue } from '../lib/localPersistence';
import { searchTodayListOccurrences, type TodayListOccurrence } from '../lib/listaMultiSearch';
import {
  enrichExpedicao,
  getBaseDockChanges,
  getChanges,
  getExpedicaoDockChanges,
  parseBaseDespacho,
  parseExpedicaoRows,
  type ExpedicaoDocaChange,
  type ExpedicaoStore,
  type FonteImportacaoExpedicao,
} from '../lib/expedicao';

const STORAGE_KEY = 'expedicao-daily-v1';

const empty: ExpedicaoStore = {
  base: [],
  aduana: [],
  auditoria: [],
  localizados: {},
  historico: [],
  historicoDoca: [],
  ultimaComparacao: [],
  encerramentos: [],
};

const formatTime = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
};

const formatDateTime = (iso?: string) => {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};

function affectsDock(change: ExpedicaoDocaChange, doca: string) {
  return change.doca === doca || change.docaAnterior === doca;
}

function gaiolaFromRoute(route: string) {
  return String(route || '')
    .split('|')[0]
    .trim();
}

function shortSaida(value: string) {
  const text = String(value || '').trim();
  const match = text.match(/Saída\s+(AM|PM|SD)/i);
  if (match) return `Saída ${match[1].toUpperCase()}`;

  const fallback = text.match(/\b(AM|PM|SD)\b/i);
  return fallback ? `Saída ${fallback[1].toUpperCase()}` : (text || 'Saída não informada');
}

function occurrenceLabel(occurrence: TodayListOccurrence) {
  const saida = shortSaida(occurrence.listaSaida || occurrence.listaNome);
  const grupo = occurrence.grupoNome || 'Grupo não informado';
  const responsavel = occurrence.item?.responsavel?.trim() || 'não informado';
  return `${saida}, ${grupo}, bipado por: ${responsavel}`;
}

function originLabel(value: string) {
  return value === 'auditoria' ? 'Auditoria' : 'Aduana';
}

function typeTextClass(type: 'A mais' | 'Faltante') {
  return type === 'A mais' ? 'text-red-600' : 'text-amber-700';
}

export function ExpedicaoPanel() {
  const [store, setStore] = useState<ExpedicaoStore>(empty);
  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<'todos' | 'A mais' | 'Faltante'>('todos');
  const [selectedDoca, setSelectedDoca] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [backlogById, setBacklogById] = useState<Record<string, TodayListOccurrence[]>>({});
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [backlogError, setBacklogError] = useState('');

  const baseInput = useRef<HTMLInputElement>(null);
  const aduanaInput = useRef<HTMLInputElement>(null);
  const auditInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getLocalValue<ExpedicaoStore>(STORAGE_KEY).then(saved => {
      if (saved) {
        setStore({
          ...empty,
          ...saved,
          localizados: saved.localizados || {},
          historico: saved.historico || [],
          historicoDoca: saved.historicoDoca || [],
          ultimaComparacao: saved.ultimaComparacao || [],
        });
      }
      setReady(true);
    });
  }, []);

  const save = async (next: ExpedicaoStore) => {
    setStore(next);
    await setLocalValue(STORAGE_KEY, next);
  };

  const importFile = async (file: File, source: FonteImportacaoExpedicao) => {
    const text = await file.text();
    const registradoEm = new Date().toISOString();
    const beforeEnriched = enrichExpedicao(store);

    const next: ExpedicaoStore = {
      ...store,
      updatedAt: registradoEm,
      filenames: { ...store.filenames, [source]: file.name },
    };

    let hasBaseline = false;
    let baseChanges: ExpedicaoDocaChange[] = [];

    if (source === 'base') {
      const parsed = parseBaseDespacho(text);
      hasBaseline = store.base.length > 0;
      baseChanges = hasBaseline
        ? getBaseDockChanges(store.base, parsed, registradoEm)
        : [];
      next.base = parsed;
    } else {
      const parsed = parseExpedicaoRows(text, source);
      hasBaseline = store[source].length > 0;
      next.historico = [
        ...(store.historico || []),
        ...getChanges(store[source], parsed, source),
      ].slice(-10000);
      next[source] = parsed;
    }

    const afterEnriched = enrichExpedicao(next);
    const errorChanges = hasBaseline
      ? getExpedicaoDockChanges(beforeEnriched, afterEnriched, source, registradoEm)
      : [];
    const changes = [...baseChanges, ...errorChanges];

    next.ultimaComparacao = changes;
    next.historicoDoca = [...(store.historicoDoca || []), ...changes].slice(-20000);
    next.ultimaImportacao = {
      fonte: source,
      arquivo: file.name,
      registradoEm,
      alteracoes: changes.length,
    };

    await save(next);
  };

  const toggleLocated = (pacote: string) => save({
    ...store,
    localizados: {
      ...store.localizados,
      [pacote]: !store.localizados?.[pacote],
    },
  });

  const resetExpedicao = async () => {
    if (!window.confirm('Zerar a Expedição e apagar as bases e históricos salvos neste navegador?')) return;

    await save(empty);
    setQuery('');
    setFilter('todos');
    setSelectedDoca(null);
    setBacklogById({});
    setBacklogError('');
    setReport(false);
  };

  const enriched = useMemo(() => enrichExpedicao(store), [store]);
  const latestDockChanges = store.ultimaComparacao || [];

  const faltanteIds = useMemo(
    () => enriched
      .filter(row => row.classificacao === 'Faltante')
      .map(row => row.pacote)
      .sort(),
    [enriched],
  );

  const faltanteKey = faltanteIds.join('|');

  useEffect(() => {
    let active = true;

    if (!ready || !faltanteIds.length) {
      setBacklogById({});
      setBacklogLoading(false);
      setBacklogError('');
      return () => {
        active = false;
      };
    }

    setBacklogLoading(true);
    setBacklogError('');

    searchTodayListOccurrences(faltanteIds)
      .then(found => {
        if (!active) return;

        const next: Record<string, TodayListOccurrence[]> = {};
        faltanteIds.forEach(pacote => {
          const upper = pacote.trim().toUpperCase();
          const digits = upper.replace(/\D/g, '');
          next[pacote] = found.get(upper) || (digits ? found.get(digits) : undefined) || [];
        });
        setBacklogById(next);
      })
      .catch(error => {
        if (!active) return;
        console.error('[Expedição] Falha ao verificar listas:', error);
        setBacklogById({});
        setBacklogError('Falha ao consultar as listas.');
      })
      .finally(() => {
        if (active) setBacklogLoading(false);
      });

    return () => {
      active = false;
    };
  }, [ready, faltanteKey]);

  const counts = useMemo(() => ({
    amais: enriched.filter(row => row.classificacao === 'A mais').length,
    faltantes: enriched.filter(row => row.classificacao === 'Faltante').length,
    localizados: enriched.filter(row => Boolean(store.localizados?.[row.pacote])).length,
    semDestino: enriched.filter(row => !row.destinoDoca).length,
  }), [enriched, store.localizados]);

  const recuperadosEmLista = useMemo(
    () => Object.values(backlogById).filter(items => items.length > 0).length,
    [backlogById],
  );

  const heatmap = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const doca = String(index + 1);
    const records = enriched.filter(row => row.destinoDoca === doca);
    const changes = latestDockChanges.filter(change => affectsDock(change, doca));
    const latest = changes[changes.length - 1];
    const total = records.length;
    const resolved = records.filter(row => (
      Boolean(store.localizados?.[row.pacote])
      || (
        row.classificacao === 'Faltante'
        && (backlogById[row.pacote]?.length || 0) > 0
      )
    )).length;

    return {
      doca,
      amais: records.filter(row => row.classificacao === 'A mais').length,
      faltantes: records.filter(row => row.classificacao === 'Faltante').length,
      total,
      resolved,
      fullyResolved: total > 0 && resolved === total,
      changed: changes.length > 0,
      latest,
    };
  }), [enriched, latestDockChanges, store.localizados, backlogById]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    return enriched.filter(row => {
      const listText = (backlogById[row.pacote] || []).map(occurrenceLabel).join(' ');
      const searchable = [
        row.pacote,
        row.origem,
        row.encontradoPlaca,
        gaiolaFromRoute(row.encontradoRota),
        row.destinoRota,
        row.destinoDoca,
        row.destinoOnda,
        listText,
      ].join(' ').toLowerCase();

      return (
        (filter === 'todos' || row.classificacao === filter)
        && (!selectedDoca || row.destinoDoca === selectedDoca)
        && searchable.includes(needle)
      );
    });
  }, [enriched, filter, selectedDoca, query, backlogById]);

  const selectedDockItems = useMemo(
    () => selectedDoca
      ? enriched.filter(row => row.destinoDoca === selectedDoca)
      : [],
    [enriched, selectedDoca],
  );

  const totalErrors = counts.amais + counts.faltantes;
  const resolvedTotal = useMemo(
    () => enriched.filter(row => (
      Boolean(store.localizados?.[row.pacote])
      || (
        row.classificacao === 'Faltante'
        && (backlogById[row.pacote]?.length || 0) > 0
      )
    )).length,
    [enriched, store.localizados, backlogById],
  );
  const pending = Math.max(0, totalErrors - resolvedTotal);
  const recoveryRate = totalErrors
    ? Math.round((resolvedTotal / totalErrors) * 100)
    : 0;

  const closeExpedicao = async () => {
    const closing = {
      id: `exp-${Date.now()}`,
      encerradoEm: new Date().toISOString(),
      amais: counts.amais,
      faltantes: counts.faltantes,
      localizados: counts.localizados,
      porDoca: heatmap.map(({ doca, amais, faltantes }) => ({ doca, amais, faltantes })),
    };

    await save({
      ...store,
      encerramentos: [closing, ...(store.encerramentos || [])],
    });
    setReport(true);
  };

  if (!ready) {
    return <div className="py-16 text-center text-sm text-slate-500">Carregando…</div>;
  }

  const upload = (
    label: string,
    ref: RefObject<HTMLInputElement | null>,
    primary = false,
  ) => (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      className={`inline-flex h-9 items-center gap-2 rounded-none border px-3 text-xs font-black transition ${
        primary
          ? 'border-[#253b80] bg-[#253b80] text-white hover:bg-[#1f2464]'
          : 'border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
      }`}
    >
      <UploadCloud className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="w-full space-y-3">
      <input
        ref={baseInput}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'base')}
      />
      <input
        ref={aduanaInput}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'aduana')}
      />
      <input
        ref={auditInput}
        className="hidden"
        type="file"
        accept=".csv,text/csv"
        onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'auditoria')}
      />

      <section className="rounded-none border border-slate-300 bg-white px-4 py-3 shadow-sm sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-none border border-slate-200 bg-white text-blue-700">
              <PackageCheck className="h-5 w-5" />
            </span>
            <div>
              <p className="text-[10px] font-black uppercase tracking-[0.14em] text-blue-700">Expedição</p>
              <h1 className="text-2xl font-black tracking-tight text-[#102a67]">Monitor por vagas</h1>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {upload('Despacho', baseInput)}
            {upload('Aduana', aduanaInput, true)}
            {upload('Auditoria', auditInput, true)}
            <button
              type="button"
              onClick={resetExpedicao}
              className="inline-flex h-9 items-center gap-2 rounded-none border border-slate-300 bg-white px-3 text-xs font-black text-red-700 hover:bg-slate-50"
            >
              <Trash2 className="h-4 w-4" />
              Zerar
            </button>
            <button
              type="button"
              onClick={closeExpedicao}
              disabled={!totalErrors}
              className="h-9 rounded-none border border-slate-400 bg-[#ffd52f] px-3 text-xs font-black text-slate-950 disabled:opacity-40"
            >
              Encerrar
            </button>
          </div>
        </div>
      </section>

      {!store.base.length && (
        <section className="rounded-none border border-amber-300 bg-white px-4 py-3 text-xs font-bold text-amber-900">
          Carregue a Base Despacho para calcular o destino correto.
        </section>
      )}

      {store.ultimaImportacao && (
        <section className="flex items-center justify-between gap-3 rounded-none border border-slate-300 bg-white px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-blue-700" />
            <p className="truncate text-xs font-bold text-slate-800">
              {store.ultimaImportacao.arquivo} • {formatDateTime(store.ultimaImportacao.registradoEm)}
            </p>
          </div>
          <span className="shrink-0 border border-slate-300 bg-white px-3 py-1 text-[10px] font-black text-slate-700">
            {store.ultimaImportacao.alteracoes === 0
              ? 'Sem mudanças'
              : `${store.ultimaImportacao.alteracoes} mudanças`}
          </span>
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-none border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">A mais</p>
          <p className="text-3xl font-black text-red-600">{counts.amais}</p>
        </div>
        <div className="rounded-none border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Faltantes</p>
          <p className="text-3xl font-black text-amber-700">{counts.faltantes}</p>
        </div>
        <div className="rounded-none border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Recuperados em lista</p>
          <p className="text-3xl font-black text-emerald-700">
            {backlogLoading ? '…' : recuperadosEmLista}
          </p>
        </div>
        <div className="rounded-none border border-slate-300 bg-white px-4 py-3 shadow-sm">
          <p className="text-[10px] font-black uppercase text-slate-500">Sem destino</p>
          <p className="text-3xl font-black text-slate-700">{counts.semDestino}</p>
        </div>
      </div>

      {backlogError && (
        <div className="rounded-none border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900">
          {backlogError}
        </div>
      )}

      <section className="rounded-none border border-slate-300 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2">
            <h2 className="text-lg font-black text-slate-950">20 vagas</h2>
            <span className="text-[10px] font-bold text-slate-400">cinza = concluída</span>
          </div>
          {selectedDoca && (
            <button
              type="button"
              onClick={() => setSelectedDoca(null)}
              className="rounded-none border border-slate-300 bg-white px-3 py-2 text-xs font-black"
            >
              Limpar
            </button>
          )}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_440px]">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
            {heatmap.map(item => (
              <button
                key={item.doca}
                type="button"
                onClick={() => setSelectedDoca(item.doca)}
                className={`relative min-h-[108px] rounded-none border p-3 text-left transition hover:border-slate-500 ${
                  item.fullyResolved ? 'bg-slate-100 border-slate-400' : 'bg-white border-slate-300'
                } ${selectedDoca === item.doca ? 'ring-2 ring-slate-900' : ''}`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-black text-slate-950">VAGA {item.doca}</span>
                  {item.fullyResolved ? (
                    <span className="border border-slate-500 bg-slate-700 px-2 py-0.5 text-[9px] font-black text-white">OK</span>
                  ) : item.changed ? (
                    <span className="border border-slate-300 bg-white px-2 py-0.5 text-[9px] font-black text-slate-700">
                      {formatTime(item.latest?.registradoEm)}
                    </span>
                  ) : null}
                </div>

                <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-200 pt-3">
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-500">A mais</p>
                    <p className="text-xl font-black text-red-600">{item.amais}</p>
                  </div>
                  <div>
                    <p className="text-[9px] font-black uppercase text-slate-500">Faltante</p>
                    <p className="text-xl font-black text-amber-700">{item.faltantes}</p>
                  </div>
                </div>

                {item.total > 0 && (
                  <div className="mt-2 h-1 overflow-hidden bg-slate-200">
                    <div
                      className="h-full bg-emerald-600 transition-all"
                      style={{ width: `${Math.round((item.resolved / item.total) * 100)}%` }}
                    />
                  </div>
                )}
              </button>
            ))}
          </div>

          <aside className="max-h-[720px] overflow-y-auto rounded-none border border-slate-300 bg-white p-3 xl:sticky xl:top-20">
            <div className="flex items-center justify-between border-b border-slate-300 pb-2.5">
              <h3 className="text-xl font-black text-slate-950">
                {selectedDoca ? `VAGA ${selectedDoca}` : 'Selecione uma vaga'}
              </h3>
              {selectedDoca && (
                <span className="text-[10px] font-black text-slate-500">{selectedDockItems.length} itens</span>
              )}
            </div>

            {selectedDoca ? (
              <div className="mt-3 divide-y divide-slate-200 border border-slate-200">
                {selectedDockItems.length ? selectedDockItems.map(row => {
                  const manuallyRecovered = Boolean(store.localizados?.[row.pacote]);
                  const backlog = backlogById[row.pacote] || [];
                  const recoveredInList = row.classificacao === 'Faltante' && backlog.length > 0;

                  return (
                    <label
                      key={row.pacote}
                      className={`block cursor-pointer p-3 ${manuallyRecovered ? 'bg-slate-100' : 'bg-white'}`}
                    >
                      <span className="flex items-start gap-3">
                        <input
                          type="checkbox"
                          checked={manuallyRecovered}
                          onChange={() => toggleLocated(row.pacote)}
                          className="mt-0.5 h-5 w-5 shrink-0 accent-slate-700"
                        />

                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-3">
                            <span>
                              <b className="block font-mono text-sm text-slate-950">{row.pacote}</b>
                              <span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide text-slate-500">
                                Origem: {originLabel(row.origem)}
                              </span>
                            </span>
                            <strong className={`text-[9px] font-black uppercase ${typeTextClass(row.classificacao)}`}>
                              {row.classificacao}
                            </strong>
                          </span>

                          <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] font-bold text-slate-700">
                            Gaiola {gaiolaFromRoute(row.encontradoRota) || 'não informada'} - placa: {row.encontradoPlaca || 'não informada'}
                          </div>

                          {row.classificacao === 'A mais' ? (
                            <div className="mt-1 text-[10px] font-bold text-slate-600">
                              <b>Destino:</b>{' '}
                              {row.destinoDoca && row.destinoRota
                                ? `VAGA ${row.destinoDoca} - ${row.destinoRota}${row.destinoOnda ? ` - ${row.destinoOnda}` : ''}`
                                : 'não localizado na Base Despacho'}
                            </div>
                          ) : (
                            <div className="mt-1 text-[10px] font-bold text-slate-600">
                              {backlogLoading ? (
                                'Verificando listas…'
                              ) : recoveredInList ? (
                                <>
                                  <span className="font-black text-emerald-700">Recuperado em lista:</span>{' '}
                                  {backlog.slice(0, 2).map(occurrenceLabel).join(' | ')}
                                  {backlog.length > 2 ? ` | +${backlog.length - 2}` : ''}
                                </>
                              ) : (
                                'Não encontrado nas listas do dia'
                              )}
                            </div>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                }) : (
                  <p className="p-4 text-center text-sm text-slate-500">Sem erros nesta vaga.</p>
                )}
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">Clique em uma vaga.</p>
            )}
          </aside>
        </div>
      </section>

      <section className="overflow-hidden rounded-none border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 bg-white p-2.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-1.5">
            {(['todos', 'A mais', 'Faltante'] as const).map(option => (
              <button
                key={option}
                type="button"
                onClick={() => setFilter(option)}
                className={`rounded-none border px-3 py-2 text-xs font-black ${
                  filter === option
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'
                }`}
              >
                {option === 'todos' ? 'Todos' : option}
              </button>
            ))}
          </div>

          <label className="relative min-w-[280px]">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="ID, origem, gaiola, placa ou lista"
              className="h-9 w-full rounded-none border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500"
            />
          </label>
        </div>

        <div className="app-scroll-x">
          <table className="w-full min-w-[1040px] border-collapse text-xs">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                {['ID / Origem', 'Tipo', 'Encontrado', 'Destino / Lista', 'OK'].map(head => (
                  <th
                    key={head}
                    className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black last:border-r-0"
                  >
                    {head}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.slice(0, 1000).map(row => {
                const backlog = backlogById[row.pacote] || [];
                const recoveredInList = row.classificacao === 'Faltante' && backlog.length > 0;

                return (
                  <tr key={row.pacote} className="bg-white hover:bg-slate-50">
                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      <div className="font-mono font-black text-slate-900">{row.pacote}</div>
                      <div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">
                        Origem: {originLabel(row.origem)}
                      </div>
                    </td>

                    <td className="border-b border-r border-slate-200 px-3 py-2">
                      <span className={`font-black uppercase ${typeTextClass(row.classificacao)}`}>
                        {row.classificacao}
                      </span>
                    </td>

                    <td className="border-b border-r border-slate-200 px-3 py-2 font-bold text-slate-700">
                      Gaiola {gaiolaFromRoute(row.encontradoRota) || '—'} - placa: {row.encontradoPlaca || '—'}
                    </td>

                    <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-700">
                      {row.classificacao === 'A mais' ? (
                        row.destinoDoca && row.destinoRota ? (
                          <span className="font-bold">
                            VAGA {row.destinoDoca} - {row.destinoRota}{row.destinoOnda ? ` - ${row.destinoOnda}` : ''}
                          </span>
                        ) : (
                          <span className="text-slate-400">Sem destino</span>
                        )
                      ) : backlogLoading ? (
                        <span className="text-slate-400">Verificando listas…</span>
                      ) : recoveredInList ? (
                        <span className="font-bold">
                          Recuperado em lista - {occurrenceLabel(backlog[0])}
                          {backlog.length > 1 ? ` | +${backlog.length - 1}` : ''}
                        </span>
                      ) : (
                        <span className="text-slate-400">Fora das listas do dia</span>
                      )}
                    </td>

                    <td className="border-b border-slate-200 px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={Boolean(store.localizados?.[row.pacote])}
                        onChange={() => toggleLocated(row.pacote)}
                        className="h-4 w-4 accent-slate-700"
                      />
                    </td>
                  </tr>
                );
              })}

              {!rows.length && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">
                    Nenhum item.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {report && (
        <section className="rounded-none border border-slate-300 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <span><b>Pendentes:</b> {pending}</span>
            <span><b>Recuperados em lista:</b> {recuperadosEmLista}</span>
            <span><b>Marcados OK:</b> {counts.localizados}</span>
            <span><b>Taxa:</b> {recoveryRate}%</span>
          </div>
        </section>
      )}
    </div>
  );
}
