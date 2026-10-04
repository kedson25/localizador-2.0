import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Clock, MapPin, PackageCheck, Search, Trash2, UploadCloud } from 'lucide-react';
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

const empty: ExpedicaoStore = {
  base: [], aduana: [], auditoria: [], localizados: {}, historico: [], historicoDoca: [], ultimaComparacao: [], encerramentos: [],
};

function routeLabel(route: string) {
  return String(route || '').split('|')[0].trim();
}

function formatDateTime(value?: string) {
  if (!value) return '';
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
  const [screenReady, setScreenReady] = useState(false);
  const [tab, setTab] = useState<ViewTab>('aduana');
  const [filter, setFilter] = useState<TipoFilter>('todos');
  const [query, setQuery] = useState('');
  const [selectedDoca, setSelectedDoca] = useState<string | null>(null);
  const [error, setError] = useState('');
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
    }, syncError => {
      console.error(syncError);
      setError('Sincronização em tempo real indisponível.');
    });
  }, [hydrated]);

  const save = async (next: ExpedicaoStore) => {
    setStore(next);
    await setLocalValue(STORAGE_KEY, next);
  };

  const importFile = async (file: File, source: FonteImportacaoExpedicao) => {
    setScreenReady(false);
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
      await save(next);
      await syncExpedicaoImport(next, source);
    } catch (cause) {
      console.error('[Expedição] falha:', cause);
      setError('Falha ao processar ou sincronizar o arquivo.');
    } finally {
      setScreenReady(true);
    }
  };

  const reset = async () => {
    if (!window.confirm('Zerar a Expedição para todos os usuários?')) return;
    const next = { ...empty, updatedAt: new Date().toISOString() };
    await save(next);
    await resetExpedicaoShared();
    setSelectedDoca(null);
    setQuery('');
    setFilter('todos');
  };

  const toggleLocated = async (pacote: string) => {
    const value = !store.localizados?.[pacote];
    const next = { ...store, localizados: { ...store.localizados, [pacote]: value } };
    await save(next);
    await setExpedicaoSharedLocated(pacote, value);
  };

  const enriched = useMemo(() => enrichExpedicao(store), [store]);
  const aduanaRows = useMemo(() => enriched.filter(row => row.origem === 'aduana'), [enriched]);
  const auditoriaRows = useMemo(() => enriched.filter(row => row.origem === 'auditoria'), [enriched]);

  const faltantesKey = useMemo(() => enriched.filter(row => row.classificacao === 'Faltante').map(row => row.pacote).sort().join('|'), [enriched]);
  useEffect(() => {
    let active = true;
    if (!hydrated) return () => { active = false; };
    const ids = faltantesKey ? faltantesKey.split('|') : [];
    if (!ids.length) { setBacklogById({}); setScreenReady(true); return () => { active = false; }; }
    searchTodayListOccurrences(ids).then(found => {
      if (!active) return;
      const next: Record<string, TodayListOccurrence[]> = {};
      ids.forEach(pacote => { next[pacote] = found.get(pacote) || found.get(pacote.replace(/\D/g, '')) || []; });
      setBacklogById(next);
    }).catch(() => setBacklogById({})).finally(() => active && setScreenReady(true));
    return () => { active = false; };
  }, [hydrated, faltantesKey, store.updatedAt]);

  const currentRows = tab === 'aduana' ? aduanaRows : auditoriaRows;
  const filteredRows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return currentRows.filter(row => {
      const text = [row.pacote, row.classificacao, row.encontradoRota, row.encontradoPlaca, row.encontradoDoca, row.destinoRota, row.destinoDoca, row.destinoOnda].join(' ').toLowerCase();
      return (filter === 'todos' || row.classificacao === filter)
        && (!selectedDoca || tab !== 'aduana' || row.vagaOperacional === selectedDoca)
        && text.includes(needle);
    });
  }, [currentRows, filter, query, selectedDoca, tab]);

  const heatmap = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const doca = String(index + 1);
    const rows = aduanaRows.filter(row => row.vagaOperacional === doca);
    return {
      doca,
      amais: rows.filter(row => row.classificacao === 'A mais').length,
      faltantes: rows.filter(row => row.classificacao === 'Faltante').length,
      total: rows.length,
      confirmados: rows.filter(row => row.localizacaoConfirmada).length,
    };
  }), [aduanaRows]);

  const auditGroups = useMemo(() => {
    const grouped = new Map<string, typeof auditoriaRows>();
    auditoriaRows.forEach(row => {
      const group = routeLabel(row.encontradoRota) || 'SEM CONTENEDOR';
      const list = grouped.get(group) || [];
      list.push(row);
      grouped.set(group, list);
    });
    return [...grouped.entries()].sort((a, b) => a[0].localeCompare(b[0], 'pt-BR'));
  }, [auditoriaRows]);

  if (!hydrated || !screenReady) return <ExpedicaoSkeleton />;

  const upload = (label: string, ref: RefObject<HTMLInputElement | null>) => (
    <button type="button" onClick={() => ref.current?.click()} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black hover:bg-slate-50">
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
          <div className="flex flex-wrap gap-2">{upload('Despacho', baseInput)}{upload('Aduana', aduanaInput)}{upload('Auditoria', auditInput)}<button type="button" onClick={reset} className="inline-flex h-9 items-center gap-2 border border-slate-300 bg-white px-3 text-xs font-black text-red-700"><Trash2 className="h-4 w-4" />Zerar</button></div>
        </div>
        <div className="mt-3 flex gap-2 border-t border-slate-200 pt-3">
          <button type="button" onClick={() => { setTab('aduana'); setSelectedDoca(null); }} className={`px-4 py-2 text-sm font-black ${tab === 'aduana' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}>Aduana • vagas</button>
          <button type="button" onClick={() => { setTab('auditoria'); setSelectedDoca(null); }} className={`px-4 py-2 text-sm font-black ${tab === 'auditoria' ? 'bg-slate-900 text-white' : 'border border-slate-300 bg-white'}`}>Auditoria • ruas</button>
        </div>
      </section>

      {store.ultimaImportacao && <div className="flex items-center gap-2 border border-slate-300 bg-white px-3 py-2 text-xs font-bold"><Clock className="h-4 w-4 text-blue-700" />{store.ultimaImportacao.arquivo} • {formatDateTime(store.ultimaImportacao.registradoEm)}</div>}
      {error && <div className="border border-amber-300 bg-white px-3 py-2 text-xs font-bold text-amber-900">{error}</div>}

      {tab === 'aduana' ? (
        <section className="border border-slate-300 bg-white p-3 shadow-sm">
          <div className="mb-3"><h2 className="text-lg font-black">Aduana — 20 vagas</h2><p className="text-xs text-slate-500">A vaga encontrada só é exibida quando o cruzamento é único. Ambiguidade fica como não confirmada.</p></div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-5">
            {heatmap.map(item => <button key={item.doca} type="button" onClick={() => setSelectedDoca(selectedDoca === item.doca ? null : item.doca)} className={`min-h-[105px] border p-3 text-left ${selectedDoca === item.doca ? 'border-slate-900 ring-2 ring-slate-900' : 'border-slate-300'}`}><div className="font-black">VAGA {item.doca}</div><div className="mt-2 grid grid-cols-2 gap-2 text-xs"><span>A+ <b className="text-red-600">{item.amais}</b></span><span>Falt. <b className="text-amber-700">{item.faltantes}</b></span></div><div className="mt-2 text-[10px] text-slate-500">{item.confirmados}/{item.total} confirmados</div></button>)}
          </div>
        </section>
      ) : (
        <section className="border border-slate-300 bg-white p-3 shadow-sm">
          <div className="mb-3"><h2 className="text-lg font-black">Auditoria — ruas / Contenedores</h2><p className="text-xs text-slate-500">Aqui o local físico é o Contenedor informado pela Auditoria. Não transformamos rua em vaga.</p></div>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {auditGroups.slice(0, 100).map(([group, rows]) => <div key={group} className="border border-slate-300 p-3"><div className="flex items-center gap-2 font-black"><MapPin className="h-4 w-4 text-blue-700" />{group}</div><div className="mt-2 text-xs text-slate-600">{rows.length} pacote(s) • {rows.filter(row => row.classificacao === 'A mais').length} A+ • {rows.filter(row => row.classificacao === 'Faltante').length} falt.</div></div>)}
          </div>
        </section>
      )}

      <section className="overflow-hidden border border-slate-300 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 p-2.5">
          <div className="flex gap-1.5">{(['todos', 'A mais', 'Faltante'] as const).map(option => <button key={option} type="button" onClick={() => setFilter(option)} className={`border px-3 py-2 text-xs font-black ${filter === option ? 'bg-slate-900 text-white' : 'bg-white text-slate-600'}`}>{option === 'todos' ? 'Todos' : option}</button>)}</div>
          <label className="relative w-full sm:w-[320px]"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="ID, rota, placa ou vaga" className="h-9 w-full border border-slate-300 pl-9 pr-3 text-xs" /></label>
        </div>
        <div className="max-h-[650px] overflow-auto">
          <table className="w-full min-w-[950px] border-collapse text-xs">
            <thead className="sticky top-0 bg-slate-50"><tr>{['ID', 'Tipo', tab === 'aduana' ? 'Encontrado' : 'Rua / Contenedor', 'Destino correto', 'Precisão', 'OK'].map(head => <th key={head} className="border-b border-r border-slate-200 px-3 py-2 text-left font-black">{head}</th>)}</tr></thead>
            <tbody>
              {filteredRows.map(row => {
                const backlog = backlogById[row.pacote] || [];
                return <tr key={row.pacote} className="hover:bg-slate-50">
                  <td className="border-b border-r border-slate-200 px-3 py-2 font-mono font-black">{row.pacote}<div className="font-sans text-[9px] text-slate-400">{formatDateTime(row.dataRegistro)}</div></td>
                  <td className="border-b border-r border-slate-200 px-3 py-2 font-black">{row.classificacao}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2">{tab === 'aduana' ? <><b>{row.encontradoDoca ? `VAGA ${row.encontradoDoca}` : 'VAGA NÃO CONFIRMADA'}</b><div className="text-[10px] text-slate-500">{routeLabel(row.encontradoRota) || 'sem rota'}{row.encontradoPlaca ? ` • ${row.encontradoPlaca}` : ''}</div></> : <><b>{routeLabel(row.encontradoRota) || 'SEM CONTENEDOR'}</b><div className="text-[10px] text-slate-500">local informado pela Auditoria</div></>}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2">{row.destinoDoca && row.destinoRota ? <b>VAGA {row.destinoDoca} • {row.destinoRota}{row.destinoOnda ? ` • ${row.destinoOnda}` : ''}</b> : row.classificacao === 'Faltante' && backlog.length ? <span className="font-bold text-emerald-800">{occurrenceLabel(backlog[0])}</span> : <span className="text-slate-400">Sem destino no Despacho</span>}</td>
                  <td className="border-b border-r border-slate-200 px-3 py-2"><span className={`font-black ${row.localizacaoConfirmada ? 'text-emerald-700' : 'text-amber-700'}`}>{row.localizacaoConfirmada ? 'CONFIRMADO' : 'NÃO CONFIRMADO'}</span><div className="max-w-[280px] text-[10px] text-slate-500">{row.motivoLocalizacao}</div></td>
                  <td className="border-b border-slate-200 px-3 py-2 text-center"><input type="checkbox" checked={Boolean(store.localizados?.[row.pacote])} onChange={() => toggleLocated(row.pacote)} className="h-4 w-4 accent-slate-700" /></td>
                </tr>;
              })}
              {!filteredRows.length && <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Nenhum item.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
