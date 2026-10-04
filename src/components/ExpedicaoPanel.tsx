import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { CheckCircle2, Clock, PackageCheck, Search, Trash2, UploadCloud } from 'lucide-react';
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
  base: [], aduana: [], auditoria: [], localizados: {}, historico: [], historicoDoca: [], ultimaComparacao: [], encerramentos: [],
};

function routeLabel(route: string) {
  return String(route || '').split('|')[0].trim();
}

function formatDateTime(value?: string) {
  if (!value) return '';
  const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (br) {
    const [, day, month, , hour = '0', minute = '0'] = br;
    return `${day.padStart(2, '0')}/${month.padStart(2, '0')}, ${hour.padStart(2, '0')}:${minute}`;
  }
  const timestamp = Date.parse(value);
  if (!Number.isNaN(timestamp)) return new Date(timestamp).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
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
        setStore({ ...empty, ...saved, localizados: saved.localizados || {}, historico: saved.historico || [], historicoDoca: saved.historicoDoca || [], ultimaComparacao: saved.ultimaComparacao || [] });
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
      const next: ExpedicaoStore = { ...store, updatedAt: registradoEm, filenames: { ...store.filenames, [source]: file.name } };
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
      setQuery('');
      setFilter('todos');
      setListaFilter('todos');
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

  // Na Aduana, buscamos TODOS os pacotes nas listas do dia, não apenas os Faltantes.
  const aduanaIdsKey = useMemo(() => aduanaRows.map(row => row.pacote).sort().join('|'), [aduanaRows]);
  useEffect(() => {
    let active = true;
    if (!hydrated) return () => { active = false; };
    const ids = aduanaIdsKey ? aduanaIdsKey.split('|') : [];
    if (!ids.length) { setBacklogById({}); setScreenReady(true); return () => { active = false; }; }
    setScreenReady(false);
    searchTodayListOccurrences(ids).then(found => {
      if (!active) return;
      const next: Record<string, TodayListOccurrence[]> = {};
      ids.forEach(pacote => { next[pacote] = found.get(pacote) || found.get(pacote.replace(/\D/g, '')) || []; });
      setBacklogById(next);
    }).catch(() => setBacklogById({})).finally(() => active && setScreenReady(true));
    return () => { active = false; };
  }, [hydrated, aduanaIdsKey, store.updatedAt]);

  const isFound = (pacote: string) => Boolean(store.localizados?.[pacote]) || (backlogById[pacote]?.length || 0) > 0;

  const filteredAduanaRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return aduanaRows.filter(row => {
      const inList = (backlogById[row.pacote]?.length || 0) > 0;
      const found = Boolean(store.localizados?.[row.pacote]) || inList;
      const text = [row.pacote, row.classificacao, row.encontradoRota, row.encontradoPlaca, row.encontradoDoca, row.destinoRota, row.destinoDoca, row.destinoOnda].join(' ').toLowerCase();
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
      return text.includes(needle);
    });
  }, [auditoriaRows, query]);

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
      concluida: rows.length > 0 && encontrados === rows.length,
    };
  }), [aduanaRows, backlogById, store.localizados]);

  const unconfirmedAduana = useMemo(() => aduanaRows.filter(row => !row.localizacaoConfirmada).length, [aduanaRows]);
  const selectedDockRows = useMemo(() => selectedDoca ? aduanaRows.filter(row => row.vagaOperacional === selectedDoca) : [], [aduanaRows, selectedDoca]);
  const totalEmLista = useMemo(() => aduanaRows.filter(row => (backlogById[row.pacote]?.length || 0) > 0).length, [aduanaRows, backlogById]);
  const totalEncontrados = useMemo(() => aduanaRows.filter(row => isFound(row.pacote)).length, [aduanaRows, backlogById, store.localizados]);
  const totalPercentual = aduanaRows.length ? Math.round((totalEncontrados / aduanaRows.length) * 100) : 0;

  if (!hydrated || !remoteReady || !screenReady) return <ExpedicaoSkeleton />;

  const upload = (label: string, ref: RefObject<HTMLInputElement | null>) => (
    <button type="button" disabled={syncState !== 'synced'} onClick={() => ref.current?.click()} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
      <UploadCloud className="h-4 w-4" />{label}
    </button>
  );

  return (
    <div className="w-full space-y-3">
      <input ref={baseInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'base')} />
      <input ref={aduanaInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'aduana')} />
      <input ref={auditInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'auditoria')} />

      <section className="border border-slate-300 bg-white px-4 py-3 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <PackageCheck className="h-6 w-6 text-blue-700" />
            <div><p className="text-[10px] font-black uppercase text-blue-700">Expedição</p><h1 className="text-2xl font-black text-[#102a67]">Cruzamento operacional</h1></div>
          </div>
          <div className="flex flex-wrap gap-2">{upload('Despacho', baseInput)}{upload('Aduana', aduanaInput)}{upload('Auditoria', auditInput)}<button type="button" disabled={syncState !== 'synced'} onClick={reset} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-50"><Trash2 className="h-4 w-4" />Zerar</button></div>
        </div>
        <div className="mt-3 flex gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={() => { setTab('aduana'); setSelectedDoca(null); setFilter('todos'); setListaFilter('todos'); }} className={`px-4 py-2 text-sm font-black ${tab === 'aduana' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}>Aduana • vagas</button>
          <button type="button" onClick={() => { setTab('auditoria'); setSelectedDoca(null); setFilter('todos'); setListaFilter('todos'); }} className={`px-4 py-2 text-sm font-black ${tab === 'auditoria' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}>Auditoria • pacotes</button>
        </div>
      </section>

      {store.ultimaImportacao && <div className="flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600"><Clock className="h-4 w-4 text-blue-700" />{store.ultimaImportacao.arquivo} • {formatDateTime(store.ultimaImportacao.registradoEm)}</div>}
      {error && <div className="border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900">{error}</div>}

      {tab === 'aduana' ? (
        <>
          <section className="border border-slate-300 bg-white p-3 shadow-sm">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <div><h2 className="text-lg font-black">Aduana — 20 vagas</h2><p className="text-xs text-slate-500">Encontrados = marcado no check list ou localizado em alguma lista do dia.</p></div>
              <div className="flex flex-wrap gap-2 text-[10px] font-black">
                <span className="border border-slate-300 bg-slate-50 px-3 py-1.5">EM LISTA HOJE: {totalEmLista}</span>
                <span className="border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-emerald-800">ENCONTRADOS: {totalEncontrados}/{aduanaRows.length} • {totalPercentual}%</span>
                {unconfirmedAduana > 0 && <span className="border border-amber-300 bg-amber-50 px-3 py-1.5 text-amber-800">SEM VAGA: {unconfirmedAduana}</span>}
              </div>
            </div>

            <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_390px] xl:items-start">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
                {heatmap.map(item => <button key={item.doca} type="button" onClick={() => setSelectedDoca(selectedDoca === item.doca ? null : item.doca)} className={`min-h-[128px] border p-3 text-left transition ${item.concluida ? 'border-slate-400 bg-slate-200 text-slate-700' : 'border-slate-300 bg-white'} ${selectedDoca === item.doca ? 'ring-2 ring-slate-900' : ''}`}>
                  <div className="flex items-center justify-between gap-2"><span className="font-black">VAGA {item.doca}</span><span className="text-sm font-black">{item.percentual}%</span></div>
                  <div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span>A+ <b className="text-red-600">{item.amais}</b></span><span>Falt. <b className="text-amber-700">{item.faltantes}</b></span></div>
                  <div className="mt-2 text-[10px] font-bold text-slate-600">{item.encontrados}/{item.total} encontrados</div>
                  <div className="mt-0.5 text-[9px] font-bold text-slate-400">{item.emLista} em lista do dia</div>
                  <div className="mt-2 h-1.5 overflow-hidden bg-slate-200"><div className="h-full bg-slate-700 transition-all" style={{ width: `${item.percentual}%` }} /></div>
                </button>)}
              </div>

              <aside className="h-[610px] overflow-y-auto border border-slate-300 bg-slate-50 xl:sticky xl:top-20">
                <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-300 bg-white px-3 py-2.5">
                  <div><div className="text-[10px] font-black uppercase tracking-wide text-blue-700">Check list</div><h3 className="font-black text-slate-950">{selectedDoca ? `VAGA ${selectedDoca}` : 'Selecione uma vaga'}</h3></div>
                  {selectedDoca && <span className="text-[10px] font-black text-slate-500">{selectedDockRows.length} itens</span>}
                </div>
                {!selectedDoca ? <p className="px-4 py-10 text-center text-sm text-slate-500">Clique em uma vaga para abrir o check list lateral.</p> : selectedDockRows.length ? (
                  <div className="divide-y divide-slate-200">
                    {selectedDockRows.map(row => {
                      const checked = Boolean(store.localizados?.[row.pacote]);
                      const backlog = backlogById[row.pacote] || [];
                      const found = checked || backlog.length > 0;
                      return <label key={row.pacote} className={`block cursor-pointer p-3 ${found ? 'bg-slate-200' : 'bg-white'}`}>
                        <span className="flex items-start gap-3">
                          <input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="mt-1 h-5 w-5 shrink-0 accent-slate-800 disabled:cursor-not-allowed" />
                          <span className="min-w-0 flex-1">
                            <span className="flex items-start justify-between gap-2"><b className="font-mono text-sm">{row.pacote}</b><span className={`text-[9px] font-black uppercase ${row.classificacao === 'A mais' ? 'text-red-600' : 'text-amber-700'}`}>{row.classificacao}</span></span>
                            <span className="mt-1 block text-[10px] text-slate-600"><b>Aqui:</b> VAGA {row.encontradoDoca}{routeLabel(row.encontradoRota) ? ` • ${routeLabel(row.encontradoRota)}` : ''}</span>
                            <span className="mt-1 block text-[10px] text-slate-600"><b>Deveria:</b> {row.destinoConfirmado ? `VAGA ${row.destinoDoca}${row.destinoRota ? ` • ${row.destinoRota}` : ''}` : 'sem destino no Despacho'}</span>
                            {backlog.length > 0 && <span className="mt-1 block text-[10px] font-black text-emerald-700"><CheckCircle2 className="mr-1 inline h-3 w-3" />EM LISTA • {occurrenceLabel(backlog[0])}</span>}
                          </span>
                        </span>
                      </label>;
                    })}
                  </div>
                ) : <p className="px-4 py-10 text-center text-sm text-slate-500">Nenhum pacote confirmado nesta vaga.</p>}
              </aside>
            </div>
          </section>

          <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
            <div className="border-b border-slate-200 p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <div className="flex gap-1.5">{(['todos', 'A mais', 'Faltante'] as const).map(option => <button key={option} type="button" onClick={() => setFilter(option)} className={`border px-3 py-2 text-xs font-black ${filter === option ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>{option === 'todos' ? 'Todos' : option}</button>)}</div>
                <select value={listaFilter} onChange={event => setListaFilter(event.target.value as ListaFilter)} className="h-9 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700">
                  <option value="todos">Lista: todos</option>
                  <option value="em-lista">Em lista do dia</option>
                  <option value="fora-lista">Fora das listas</option>
                  <option value="encontrados">Encontrados</option>
                  <option value="pendentes">Pendentes</option>
                </select>
                {selectedDoca && <button type="button" onClick={() => setSelectedDoca(null)} className="h-9 border border-slate-300 bg-white px-3 text-xs font-black text-slate-600">Todas as vagas</button>}
                <label className="relative ml-auto w-full sm:w-[320px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, rota, placa ou vaga" className="h-9 w-full border border-slate-300 pl-9 pr-3 text-xs" /></label>
              </div>
              <div className="mt-2 text-[10px] font-bold text-slate-500">{filteredAduanaRows.length} resultado(s)</div>
            </div>
            <div className="max-h-[650px] overflow-auto">
              <table className="w-full min-w-[1050px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-100"><tr>{['ID', 'Tipo', 'Encontrado', 'Deveria estar', 'Lista do dia', 'Status', 'OK'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black">{head}</th>)}</tr></thead>
                <tbody>
                  {filteredAduanaRows.map(row => {
                    const backlog = backlogById[row.pacote] || [];
                    const checked = Boolean(store.localizados?.[row.pacote]);
                    const found = checked || backlog.length > 0;
                    return <tr key={`aduana-${row.pacote}`} className={found ? 'bg-slate-50' : 'hover:bg-slate-50'}>
                      <td className="border-b border-r border-slate-200 px-3 py-2 font-mono font-black">{row.pacote}<div className="font-sans text-[9px] text-slate-400">{formatDateTime(row.dataRegistro)}</div></td>
                      <td className="border-b border-r border-slate-200 px-3 py-2 font-black">{row.classificacao}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2"><b>{row.encontradoDoca ? `VAGA ${row.encontradoDoca}` : 'VAGA NÃO LOCALIZADA'}</b><div className="text-[10px] text-slate-500">{routeLabel(row.encontradoRota) || 'sem rota'}{row.encontradoPlaca ? ` • ${row.encontradoPlaca}` : ''}</div></td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{row.destinoConfirmado ? <><b>VAGA {row.destinoDoca}</b><div className="text-[10px] text-slate-500">{row.destinoRota || 'sem rota'}{row.destinoOnda ? ` • ${row.destinoOnda}` : ''}</div></> : <b className="text-amber-700">SEM DESTINO</b>}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2">{backlog.length ? <><b className="text-emerald-700">EM LISTA</b><div className="text-[10px] text-slate-500">{occurrenceLabel(backlog[0])}{backlog.length > 1 ? ` • +${backlog.length - 1}` : ''}</div></> : <span className="text-slate-400">Não encontrado hoje</span>}</td>
                      <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`font-black ${found ? 'text-emerald-700' : 'text-amber-700'}`}>{found ? 'ENCONTRADO' : 'PENDENTE'}</span></td>
                      <td className="border-b border-slate-200 px-3 py-2 text-center"><input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="h-4 w-4 accent-slate-700 disabled:cursor-not-allowed" /></td>
                    </tr>;
                  })}
                  {!filteredAduanaRows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-500">Nenhum item.</td></tr>}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : (
        <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-2.5">
            <div><h2 className="text-lg font-black">Auditoria — lista de pacotes</h2><p className="text-xs text-slate-500">Somente pacotes e check list.</p></div>
            <label className="relative w-full sm:w-[320px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar ID ou Contenedor" className="h-9 w-full border border-slate-300 pl-9 pr-3 text-xs" /></label>
          </div>
          <div className="max-h-[700px] overflow-auto">
            <table className="w-full min-w-[640px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-100"><tr>{['Pacote', 'Encontrado em', 'Tipo', 'Check list'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2.5 text-left font-black">{head}</th>)}</tr></thead>
              <tbody>
                {filteredAuditoriaRows.map(row => {
                  const checked = Boolean(store.localizados?.[row.pacote]);
                  return <tr key={`auditoria-${row.pacote}`} className={checked ? 'bg-slate-100 text-slate-500' : 'hover:bg-slate-50'}>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-mono font-black">{row.pacote}<div className="font-sans text-[9px] text-slate-400">{formatDateTime(row.dataRegistro)}</div></td>
                    <td className="border-b border-r border-slate-200 px-3 py-2 font-black">{routeLabel(row.encontradoRota) || 'SEM CONTENEDOR'}</td>
                    <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`font-black ${row.classificacao === 'A mais' ? 'text-red-600' : 'text-amber-700'}`}>{row.classificacao}</span></td>
                    <td className="border-b border-slate-200 px-3 py-2"><label className="inline-flex cursor-pointer items-center gap-2 font-black"><input type="checkbox" disabled={syncState !== 'synced'} checked={checked} onChange={() => toggleLocated(row.pacote)} className="h-5 w-5 accent-slate-700 disabled:cursor-not-allowed" />{checked ? 'OK' : 'PENDENTE'}</label></td>
                  </tr>;
                })}
                {!filteredAuditoriaRows.length && <tr><td colSpan={4} className="px-4 py-10 text-center text-slate-500">Nenhum pacote.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
