import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Clock, PackageCheck, Search, Trash2, UploadCloud } from 'lucide-react';
import { ExpedicaoSkeleton } from './ExpedicaoSkeleton';
import { getLocalValue, setLocalValue } from '../lib/localPersistence';
import {
  listenExpedicaoShared,
  resetExpedicaoShared,
  setExpedicaoSharedLocated,
  syncExpedicaoImport,
  syncExpedicaoMeta,
} from '../lib/expedicaoSync';
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

type TipoFilter = 'todos' | 'A mais' | 'Faltante';
type OrigemFilter = 'todas' | 'aduana' | 'auditoria';
type DestinoFilter = 'todos' | 'em-lista' | 'fora-lista' | 'com-destino' | 'sem-destino';

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
  return String(route || '').split('|')[0].trim();
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

function typeTextClass(type: 'A mais' | 'Faltante', muted = false) {
  if (muted) return 'text-slate-600';
  return type === 'A mais' ? 'text-red-600' : 'text-amber-700';
}

export function ExpedicaoPanel() {
  const [store, setStore] = useState<ExpedicaoStore>(empty);
  const [hydrated, setHydrated] = useState(false);
  const [screenReady, setScreenReady] = useState(false);
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<TipoFilter>('todos');
  const [originFilter, setOriginFilter] = useState<OrigemFilter>('todas');
  const [destinationFilter, setDestinationFilter] = useState<DestinoFilter>('todos');
  const [selectedDoca, setSelectedDoca] = useState<string | null>(null);
  const [report, setReport] = useState(false);
  const [backlogById, setBacklogById] = useState<Record<string, TodayListOccurrence[]>>({});
  const [backlogLoading, setBacklogLoading] = useState(false);
  const [backlogError, setBacklogError] = useState('');

  const baseInput = useRef<HTMLInputElement>(null);
  const aduanaInput = useRef<HTMLInputElement>(null);
  const auditInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    getLocalValue<ExpedicaoStore>(STORAGE_KEY)
      .then(saved => {
        if (!active || !saved) return;
        setStore({
          ...empty,
          ...saved,
          localizados: saved.localizados || {},
          historico: saved.historico || [],
          historicoDoca: saved.historicoDoca || [],
          ultimaComparacao: saved.ultimaComparacao || [],
        });
      })
      .finally(() => {
        if (active) setHydrated(true);
      });

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;

    return listenExpedicaoShared(remote => {
      if (!remote) return;

      setStore(current => {
        const merged: ExpedicaoStore = {
          ...current,
          ...remote,
          historico: current.historico || [],
          historicoDoca: current.historicoDoca || [],
        };

        void setLocalValue(STORAGE_KEY, merged);
        return merged;
      });
    }, error => {
      console.error('[Expedição] Sincronização em tempo real indisponível:', error);
      setBacklogError(current => current || 'Sincronização com os outros usuários indisponível.');
    });
  }, [hydrated]);

  const save = async (next: ExpedicaoStore) => {
    setStore(next);
    await setLocalValue(STORAGE_KEY, next);
  };

  const importFile = async (file: File, source: FonteImportacaoExpedicao) => {
    setScreenReady(false);
    setBacklogError('');

    try {
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

      try {
        await syncExpedicaoImport(next, source);
      } catch (syncError) {
        console.error('[Expedição] Arquivo processado, mas falhou ao sincronizar:', syncError);
        setBacklogError('Arquivo carregado, mas não foi possível sincronizar com os outros usuários.');
      }
    } catch (error) {
      console.error('[Expedição] Falha ao importar CSV:', error);
      setBacklogError('Falha ao processar o arquivo.');
      setScreenReady(true);
    }
  };

  const toggleLocated = async (pacote: string) => {
    const nextValue = !store.localizados?.[pacote];
    const next: ExpedicaoStore = {
      ...store,
      localizados: {
        ...store.localizados,
        [pacote]: nextValue,
      },
    };

    await save(next);

    try {
      await setExpedicaoSharedLocated(pacote, nextValue);
    } catch (error) {
      console.error('[Expedição] Falha ao sincronizar marcação OK:', error);
      setBacklogError('Marcação salva neste dispositivo, mas ainda não sincronizou com os outros usuários.');
    }
  };

  const resetFilters = () => {
    setFilter('todos');
    setOriginFilter('todas');
    setDestinationFilter('todos');
    setQuery('');
  };

  const resetExpedicao = async () => {
    if (!window.confirm('Zerar a Expedição para todos os usuários e apagar as bases e históricos compartilhados?')) return;

    setScreenReady(false);
    const next = { ...empty, updatedAt: new Date().toISOString() };
    await save(next);

    try {
      await resetExpedicaoShared();
    } catch (error) {
      console.error('[Expedição] Falha ao zerar estado compartilhado:', error);
      setBacklogError('A Expedição foi zerada neste dispositivo, mas não foi possível zerar para os outros usuários.');
    }

    resetFilters();
    setSelectedDoca(null);
    setBacklogById({});
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

    if (!hydrated) return () => { active = false; };

    setScreenReady(false);

    if (!faltanteIds.length) {
      setBacklogById({});
      setBacklogLoading(false);
      setBacklogError('');
      setScreenReady(true);
      return () => { active = false; };
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
        if (!active) return;
        setBacklogLoading(false);
        setScreenReady(true);
      });

    return () => { active = false; };
  }, [hydrated, faltanteKey, store.updatedAt]);

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
    const records = enriched.filter(row => row.vagaOperacional === doca);
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
      const backlog = backlogById[row.pacote] || [];
      const recoveredInList = row.classificacao === 'Faltante' && backlog.length > 0;
      const hasDestination = Boolean(row.destinoDoca && row.destinoRota);
      const listText = backlog.map(occurrenceLabel).join(' ');
      const searchable = [
        row.pacote,
        row.origem,
        row.encontradoPlaca,
        gaiolaFromRoute(row.encontradoRota),
        row.encontradoDoca,
        row.vagaOperacional,
        row.destinoRota,
        row.destinoDoca,
        row.destinoOnda,
        listText,
      ].join(' ').toLowerCase();

      const matchDestination = destinationFilter === 'todos'
        || (destinationFilter === 'em-lista' && recoveredInList)
        || (destinationFilter === 'fora-lista' && row.classificacao === 'Faltante' && !recoveredInList)
        || (destinationFilter === 'com-destino' && hasDestination)
        || (destinationFilter === 'sem-destino' && !hasDestination);

      return (
        (filter === 'todos' || row.classificacao === filter)
        && (originFilter === 'todas' || row.origem === originFilter)
        && matchDestination
        && (!selectedDoca || row.vagaOperacional === selectedDoca)
        && searchable.includes(needle)
      );
    });
  }, [enriched, filter, originFilter, destinationFilter, selectedDoca, query, backlogById]);

  const selectedDockItems = useMemo(
    () => selectedDoca
      ? enriched.filter(row => row.vagaOperacional === selectedDoca)
      : [],
    [enriched, selectedDoca],
  );

  const selectedDock = useMemo(
    () => selectedDoca ? heatmap.find(item => item.doca === selectedDoca) : undefined,
    [heatmap, selectedDoca],
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

    const next: ExpedicaoStore = {
      ...store,
      encerramentos: [closing, ...(store.encerramentos || [])],
    };

    await save(next);

    try {
      await syncExpedicaoMeta(next);
    } catch (error) {
      console.error('[Expedição] Falha ao sincronizar encerramento:', error);
      setBacklogError('Encerramento salvo neste dispositivo, mas não sincronizou com os outros usuários.');
    }

    setReport(true);
  };

  if (!hydrated || !screenReady) {
    return <ExpedicaoSkeleton />;
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
      <input ref={baseInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'base')} />
      <input ref={aduanaInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'aduana')} />
      <input ref={auditInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'auditoria')} />

      <section className="border border-slate-300 bg-white px-4 py-3 shadow-sm sm:px-5">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center border border-slate-200 bg-white text-blue-700">
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
            <button type="button" onClick={resetExpedicao} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black text-red-700 hover:bg-slate-50">
              <Trash2 className="h-4 w-4" /> Zerar
            </button>
            <button type="button" onClick={closeExpedicao} disabled={!totalErrors} className="h-9 border border-slate-400 bg-[#ffd52f] px-3 text-xs font-black text-slate-950 disabled:opacity-40">
              Encerrar
            </button>
          </div>
        </div>
      </section>

      {!store.base.length && (
        <section className="border border-amber-300 bg-white px-4 py-3 text-xs font-bold text-amber-900">Carregue a Base Despacho para calcular o destino correto.</section>
      )}

      {store.ultimaImportacao && (
        <section className="flex items-center justify-between gap-3 border border-slate-300 bg-white px-4 py-2.5">
          <div className="flex min-w-0 items-center gap-2">
            <Clock className="h-4 w-4 shrink-0 text-blue-700" />
            <p className="truncate text-xs font-bold text-slate-800">{store.ultimaImportacao.arquivo} • {formatDateTime(store.ultimaImportacao.registradoEm)}</p>
          </div>
          <span className="shrink-0 border border-slate-300 bg-white px-3 py-1 text-[10px] font-black text-slate-700">
            {store.ultimaImportacao.alteracoes === 0 ? 'Sem mudanças' : `${store.ultimaImportacao.alteracoes} mudanças`}
          </span>
        </section>
      )}

      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <div className="border border-slate-300 bg-white px-4 py-3 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-500">A mais</p><p className="text-3xl font-black text-red-600">{counts.amais}</p></div>
        <div className="border border-slate-300 bg-white px-4 py-3 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-500">Faltantes</p><p className="text-3xl font-black text-amber-700">{counts.faltantes}</p></div>
        <div className="border border-slate-300 bg-white px-4 py-3 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-500">Recuperados em lista</p><p className="text-3xl font-black text-emerald-700">{recuperadosEmLista}</p></div>
        <div className="border border-slate-300 bg-white px-4 py-3 shadow-sm"><p className="text-[10px] font-black uppercase text-slate-500">Sem destino</p><p className="text-3xl font-black text-slate-700">{counts.semDestino}</p></div>
      </div>

      {backlogError && <div className="border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900">{backlogError}</div>}

      <section className="border border-slate-300 bg-white p-3 shadow-sm">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div className="flex items-baseline gap-2"><h2 className="text-lg font-black text-slate-950">20 vagas</h2><span className="text-[10px] font-bold text-slate-400">cinza = 100% recuperada</span></div>
          {selectedDoca && <button type="button" onClick={() => setSelectedDoca(null)} className="border border-slate-300 bg-white px-3 py-2 text-xs font-black">Limpar</button>}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_440px] xl:items-start">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {heatmap.map(item => {
              const muted = item.fullyResolved;
              return (
                <button key={item.doca} type="button" onClick={() => setSelectedDoca(item.doca)} className={`relative flex min-h-[150px] flex-col border p-3 text-left transition hover:border-slate-500 ${muted ? 'border-slate-400 bg-slate-200' : 'border-slate-300 bg-white'} ${selectedDoca === item.doca ? 'ring-2 ring-slate-900' : ''}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className={`text-sm font-black ${muted ? 'text-slate-600' : 'text-slate-950'}`}>VAGA {item.doca}</span>
                    {muted ? <span className="border border-slate-500 bg-slate-600 px-2 py-0.5 text-[9px] font-black text-white">100%</span> : item.changed ? <span className="border border-slate-300 bg-white px-2 py-0.5 text-[9px] font-black text-slate-700">{formatTime(item.latest?.registradoEm)}</span> : null}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 border-t border-slate-300 pt-3">
                    <div><p className="text-[9px] font-black uppercase text-slate-500">A mais</p><p className={`text-xl font-black ${muted ? 'text-slate-600' : 'text-red-600'}`}>{item.amais}</p></div>
                    <div><p className="text-[9px] font-black uppercase text-slate-500">Faltante</p><p className={`text-xl font-black ${muted ? 'text-slate-600' : 'text-amber-700'}`}>{item.faltantes}</p></div>
                  </div>
                  <div className="mt-auto border-t border-slate-300 pt-2">
                    <div className="flex items-end justify-between gap-2">
                      <div><p className="text-[9px] font-black uppercase text-slate-500">Recuperados</p><p className={`text-base font-black ${muted ? 'text-slate-600' : 'text-emerald-700'}`}>{item.resolved}</p></div>
                      <span className="text-[9px] font-bold text-slate-500">{item.resolved}/{item.total}</span>
                    </div>
                    <div className="mt-1.5 h-1 overflow-hidden bg-slate-300"><div className={`h-full transition-all ${muted ? 'bg-slate-600' : 'bg-emerald-600'}`} style={{ width: item.total ? `${Math.round((item.resolved / item.total) * 100)}%` : '0%' }} /></div>
                  </div>
                </button>
              );
            })}
          </div>

          <aside className={`h-[620px] min-h-0 overflow-y-auto border p-3 xl:sticky xl:top-20 ${selectedDock?.fullyResolved ? 'border-slate-400 bg-slate-100' : 'border-slate-300 bg-white'}`}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-inherit pb-2.5">
              <h3 className={`text-xl font-black ${selectedDock?.fullyResolved ? 'text-slate-600' : 'text-slate-950'}`}>{selectedDoca ? `VAGA ${selectedDoca}` : 'Selecione uma vaga'}</h3>
              {selectedDoca && <span className="text-[10px] font-black text-slate-500">{selectedDockItems.length} itens</span>}
            </div>

            {selectedDoca ? (
              <div className="mt-3 divide-y divide-slate-200 border border-slate-200">
                {selectedDockItems.length ? selectedDockItems.map(row => {
                  const manuallyRecovered = Boolean(store.localizados?.[row.pacote]);
                  const backlog = backlogById[row.pacote] || [];
                  const recoveredInList = row.classificacao === 'Faltante' && backlog.length > 0;
                  const muted = Boolean(selectedDock?.fullyResolved);

                  return (
                    <label key={row.pacote} className={`block cursor-pointer p-3 ${muted || manuallyRecovered ? 'bg-slate-100' : 'bg-white'}`}>
                      <span className="flex items-start gap-3">
                        <input type="checkbox" checked={manuallyRecovered} onChange={() => toggleLocated(row.pacote)} className="mt-0.5 h-5 w-5 shrink-0 accent-slate-700" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-start justify-between gap-3">
                            <span><b className={`block font-mono text-sm ${muted ? 'text-slate-600' : 'text-slate-950'}`}>{row.pacote}</b><span className="mt-0.5 block text-[9px] font-bold uppercase tracking-wide text-slate-500">Origem: {originLabel(row.origem)}</span></span>
                            <strong className={`text-[9px] font-black uppercase ${typeTextClass(row.classificacao, muted)}`}>{row.classificacao}</strong>
                          </span>
                          <div className="mt-2 border-t border-slate-200 pt-2 text-[10px] font-bold text-slate-600">
                            <b>Encontrado:</b>{' '}
                            {row.encontradoDoca ? `VAGA ${row.encontradoDoca}` : 'VAGA não localizada'}
                            {gaiolaFromRoute(row.encontradoRota) ? ` • ${gaiolaFromRoute(row.encontradoRota)}` : ''}
                            {row.encontradoPlaca ? ` • placa ${row.encontradoPlaca}` : ''}
                          </div>
                          {row.classificacao === 'A mais' ? (
                            <div className="mt-1 text-[10px] font-bold text-slate-600"><b>Destino:</b>{' '}{row.destinoDoca && row.destinoRota ? `VAGA ${row.destinoDoca} - ${row.destinoRota}${row.destinoOnda ? ` - ${row.destinoOnda}` : ''}` : 'não localizado na Base Despacho'}</div>
                          ) : (
                            <div className="mt-1 text-[10px] font-bold text-slate-600">{recoveredInList ? <span className={muted ? 'font-black text-slate-600' : 'font-black text-emerald-800'}>{backlog.slice(0, 2).map(occurrenceLabel).join(' | ')}{backlog.length > 2 ? ` | +${backlog.length - 2}` : ''}</span> : 'Não encontrado nas listas do dia'}</div>
                          )}
                        </span>
                      </span>
                    </label>
                  );
                }) : <p className="p-4 text-center text-sm text-slate-500">Sem erros nesta vaga.</p>}
              </div>
            ) : <p className="py-10 text-center text-sm text-slate-500">Clique em uma vaga.</p>}
          </aside>
        </div>
      </section>

      <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 bg-white p-2.5">
          <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex flex-wrap gap-1.5">
                {(['todos', 'A mais', 'Faltante'] as const).map(option => <button key={option} type="button" onClick={() => setFilter(option)} className={`border px-3 py-2 text-xs font-black ${filter === option ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-300 bg-white text-slate-600 hover:bg-slate-50'}`}>{option === 'todos' ? 'Todos' : option}</button>)}
              </div>
              <select value={originFilter} onChange={event => setOriginFilter(event.target.value as OrigemFilter)} className="h-9 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" aria-label="Filtrar por origem">
                <option value="todas">Origem: todas</option><option value="aduana">Origem: Aduana</option><option value="auditoria">Origem: Auditoria</option>
              </select>
              <select value={destinationFilter} onChange={event => setDestinationFilter(event.target.value as DestinoFilter)} className="h-9 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-500" aria-label="Filtrar por destino">
                <option value="todos">Destino: todos</option><option value="em-lista">Recuperado em lista</option><option value="fora-lista">Fora das listas</option><option value="com-destino">Com destino</option><option value="sem-destino">Sem destino</option>
              </select>
              {(filter !== 'todos' || originFilter !== 'todas' || destinationFilter !== 'todos' || query) && <button type="button" onClick={resetFilters} className="h-9 border border-slate-300 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50">Limpar filtros</button>}
            </div>
            <label className="relative w-full xl:w-[300px]">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
              <input value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, vaga, origem, gaiola, placa ou lista" className="h-9 w-full border border-slate-300 bg-white pl-9 pr-3 text-xs outline-none focus:border-blue-500" />
            </label>
          </div>
          <div className="mt-2 text-[10px] font-bold text-slate-500">{rows.length} resultado(s)</div>
        </div>

        <div className="app-scroll-x max-h-[620px] overflow-y-auto">
          <table className="w-full min-w-[1040px] border-collapse text-xs">
            <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500"><tr>{['ID / Origem', 'Tipo', 'Encontrado', 'Destino / Lista', 'OK'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black last:border-r-0">{head}</th>)}</tr></thead>
            <tbody>
              {rows.slice(0, 1000).map(row => {
                const backlog = backlogById[row.pacote] || [];
                const recoveredInList = row.classificacao === 'Faltante' && backlog.length > 0;
                return (
                  <tr key={row.pacote} className="bg-white hover:bg-slate-50">
                    <td className="border-b border-r border-slate-200 px-3 py-2"><div className="font-mono font-black text-slate-900">{row.pacote}</div><div className="mt-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500">Origem: {originLabel(row.origem)}</div></td>
                    <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`font-black uppercase ${typeTextClass(row.classificacao)}`}>{row.classificacao}</span></td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-bold text-slate-700">
                      <div className="font-black text-slate-900">{row.encontradoDoca ? `VAGA ${row.encontradoDoca}` : 'VAGA não localizada'}</div>
                      <div className="mt-0.5 text-[10px] text-slate-500">
                        {gaiolaFromRoute(row.encontradoRota) || 'Gaiola não informada'}
                        {row.encontradoPlaca ? ` • placa ${row.encontradoPlaca}` : ''}
                      </div>
                    </td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 text-slate-700">
                      {row.classificacao === 'A mais'
                        ? row.destinoDoca && row.destinoRota
                          ? <span className="font-bold">VAGA {row.destinoDoca} - {row.destinoRota}{row.destinoOnda ? ` - ${row.destinoOnda}` : ''}</span>
                          : <span className="text-slate-400">Sem destino</span>
                        : recoveredInList
                          ? <span className="font-bold text-emerald-800">{occurrenceLabel(backlog[0])}{backlog.length > 1 ? ` | +${backlog.length - 1}` : ''}</span>
                          : <span className="text-slate-400">Fora das listas do dia</span>}
                    </td>
                    <td className="border-b border-slate-200 px-3 py-2 text-center"><input type="checkbox" checked={Boolean(store.localizados?.[row.pacote])} onChange={() => toggleLocated(row.pacote)} className="h-4 w-4 accent-slate-700" /></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={5} className="px-4 py-10 text-center text-sm text-slate-500">Nenhum item com esses filtros.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {report && (
        <section className="border border-slate-300 bg-white px-4 py-3">
          <div className="flex flex-wrap items-center gap-6 text-sm"><span><b>Pendentes:</b> {pending}</span><span><b>Recuperados em lista:</b> {recuperadosEmLista}</span><span><b>Marcados OK:</b> {counts.localizados}</span><span><b>Taxa:</b> {recoveryRate}%</span></div>
        </section>
      )}
    </div>
  );
}
