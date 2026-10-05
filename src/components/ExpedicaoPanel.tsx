import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CheckCircle2, FileText, Search, Trash2, UploadCloud, X } from 'lucide-react';
import { ExpedicaoSkeleton } from './ExpedicaoSkeleton';
import { getLocalValue, setLocalValue } from '../lib/localPersistence';
import {
  listenExpedicaoShared,
  resetExpedicaoShared,
  setExpedicaoSharedLocated,
  syncExpedicaoImport,
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
type ViewTab = 'aduana' | 'auditoria';
type TipoFilter = 'todos' | 'A mais' | 'Faltante';
type ListaFilter = 'todos' | 'em-lista' | 'fora-lista' | 'encontrados' | 'pendentes';
type SyncState = 'connecting' | 'syncing' | 'synced' | 'error';

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

function routeLabel(route: string) {
  return String(route || '').split('|')[0].trim();
}

function sameRoute(left: string, right: string) {
  const a = routeLabel(left).toUpperCase();
  const b = routeLabel(right).toUpperCase();
  return Boolean(a && b && a === b);
}

function streetLabel(route: string) {
  const routeName = routeLabel(route).toUpperCase();
  if (!routeName) return 'SEM RUA';
  const match = routeName.match(/^([A-Z]+)/);
  return match?.[1] || 'SEM RUA';
}

function formatDateTime(value?: string) {
  if (!value) return '';
  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, day, month, , hour = '0', minute = '0'] = br;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}, ${hour.padStart(2, '0')}:${minute}`;
  }
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) {
    return new Date(timestamp).toLocaleString('pt-BR', {
      day: '2-digit',
      month: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }
  return value;
}

function occurrenceLabel(item: TodayListOccurrence) {
  const group = item.grupoNome || 'Grupo';
  const user = item.item?.responsavel?.trim() || 'não informado';
  return `${group} • bipado por ${user}`;
}

export function ExpedicaoPanel() {
  const [store, setStore] = useState<ExpedicaoStore>(empty);
  const [hydrated, setHydrated] = useState(false);
  const [remoteReady, setRemoteReady] = useState(false);
  const [screenReady, setScreenReady] = useState(false);
  const [tab, setTab] = useState<ViewTab>('aduana');
  const [filter, setFilter] = useState<TipoFilter>('todos');
  const [listaFilter, setListaFilter] = useState<ListaFilter>('todos');
  const [query, setQuery] = useState('');
  const [selectedDoca, setSelectedDoca] = useState<string | null>(null);
  const [selectedStreet, setSelectedStreet] = useState<string | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [error, setError] = useState('');
  const [syncState, setSyncState] = useState<SyncState>('connecting');
  const [backlogById, setBacklogById] = useState<Record<string, TodayListOccurrence[]>>({});

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
      .finally(() => active && setHydrated(true));
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!hydrated) return undefined;
    return listenExpedicaoShared(remote => {
      if (!remote) return;
      setStore(current => {
        const merged = { ...current, ...remote, historico: current.historico || [] } as ExpedicaoStore;
        void setLocalValue(STORAGE_KEY, merged);
        return merged;
      });
      setSyncState(current => current === 'syncing' ? current : 'synced');
      setRemoteReady(true);
      setError('');
    }, syncError => {
      console.error(syncError);
      setSyncState('error');
      setRemoteReady(true);
      setError('Sem conexão com a sincronização.');
    });
  }, [hydrated]);

  const importFile = async (file: File, source: FonteImportacaoExpedicao) => {
    setScreenReady(false);
    setSyncState('syncing');
    setError('');
    try {
      const text = await file.text();
      const registradoEm = new Date().toISOString();
      const before = enrichExpedicao(store);
      const next: ExpedicaoStore = {
        ...store,
        updatedAt: registradoEm,
        filenames: { ...store.filenames, [source]: file.name },
      };
      let changes: ExpedicaoDocaChange[] = [];

      if (source === 'base') {
        const parsed = parseBaseDespacho(text);
        const baseChanges = store.base.length ? getBaseDockChanges(store.base, parsed, registradoEm) : [];
        next.base = parsed;
        next.historicoDoca = [...(store.historicoDoca || []), ...baseChanges].slice(-20000);
        changes = baseChanges;
      } else {
        const parsed = parseExpedicaoRows(text, source);
        next.historico = [...(store.historico || []), ...getChanges(store[source], parsed, source)].slice(-10000);
        next[source] = parsed;
      }

      const after = enrichExpedicao(next);
      const errorChanges = getExpedicaoDockChanges(before, after, source, registradoEm);
      changes = [...changes, ...errorChanges];
      next.ultimaComparacao = changes;
      next.historicoDoca = [...(next.historicoDoca || []), ...errorChanges].slice(-20000);
      next.ultimaImportacao = { fonte: source, arquivo: file.name, registradoEm, alteracoes: changes.length };
      await syncExpedicaoImport(next, source);
      setSyncState('synced');
    } catch (cause) {
      console.error('[Expedição] falha:', cause);
      setSyncState('error');
      setError('Arquivo não sincronizado. Tente novamente.');
    } finally {
      setScreenReady(true);
    }
  };

  const reset = async () => {
    if (!window.confirm('Zerar a Expedição para todos os usuários?')) return;
    setSyncState('syncing');
    setError('');
    try {
      await resetExpedicaoShared();
      setSelectedDoca(null);
      setSelectedStreet(null);
      setQuery('');
      setFilter('todos');
      setListaFilter('todos');
      setReportOpen(false);
      setSyncState('synced');
    } catch (cause) {
      console.error('[Expedição] falha ao zerar:', cause);
      setSyncState('error');
      setError('Não foi possível zerar. Tente novamente.');
    }
  };

  const toggleLocated = async (pacote: string) => {
    const value = !store.localizados?.[pacote];
    setSyncState('syncing');
    setError('');
    try {
      await setExpedicaoSharedLocated(pacote, value);
      setSyncState('synced');
    } catch (cause) {
      console.error('[Expedição] falha ao marcar ID:', cause);
      setSyncState('error');
      setError(`Não foi possível sincronizar o ID ${pacote}. Tente novamente.`);
    }
  };

  const enriched = useMemo(() => enrichExpedicao(store), [store]);
  const aduanaRows = useMemo(() => enriched.filter(row => row.origem === 'aduana'), [enriched]);
  const auditoriaRows = useMemo(() => enriched.filter(row => row.origem === 'auditoria'), [enriched]);

  const aduanaIdsKey = useMemo(() => aduanaRows.map(row => row.pacote).sort().join('|'), [aduanaRows]);
  useEffect(() => {
    let active = true;
    if (!hydrated) return () => { active = false; };
    const ids = aduanaIdsKey ? aduanaIdsKey.split('|') : [];
    if (!ids.length) {
      setBacklogById({});
      setScreenReady(true);
      return () => { active = false; };
    }
    setScreenReady(false);
    searchTodayListOccurrences(ids)
      .then(found => {
        if (!active) return;
        const next: Record<string, TodayListOccurrence[]> = {};
        ids.forEach(pacote => {
          next[pacote] = found.get(pacote) || found.get(pacote.replace(/\D/g, '')) || [];
        });
        setBacklogById(next);
      })
      .catch(() => setBacklogById({}))
      .finally(() => active && setScreenReady(true));
    return () => { active = false; };
  }, [hydrated, aduanaIdsKey, store.updatedAt]);

  const isFound = (pacote: string) => Boolean(store.localizados?.[pacote]) || (backlogById[pacote]?.length || 0) > 0;

  const filteredAduanaRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return aduanaRows.filter(row => {
      const inList = (backlogById[row.pacote]?.length || 0) > 0;
      const found = Boolean(store.localizados?.[row.pacote]) || inList;
      const text = [
        row.pacote,
        row.classificacao,
        row.encontradoRota,
        row.encontradoPlaca,
        row.encontradoDoca,
        row.destinoRota,
        row.destinoDoca,
        row.destinoOnda,
      ].join(' ').toLowerCase();
      const listMatch = listaFilter === 'todos'
        || (listaFilter === 'em-lista' && inList)
        || (listaFilter === 'fora-lista' && !inList)
        || (listaFilter === 'encontrados' && found)
        || (listaFilter === 'pendentes' && !found);
      return (filter === 'todos' || row.classificacao === filter)
        && (!selectedDoca || row.vagaOperacional === selectedDoca)
        && listMatch
        && text.includes(needle);
    });
  }, [aduanaRows, backlogById, filter, listaFilter, query, selectedDoca, store.localizados]);

  const filteredAuditoriaRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return auditoriaRows.filter(row => {
      const text = [row.pacote, row.classificacao, row.encontradoRota, row.encontradoPlaca].join(' ').toLowerCase();
      const streetMatch = !selectedStreet || streetLabel(row.encontradoRota) === selectedStreet;
      return streetMatch && text.includes(needle);
    });
  }, [auditoriaRows, query, selectedStreet]);

  const auditStreetStats = useMemo(() => {
    const stats = new Map<string, { rua: string; total: number; amais: number; faltantes: number; ok: number }>();
    auditoriaRows.forEach(row => {
      const rua = streetLabel(row.encontradoRota);
      const current = stats.get(rua) || { rua, total: 0, amais: 0, faltantes: 0, ok: 0 };
      current.total += 1;
      if (row.classificacao === 'A mais') current.amais += 1;
      if (row.classificacao === 'Faltante') current.faltantes += 1;
      if (store.localizados?.[row.pacote]) current.ok += 1;
      stats.set(rua, current);
    });
    return [...stats.values()].sort((a, b) => b.total - a.total || a.rua.localeCompare(b.rua, 'pt-BR'));
  }, [auditoriaRows, store.localizados]);

  const heatmap = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const doca = String(index + 1);
    const rows = aduanaRows.filter(row => row.vagaOperacional === doca);
    const encontrados = rows.filter(row => Boolean(store.localizados?.[row.pacote]) || (backlogById[row.pacote]?.length || 0) > 0).length;
    const emLista = rows.filter(row => (backlogById[row.pacote]?.length || 0) > 0).length;
    const percentual = rows.length ? Math.round((encontrados / rows.length) * 100) : 0;
    return {
      doca,
      amais: rows.filter(row => row.classificacao === 'A mais').length,
      faltantes: rows.filter(row => row.classificacao === 'Faltante').length,
      total: rows.length,
      encontrados,
      emLista,
      percentual,
      concluida: rows.length === 0 || encontrados === rows.length,
    };
  }), [aduanaRows, backlogById, store.localizados]);

  const unconfirmedAduana = useMemo(() => aduanaRows.filter(row => !row.localizacaoConfirmada).length, [aduanaRows]);
  const selectedDockRows = useMemo(
    () => selectedDoca ? aduanaRows.filter(row => row.vagaOperacional === selectedDoca) : [],
    [aduanaRows, selectedDoca],
  );
  const totalEmLista = useMemo(
    () => aduanaRows.filter(row => (backlogById[row.pacote]?.length || 0) > 0).length,
    [aduanaRows, backlogById],
  );
  const totalEncontrados = useMemo(
    () => aduanaRows.filter(row => isFound(row.pacote)).length,
    [aduanaRows, backlogById, store.localizados],
  );
  const totalPercentual = aduanaRows.length ? Math.round((totalEncontrados / aduanaRows.length) * 100) : 0;

  const aduanaAmais = aduanaRows.filter(row => row.classificacao === 'A mais').length;
  const aduanaFaltantes = aduanaRows.filter(row => row.classificacao === 'Faltante').length;
  const aduanaPendentes = Math.max(0, aduanaRows.length - totalEncontrados);
  const errosAlocacao = aduanaRows.filter(row => (
    row.classificacao === 'Faltante'
    && row.destinoConfirmado
    && sameRoute(row.encontradoRota, row.destinoRota)
  )).length;
  const auditoriaAmais = auditoriaRows.filter(row => row.classificacao === 'A mais').length;
  const auditoriaFaltantes = auditoriaRows.filter(row => row.classificacao === 'Faltante').length;
  const auditoriaOk = auditoriaRows.filter(row => Boolean(store.localizados?.[row.pacote])).length;

  if (!hydrated || !remoteReady || !screenReady) return <ExpedicaoSkeleton />;

  const upload = (label: string, ref: RefObject<HTMLInputElement | null>) => (
    <button
      type="button"
      disabled={syncState !== 'synced'}
      onClick={() => ref.current?.click()}
      className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <UploadCloud className="h-4 w-4" />{label}
    </button>
  );

  const searchBox = (placeholder: string, extraClass = '') => (
    <label className={`relative w-full sm:w-[320px] ${extraClass}`}>
      <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
      <input
        value={query}
        onChange={event => setQuery(event.target.value)}
        placeholder={placeholder}
        className="h-9 w-full border border-slate-300 pl-9 pr-9 text-xs"
      />
      {query && (
        <button
          type="button"
          onClick={() => setQuery('')}
          title="Limpar pesquisa"
          className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center text-slate-400 hover:bg-slate-100 hover:text-slate-900"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </label>
  );

  return (
    <div className="w-full space-y-3">
      <input ref={baseInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'base')} />
      <input ref={aduanaInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'aduana')} />
      <input ref={auditInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'auditoria')} />

      <section className="border border-slate-300 bg-white p-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTab('aduana');
                setSelectedDoca(null);
                setSelectedStreet(null);
                setQuery('');
                setFilter('todos');
                setListaFilter('todos');
              }}
              className={`px-4 py-2 text-sm font-black ${tab === 'aduana' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}
            >
              Aduana • vagas
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('auditoria');
                setSelectedDoca(null);
                setSelectedStreet(null);
                setQuery('');
                setFilter('todos');
                setListaFilter('todos');
              }}
              className={`px-4 py-2 text-sm font-black ${tab === 'auditoria' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}
            >
              Auditoria • pacotes
            </button>
          </div>

          <div className="flex flex-wrap gap-2">
            {store.base.length === 0 && upload('Despacho', baseInput)}
            {tab === 'aduana' && upload('Aduana', aduanaInput)}
            {tab === 'auditoria' && upload('Auditoria', auditInput)}
            <button
              type="button"
              onClick={() => setReportOpen(true)}
              className="inline-flex h-9 items-center gap-2 bg-slate-900 px-3 text-xs font-black text-white hover:bg-slate-800"
            >
              <FileText className="h-4 w-4" />Encerrar
            </button>
            <button
              type="button"
              disabled={syncState !== 'synced'}
              onClick={reset}
              className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 className="h-4 w-4" />Zerar
            </button>
          </div>
        </div>
      </section>

      {error && <div className="border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900">{error}</div>}

      {tab === 'aduana' ? (
        <>
          <section className="border border-slate-300 bg-white p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap justify-end gap-2 text-[10px] font-black">
              <span className="border border-slate-300 bg-slate-50 px-3 py-1.5">EM LISTA HOJE: {totalEmLista}</span>
              <span className="border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-emerald-800">ENCONTRADOS: {totalEncontrados}/{aduanaRows.length} • {totalPercentual}%</span>
              {unconfirmedAduana > 0 && <span className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800">SEM VAGA: {unconfirmedAduana}</span>}
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_390px] xl:items-start">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {heatmap.map(item => (
                  <button
                    key={item.doca}
                    type="button"
                    onClick={() => setSelectedDoca(selectedDoca === item.doca ? null : item.doca)}
                    className={`min-h-[128px] border p-3 text-left transition ${item.concluida ? 'border-slate-400 bg-slate-200 text-slate-700' : 'border-slate-300 bg-white'} ${selectedDoca === item.doca ? 'ring-2 ring-slate-900' : ''}`}
                  >
                    <div className="flex items-center justify-between gap-2"><span className="font-black">VAGA {item.doca}</span><span className="text-sm font-black">{item.percentual}%</span></div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span>A+ <b className="text-red-600">{item.amais}</b></span><span>Falt. <b className="text-amber-700">{item.faltantes}</b></span></div>
                    <div className="mt-2 text-[10px] font-bold text-slate-600">{item.encontrados}/{item.total} encontrados</div>
                    <div className="mt-0.5 text-[9px] font-bold text-slate-400">{item.emLista} em lista do dia</div>
                    <div className="mt-2 h-1.5 overflow-hidden bg-slate-200"><div className="h-full bg-slate-700 transition-all" style={{ width: `${item.percentual}%` }} /></div>
                  </button>
                ))}
              </div>

              <aside className="h-[610px] overflow-y-auto border border-slate-300 bg-slate-50 xl:sticky xl:top-20">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-3 py-2.5">
                  <h3 className="font-black text-slate-950">{selectedDoca ? `VAGA ${selectedDoca}` : 'Check list'}</h3>
                  {selectedDoca && <span className="text-[10px] font-black text-slate-500">{selectedDockRows.length} itens</span>}
                </div>
                {!selectedDoca ? (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">Selecione uma vaga.</p>
                ) : selectedDockRows.length ? (
                  <div className="divide-y divide-slate-200">
                    {selectedDockRows.map(row => {
                      const checked = Boolean(store.localizados?.[row.pacote]);
                      const backlog = backlogById[row.pacote] || [];
                      const found = checked || backlog.length > 0;
                      return (
                        <label key={row.pacote} className={`block cursor-pointer p-3 ${found ? 'bg-slate-200' : 'bg-white'}`}>
                          <span className="flex items-start gap-3">
                            <input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="mt-1 h-5 w-5 shrink-0 accent-slate-800 disabled:cursor-not-allowed" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-start justify-between gap-2"><b className="font-mono text-sm">{row.pacote}</b><span className={`text-[9px] font-black uppercase ${row.classificacao === 'A mais' ? 'text-red-600' : 'text-amber-700'}`}>{row.classificacao}</span></span>
                              <span className="mt-1 block text-[10px] text-slate-600"><b>Aqui:</b> VAGA {row.encontradoDoca}{routeLabel(row.encontradoRota) ? ` • ${routeLabel(row.encontradoRota)}` : ''}</span>
                              <span className="mt-1 block text-[10px] text-slate-600"><b>Deveria:</b> {row.destinoConfirmado ? `VAGA ${row.destinoDoca}${row.destinoRota ? ` • ${row.destinoRota}` : ''}` : 'sem destino no Despacho'}</span>
                              {backlog.length > 0 && <span className="mt-1 block text-[10px] font-black text-emerald-700"><CheckCircle2 className="mr-1 inline h-3 w-3" />EM LISTA • {occurrenceLabel(backlog[0])}</span>}
                            </span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                ) : (
                  <p className="px-4 py-10 text-center text-sm text-slate-500">Nenhum pacote nesta vaga.</p>
                )}
              </aside>
            </div>
          </section>

          <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1.5">
                  {(['todos', 'A mais', 'Faltante'] as const).map(option => (
                    <button key={option} type="button" onClick={() => setFilter(option)} className={`border px-3 py-2 text-xs font-black ${filter === option ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>
                      {option === 'todos' ? 'Todos' : option}
                    </button>
                  ))}
                </div>
                <select value={listaFilter} onChange={event => setListaFilter(event.target.value as ListaFilter)} className="h-9 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700">
                  <option value="todos">Lista: todos</option>
                  <option value="em-lista">Em lista do dia</option>
                  <option value="fora-lista">Fora das listas</option>
                  <option value="encontrados">Encontrados</option>
                  <option value="pendentes">Pendentes</option>
                </select>
                {selectedDoca && <button type="button" onClick={() => setSelectedDoca(null)} className="h-9 border border-slate-300 bg-white px-3 text-xs font-black text-slate-600">Todas as vagas</button>}
                {searchBox('ID, rota, placa ou vaga', 'ml-auto')}
              </div>
              <div className="mt-2 text-[10px] font-bold text-slate-500">{filteredAduanaRows.length} resultado(s)</div>
            </div>
            <div className="max-h-[650px] overflow-auto">
              <table className="w-full min-w-[1050px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100">
                  <tr>{['ID', 'Tipo', 'Encontrado', 'Deveria estar', 'Lista do dia', 'Status', 'OK'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black">{head}</th>)}</tr>
                </thead>
                <tbody>
                  {filteredAduanaRows.map(row => {
                    const backlog = backlogById[row.pacote] || [];
                    const checked = Boolean(store.localizados?.[row.pacote]);
                    const found = checked || backlog.length > 0;
                    const allocationError = row.classificacao === 'Faltante'
                      && row.destinoConfirmado
                      && sameRoute(row.encontradoRota, row.destinoRota);
                    const statusLabel = allocationError ? 'ERRO DE ALOCAÇÃO' : found ? 'ENCONTRADO' : 'PENDENTE';
                    const statusClass = allocationError ? 'text-red-700' : found ? 'text-emerald-700' : 'text-amber-700';
                    return (
                      <tr key={`aduana-${row.pacote}`} className={allocationError ? 'bg-red-50/60' : found ? 'bg-slate-50' : 'hover:bg-slate-50'}>
                        <td className="border-b border-r border-slate-200 px-3 py-2 font-mono font-black">{row.pacote}<div className="font-sans text-[9px] text-slate-400">{formatDateTime(row.dataRegistro)}</div></td>
                        <td className="border-b border-r border-slate-200 px-3 py-2 font-black">{row.classificacao}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-2"><b>{row.encontradoDoca ? `VAGA ${row.encontradoDoca}` : 'VAGA NÃO LOCALIZADA'}</b><div className="text-[10px] text-slate-500">{routeLabel(row.encontradoRota) || 'sem rota'}{row.encontradoPlaca ? ` • ${row.encontradoPlaca}` : ''}</div></td>
                        <td className="border-b border-r border-slate-200 px-3 py-2">{row.destinoConfirmado ? <><b>VAGA {row.destinoDoca}</b><div className="text-[10px] text-slate-500">{row.destinoRota || 'sem rota'}{row.destinoOnda ? ` • ${row.destinoOnda}` : ''}</div></> : <b className="text-amber-700">SEM DESTINO</b>}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-2">{backlog.length ? <><b className="text-emerald-700">EM LISTA</b><div className="text-[10px] text-slate-500">{occurrenceLabel(backlog[0])}{backlog.length > 1 ? ` • +${backlog.length - 1}` : ''}</div></> : <span className="text-slate-400">Não encontrado hoje</span>}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`font-black ${statusClass}`}>{statusLabel}</span></td>
                        <td className="border-b border-slate-200 px-3 py-2 text-center"><input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="h-4 w-4 accent-slate-700 disabled:cursor-not-allowed" /></td>
                      </tr>
                    );
                  })}
                  {!filteredAduanaRows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Nenhum item.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <div className="space-y-3">
          <section className="border border-slate-300 bg-white p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
              {auditStreetStats[0] && <div className="ml-auto border border-slate-300 bg-slate-900 px-4 py-2 text-white"><div className="text-[9px] font-black uppercase tracking-wider text-slate-300">Rua com mais achados</div><div className="text-xl font-black">{auditStreetStats[0].rua} • {auditStreetStats[0].total}</div></div>}
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
              {auditStreetStats.map((item, index) => {
                const percentual = auditoriaRows.length ? Math.round((item.total / auditoriaRows.length) * 100) : 0;
                const selected = selectedStreet === item.rua;
                return (
                  <button key={item.rua} type="button" onClick={() => setSelectedStreet(selected ? null : item.rua)} className={`min-h-[116px] border p-3 text-left transition ${selected ? 'border-slate-900 bg-slate-900 text-white ring-2 ring-slate-900 ring-offset-1' : index === 0 ? 'border-slate-500 bg-slate-50' : 'border-slate-300 bg-white hover:bg-slate-50'}`}>
                    <div className="flex items-start justify-between gap-2"><div><div className={`text-[9px] font-black uppercase ${selected ? 'text-slate-300' : 'text-slate-400'}`}>#{index + 1}</div><div className={`text-xl font-black ${selected ? 'text-white' : 'text-slate-900'}`}>RUA {item.rua}</div></div><div className="text-lg font-black">{item.total}</div></div>
                    <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-black">
                      <span className="border border-red-200 bg-red-50 px-1.5 py-0.5 text-red-700">A+ {item.amais}</span>
                      <span className="border border-amber-200 bg-amber-50 px-1.5 py-0.5 text-amber-800">FALT. {item.faltantes}</span>
                      <span className={`border px-1.5 py-0.5 ${selected ? 'border-slate-500 bg-slate-800 text-white' : 'border-slate-200 bg-slate-50 text-slate-600'}`}>OK {item.ok}</span>
                    </div>
                    <div className={`mt-2 h-1.5 overflow-hidden ${selected ? 'bg-slate-700' : 'bg-slate-200'}`}><div className={`h-full ${selected ? 'bg-white' : 'bg-slate-700'}`} style={{ width: `${percentual}%` }} /></div>
                    <div className={`mt-1 text-[9px] font-bold ${selected ? 'text-slate-300' : 'text-slate-400'}`}>{percentual}% dos achados{selected ? ' • selecionada' : ''}</div>
                  </button>
                );
              })}
              {!auditStreetStats.length && <div className="col-span-full py-8 text-center text-sm text-slate-500">Sem dados de rua na Auditoria.</div>}
            </div>
          </section>

          <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-2.5">
              <div className="text-xs font-black text-slate-600">{selectedStreet ? `RUA ${selectedStreet} • ${filteredAuditoriaRows.length} pacote(s)` : `${filteredAuditoriaRows.length} pacote(s)`}</div>
              <div className="flex w-full items-center gap-2 sm:w-auto">
                {selectedStreet && <button type="button" onClick={() => setSelectedStreet(null)} className="h-9 shrink-0 border border-slate-300 bg-white px-3 text-xs font-black text-slate-600 hover:bg-slate-50">Todas as ruas</button>}
                {searchBox('Buscar ID, rua ou Contenedor')}
              </div>
            </div>
            <div className="max-h-[700px] overflow-auto">
              <table className="w-full min-w-[640px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100"><tr>{['Pacote', 'Encontrado em', 'Tipo', 'Check list'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black">{head}</th>)}</tr></thead>
                <tbody>
                  {filteredAuditoriaRows.map(row => {
                    const checked = Boolean(store.localizados?.[row.pacote]);
                    return (
                      <tr key={`auditoria-${row.pacote}`} className={checked ? 'bg-slate-100 text-slate-500' : 'hover:bg-slate-50'}>
                        <td className="border-b border-r border-slate-200 px-3 py-2 font-mono font-black">{row.pacote}<div className="font-sans text-[9px] text-slate-400">{formatDateTime(row.dataRegistro)}</div></td>
                        <td className="border-b border-r border-slate-200 px-3 py-2 font-black"><span className="mr-2 text-slate-400">RUA {streetLabel(row.encontradoRota)}</span>{routeLabel(row.encontradoRota) || 'SEM CONTENEDOR'}</td>
                        <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`inline-block border px-2 py-1 font-black ${row.classificacao === 'A mais' ? 'border-red-200 bg-red-50 text-red-700' : 'border-amber-200 bg-amber-50 text-amber-800'}`}>{row.classificacao}</span></td>
                        <td className="border-b border-slate-200 px-3 py-2"><label className="inline-flex cursor-pointer items-center gap-2 font-black"><input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="h-5 w-5 accent-slate-700 disabled:cursor-not-allowed" />{checked ? 'OK' : 'PENDENTE'}</label></td>
                      </tr>
                    );
                  })}
                  {!filteredAuditoriaRows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Nenhum pacote.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      )}

      {reportOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-3" onMouseDown={() => setReportOpen(false)}>
          <div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto bg-white shadow-2xl" onMouseDown={event => event.stopPropagation()}>
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-4 py-3">
              <h2 className="text-lg font-black text-slate-950">Relatório geral</h2>
              <button type="button" onClick={() => setReportOpen(false)} className="flex h-8 w-8 items-center justify-center border border-slate-300 hover:bg-slate-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 p-4">
              <section>
                <div className="mb-2 text-xs font-black uppercase text-slate-500">Aduana</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
                  {[
                    ['Total', aduanaRows.length],
                    ['A+', aduanaAmais],
                    ['Faltantes', aduanaFaltantes],
                    ['Encontrados', totalEncontrados],
                    ['Pendentes', aduanaPendentes],
                    ['Em lista', totalEmLista],
                    ['Erros aloc.', errosAlocacao],
                    ['Sem vaga', unconfirmedAduana],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="border border-slate-300 p-3">
                      <div className="text-[9px] font-black uppercase text-slate-400">{label}</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-black uppercase text-slate-500">Vagas</div>
                <div className="overflow-auto border border-slate-300">
                  <table className="w-full min-w-[620px] text-xs">
                    <thead className="bg-slate-100"><tr>{['Vaga', 'A+', 'Faltantes', 'Encontrados', '%', 'Em lista'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2 text-left font-black">{head}</th>)}</tr></thead>
                    <tbody>
                      {heatmap.map(item => (
                        <tr key={`relatorio-${item.doca}`}>
                          <td className="border-b border-r border-slate-200 px-3 py-2 font-black">VAGA {item.doca}</td>
                          <td className="border-b border-r border-slate-200 px-3 py-2">{item.amais}</td>
                          <td className="border-b border-r border-slate-200 px-3 py-2">{item.faltantes}</td>
                          <td className="border-b border-r border-slate-200 px-3 py-2">{item.encontrados}/{item.total}</td>
                          <td className="border-b border-r border-slate-200 px-3 py-2 font-black">{item.percentual}%</td>
                          <td className="border-b border-slate-200 px-3 py-2">{item.emLista}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <div className="mb-2 text-xs font-black uppercase text-slate-500">Auditoria</div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    ['Total', auditoriaRows.length],
                    ['A+', auditoriaAmais],
                    ['Faltantes', auditoriaFaltantes],
                    ['OK', auditoriaOk],
                  ].map(([label, value]) => (
                    <div key={String(label)} className="border border-slate-300 p-3">
                      <div className="text-[9px] font-black uppercase text-slate-400">{label}</div>
                      <div className="mt-1 text-xl font-black text-slate-950">{value}</div>
                    </div>
                  ))}
                </div>
                {auditStreetStats.length > 0 && (
                  <div className="mt-2 overflow-auto border border-slate-300">
                    <table className="w-full min-w-[520px] text-xs">
                      <thead className="bg-slate-100"><tr>{['Rua', 'Total', 'A+', 'Faltantes', 'OK'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2 text-left font-black">{head}</th>)}</tr></thead>
                      <tbody>
                        {auditStreetStats.map(item => (
                          <tr key={`relatorio-rua-${item.rua}`}>
                            <td className="border-b border-r border-slate-200 px-3 py-2 font-black">RUA {item.rua}</td>
                            <td className="border-b border-r border-slate-200 px-3 py-2">{item.total}</td>
                            <td className="border-b border-r border-slate-200 px-3 py-2">{item.amais}</td>
                            <td className="border-b border-r border-slate-200 px-3 py-2">{item.faltantes}</td>
                            <td className="border-b border-slate-200 px-3 py-2">{item.ok}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
