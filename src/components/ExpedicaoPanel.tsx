import React, { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Clock, PackageCheck, Search, Trash2, Truck, UploadCloud } from 'lucide-react';
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

const stateColor = (state: string) => state === 'A mais'
  ? 'bg-red-100 text-red-800'
  : 'bg-amber-100 text-amber-800';

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
  return date.toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
};

function affectsDock(change: ExpedicaoDocaChange, doca: string) {
  return change.doca === doca || change.docaAnterior === doca;
}

function changeTone(change: ExpedicaoDocaChange) {
  if (change.tipo === 'nova_placa' || change.tipo === 'troca_placa') return 'border-blue-300 bg-blue-50 text-blue-900';
  if (change.tipo === 'erro_removido' || change.tipo === 'placa_removida') return 'border-emerald-300 bg-emerald-50 text-emerald-900';
  if (change.tipo === 'novo_erro') return 'border-red-300 bg-red-50 text-red-900';
  return 'border-amber-300 bg-amber-50 text-amber-900';
}

function dockTone(change?: ExpedicaoDocaChange) {
  if (!change) return 'border-slate-200 bg-white';
  if (change.tipo === 'nova_placa' || change.tipo === 'troca_placa') return 'border-blue-400 bg-blue-50';
  if (change.tipo === 'erro_removido' || change.tipo === 'placa_removida') return 'border-emerald-400 bg-emerald-50';
  if (change.tipo === 'novo_erro') return 'border-red-400 bg-red-50';
  return 'border-amber-400 bg-amber-50';
}

function occurrenceLabel(occurrence: TodayListOccurrence) {
  return [
    occurrence.listaNome,
    occurrence.grupoNome,
    occurrence.listaSaida,
  ].filter(Boolean).join(' • ');
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
      baseChanges = hasBaseline ? getBaseDockChanges(store.base, parsed, registradoEm) : [];
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
    if (!window.confirm('Zerar toda a expedição? Bases, localizados e históricos deste navegador serão removidos.')) return;
    await save(empty);
    setQuery('');
    setFilter('todos');
    setSelectedDoca(null);
    setBacklogById({});
    setBacklogError('');
    setReport(false);
  };

  const enriched = useMemo(() => enrichExpedicao(store), [store]);
  const dockHistory = store.historicoDoca || [];

  const faltanteIds = useMemo(
    () => enriched.filter(row => row.classificacao === 'Faltante').map(row => row.pacote).sort(),
    [enriched],
  );
  const faltanteKey = faltanteIds.join('|');

  useEffect(() => {
    let active = true;

    if (!ready || !faltanteIds.length) {
      setBacklogById({});
      setBacklogLoading(false);
      setBacklogError('');
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
        console.error('[Expedição] Falha ao verificar listas backlog:', error);
        setBacklogById({});
        setBacklogError('Não foi possível verificar as listas backlog agora.');
      })
      .finally(() => {
        if (active) setBacklogLoading(false);
      });

    return () => { active = false; };
  }, [ready, faltanteKey]);

  const counts = useMemo(() => ({
    amais: enriched.filter(row => row.classificacao === 'A mais').length,
    faltantes: enriched.filter(row => row.classificacao === 'Faltante').length,
    localizados: enriched.filter(row => Boolean(store.localizados?.[row.pacote])).length,
    semDoca: enriched.filter(row => !row.doca).length,
  }), [enriched, store.localizados]);

  const faltantesEmBacklog = useMemo(
    () => Object.values(backlogById).filter(occurrences => occurrences.length > 0).length,
    [backlogById],
  );

  const heatmap = useMemo(() => Array.from({ length: 20 }, (_, index) => {
    const doca = String(index + 1);
    const records = enriched.filter(row => row.doca === doca);
    const changes = dockHistory.filter(change => affectsDock(change, doca));
    const latest = changes[changes.length - 1];

    return {
      doca,
      amais: records.filter(row => row.classificacao === 'A mais').length,
      faltantes: records.filter(row => row.classificacao === 'Faltante').length,
      changes,
      latest,
    };
  }), [enriched, dockHistory]);

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return enriched.filter(row => (
      (filter === 'todos' || row.classificacao === filter)
      && (!selectedDoca || row.doca === selectedDoca)
      && `${row.pacote} ${row.rotaOtimizada} ${row.placa} ${row.onda}`.toLowerCase().includes(needle)
    ));
  }, [enriched, filter, selectedDoca, query]);

  const selectedDockItems = useMemo(
    () => selectedDoca ? enriched.filter(row => row.doca === selectedDoca) : [],
    [enriched, selectedDoca],
  );

  const selectedDockChanges = useMemo(
    () => selectedDoca
      ? (store.historicoDoca || []).filter(change => affectsDock(change, selectedDoca)).slice(-20).reverse()
      : [],
    [store.historicoDoca, selectedDoca],
  );

  const totalErrors = counts.amais + counts.faltantes;
  const pending = Math.max(0, totalErrors - counts.localizados);
  const recoveryRate = totalErrors ? Math.round((counts.localizados / totalErrors) * 100) : 0;
  const criticalDocks = [...heatmap]
    .sort((a, b) => (b.amais + b.faltantes) - (a.amais + a.faltantes))
    .slice(0, 3);

  const closeExpedicao = async () => {
    const closing = {
      id: `exp-${Date.now()}`,
      encerradoEm: new Date().toISOString(),
      amais: counts.amais,
      faltantes: counts.faltantes,
      localizados: counts.localizados,
      porDoca: heatmap.map(({ doca, amais, faltantes }) => ({ doca, amais, faltantes })),
    };
    await save({ ...store, encerramentos: [closing, ...(store.encerramentos || [])] });
    setReport(true);
  };

  if (!ready) return <div className="py-16 text-center text-sm text-slate-500">Carregando Expedição…</div>;

  const upload = (
    label: string,
    ref: RefObject<HTMLInputElement | null>,
    primary = false,
  ) => (
    <button
      type="button"
      onClick={() => ref.current?.click()}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2.5 text-xs font-black shadow-sm ${primary ? 'bg-[#253b80] text-white hover:bg-[#1f2464]' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}
    >
      <UploadCloud className="h-4 w-4" />
      {label}
    </button>
  );

  return (
    <div className="space-y-4 lg:-mx-8 xl:-mx-16 2xl:-mx-20">
      <input ref={baseInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'base')} />
      <input ref={aduanaInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'aduana')} />
      <input ref={auditInput} className="hidden" type="file" accept=".csv,text/csv" onChange={event => event.target.files?.[0] && importFile(event.target.files[0], 'auditoria')} />

      <section className="rounded-2xl border border-blue-200 bg-gradient-to-r from-white via-blue-50 to-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-center">
          <div>
            <div className="flex items-center gap-2 text-blue-700">
              <PackageCheck className="h-5 w-5" />
              <span className="text-xs font-bold uppercase tracking-wider">Expedição — Monitor por doca</span>
            </div>
            <h1 className="mt-1 text-3xl font-black tracking-tight text-[#102a67]">Mudanças e erros por doca</h1>
            <p className="mt-1 max-w-3xl text-sm text-slate-500">
              ID → placa da Aduana → placa na Base Despacho → doca, rota e onda. Cada novo CSV é comparado com o anterior.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 xl:max-w-[560px] xl:justify-end">
            {upload(store.base.length ? 'Atualizar Base Despacho' : 'Carregar Base Despacho', baseInput)}
            {upload('Atualizar Aduana', aduanaInput, true)}
            {upload('Atualizar Auditoria', auditInput, true)}
            <button onClick={resetExpedicao} className="inline-flex items-center gap-2 rounded-lg border border-red-300 bg-white px-3.5 py-2.5 text-xs font-black text-red-700 hover:bg-red-50">
              <Trash2 className="h-4 w-4" /> Zerar
            </button>
            <button onClick={closeExpedicao} disabled={!totalErrors} className="rounded-lg border border-amber-400 bg-[#ffd52f] px-3.5 py-2.5 text-xs font-black text-slate-950 disabled:cursor-not-allowed disabled:opacity-50">
              Encerrar
            </button>
          </div>
        </div>
      </section>

      {!store.base.length && (
        <section className="flex flex-col justify-between gap-3 rounded-xl border border-amber-400 bg-amber-50 p-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm font-black text-amber-950">Base Despacho ainda não carregada</p>
            <p className="text-xs text-amber-800">Sem ela o sistema conhece o erro, mas não consegue resolver a doca pela placa.</p>
          </div>
          {upload('Carregar Base Despacho', baseInput)}
        </section>
      )}

      {store.ultimaImportacao && (
        <section className="flex flex-col gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-blue-700" />
            <div>
              <p className="text-xs font-black uppercase text-blue-700">Última comparação</p>
              <p className="text-sm font-bold text-slate-900">
                {store.ultimaImportacao.arquivo} • {formatDateTime(store.ultimaImportacao.registradoEm)}
              </p>
            </div>
          </div>
          <div className="rounded-full bg-white px-3 py-1.5 text-xs font-black text-blue-800 shadow-sm">
            {store.ultimaImportacao.alteracoes === 0 ? 'Sem mudanças' : `${store.ultimaImportacao.alteracoes} mudanças`}
          </div>
        </section>
      )}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-red-300 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-600">A mais</p>
          <p className="mt-1 text-2xl font-black text-red-700">{counts.amais}</p>
        </div>
        <div className="rounded-xl border border-amber-300 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-600">Faltantes</p>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="text-2xl font-black text-amber-800">{counts.faltantes}</p>
            <span className="text-[10px] font-black text-slate-500">
              {backlogLoading ? 'verificando backlog…' : `${faltantesEmBacklog} em backlog`}
            </span>
          </div>
        </div>
        <div className="rounded-xl border border-emerald-300 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-600">Localizados</p>
          <p className="mt-1 text-2xl font-black text-emerald-700">{counts.localizados}</p>
        </div>
        <div className="rounded-xl border border-slate-300 bg-white p-4 shadow-sm">
          <p className="text-xs font-bold text-slate-600">Sem doca</p>
          <p className="mt-1 text-2xl font-black text-slate-700">{counts.semDoca}</p>
        </div>
      </div>

      {backlogError && (
        <div className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-900">{backlogError}</div>
      )}

      <section className="rounded-2xl border border-slate-300 bg-white p-3 shadow-sm sm:p-4">
        <div className="mb-3 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div>
            <h2 className="text-lg font-black text-black">Docas — 20 docas</h2>
            <p className="text-xs text-slate-600">Somente docas que tiveram mudança ficam coloridas. As demais permanecem neutras.</p>
          </div>
          {selectedDoca && (
            <button onClick={() => setSelectedDoca(null)} className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-black">
              Limpar seleção
            </button>
          )}
        </div>

        <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {heatmap.map(item => {
              const changed = item.changes.length > 0;
              const tone = dockTone(item.latest);
              const labelTone = changed ? 'text-red-700' : 'text-slate-500';
              const missingTone = changed ? 'text-amber-700' : 'text-slate-500';

              return (
                <button
                  key={item.doca}
                  onClick={() => setSelectedDoca(item.doca)}
                  className={`relative min-h-[105px] rounded-xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-md ${tone} ${selectedDoca === item.doca ? 'ring-2 ring-slate-900' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-black text-slate-950">DOCA {item.doca}</span>
                    {changed && (
                      <span className="rounded-full bg-slate-900 px-2 py-1 text-[9px] font-black text-white">
                        MUDOU {formatTime(item.latest?.registradoEm)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2 border-t border-slate-200 pt-3 text-[10px]">
                    <span className={labelTone}>A MAIS<b className="mt-1 block text-xl text-slate-950">{item.amais}</b></span>
                    <span className={missingTone}>FALTANTE<b className="mt-1 block text-xl text-slate-950">{item.faltantes}</b></span>
                  </div>
                  {changed && item.latest && (
                    <div className="mt-2 line-clamp-2 rounded-md bg-white/80 px-2 py-1 text-[9px] font-bold text-slate-700">
                      {item.latest.mensagem}
                    </div>
                  )}
                </button>
              );
            })}
          </div>

          <aside className="h-fit max-h-[650px] overflow-y-auto rounded-xl border border-slate-300 bg-slate-50 p-4 xl:sticky xl:top-20">
            <div className="border-b border-slate-300 pb-3">
              <p className="text-xs font-black uppercase text-slate-500">Detalhes da doca</p>
              <h3 className="text-xl font-black text-black">{selectedDoca ? `DOCA ${selectedDoca}` : 'Selecione uma doca'}</h3>
            </div>

            {selectedDoca ? (
              <div className="mt-4 space-y-5">
                <div>
                  <p className="mb-2 text-[11px] font-black uppercase text-slate-500">Erros atuais</p>
                  <div className="space-y-2">
                    {selectedDockItems.length ? selectedDockItems.map(row => {
                      const recovered = Boolean(store.localizados?.[row.pacote]);
                      const status = recovered ? 'Recuperado' : row.classificacao;
                      const style = recovered
                        ? 'border-emerald-300 bg-emerald-50'
                        : row.classificacao === 'Faltante'
                          ? 'border-amber-300 bg-amber-50'
                          : 'border-red-300 bg-red-50';
                      const backlog = backlogById[row.pacote] || [];

                      return (
                        <label key={row.pacote} className={`block cursor-pointer rounded-lg border p-3 ${style}`}>
                          <span className="flex items-start gap-3">
                            <input type="checkbox" checked={recovered} onChange={() => toggleLocated(row.pacote)} className="mt-1 h-5 w-5 shrink-0 accent-emerald-600" />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center justify-between gap-2">
                                <b className="font-mono text-sm text-slate-950">{row.pacote}</b>
                                <strong className="rounded-full bg-white/80 px-2 py-1 text-[10px] uppercase">{status}</strong>
                              </span>
                              <span className="mt-1 block text-[10px] font-bold text-slate-500">
                                {row.placa || 'Sem placa'} • {row.rotaOtimizada || 'Sem rota'} • {row.onda || 'Sem onda'}
                              </span>
                            </span>
                          </span>

                          {row.classificacao === 'A mais' && (
                            <div className="mt-2 rounded-md border border-blue-200 bg-white/80 px-2.5 py-2 text-[10px] text-blue-900">
                              <b>Deveria estar:</b>{' '}
                              {row.rotaOtimizada && row.doca
                                ? `DOCA ${row.doca} • ${row.rotaOtimizada}${row.onda ? ` • ${row.onda}` : ''}`
                                : 'rota/doca não encontrada na Base Despacho para esta placa'}
                            </div>
                          )}

                          {row.classificacao === 'Faltante' && (
                            <div className={`mt-2 rounded-md border px-2.5 py-2 text-[10px] ${backlog.length ? 'border-emerald-300 bg-emerald-50 text-emerald-900' : 'border-slate-200 bg-white/80 text-slate-600'}`}>
                              <b>Backlog:</b>{' '}
                              {backlogLoading
                                ? 'verificando listas…'
                                : backlog.length
                                  ? backlog.slice(0, 3).map(occurrenceLabel).join(' | ')
                                  : 'ID não encontrado nas listas do dia'}
                              {backlog.length > 3 && <span> • +{backlog.length - 3} ocorrência(s)</span>}
                            </div>
                          )}
                        </label>
                      );
                    }) : <p className="rounded-lg bg-white p-4 text-center text-sm text-slate-500">Nenhum erro atual nesta doca.</p>}
                  </div>
                </div>

                <div>
                  <p className="mb-2 text-[11px] font-black uppercase text-slate-500">Histórico de mudanças</p>
                  <div className="space-y-2">
                    {selectedDockChanges.length ? selectedDockChanges.map(change => (
                      <div key={change.id} className={`rounded-lg border p-3 ${changeTone(change)}`}>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] font-black uppercase">{change.fonte}</span>
                          <span className="text-[10px] font-bold">{formatDateTime(change.registradoEm)}</span>
                        </div>
                        <p className="mt-1 text-xs font-black">{change.mensagem}</p>
                      </div>
                    )) : <p className="rounded-lg bg-white p-4 text-center text-xs text-slate-500">Nenhuma mudança registrada ainda.</p>}
                  </div>
                </div>
              </div>
            ) : (
              <p className="py-10 text-center text-sm text-slate-500">Clique em uma doca para ver erros atuais, destino esperado e backlog.</p>
            )}
          </aside>
        </div>
      </section>

      <section className="overflow-hidden rounded-xl border border-[#b7d9c2] bg-white shadow-sm">
        <div className="flex flex-col gap-3 border-b border-[#b7d9c2] bg-[#e2f3e7] p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2">
            {(['todos', 'A mais', 'Faltante'] as const).map(option => (
              <button
                key={option}
                onClick={() => setFilter(option)}
                className={`rounded-md border px-3 py-2 text-xs font-bold ${filter === option ? 'border-[#2f6d4f] bg-[#cdebd6] text-[#174b33]' : 'border-transparent bg-white text-slate-600'}`}
              >
                {option === 'todos' ? 'Todos os erros' : option}
              </button>
            ))}
            <span className="px-2 py-2 text-xs font-bold text-slate-500">{selectedDoca ? `Doca ${selectedDoca}` : 'Todas as docas'}</span>
          </div>
          <label className="relative">
            <Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Buscar ID, rota ou placa" className="h-9 rounded-md border border-[#a8c8b0] bg-white pl-9 pr-3 text-xs outline-none focus:border-[#2f6d4f]" />
          </label>
        </div>

        <div className="app-scroll-x">
          <table className="w-full min-w-[1160px] border-collapse text-center text-xs">
            <thead className="bg-[#f0f0f0] text-slate-950">
              <tr>
                {['ID', 'Origem', 'Placa', 'Rota Otimizada', 'Doca', 'Onda', 'Estado', 'Destino / Backlog', 'Localizado'].map(head => (
                  <th key={head} className="border-b-2 border-r border-[#8f9bad] px-3 py-3 font-black last:border-r-0">{head}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 1000).map(row => {
                const backlog = backlogById[row.pacote] || [];
                return (
                  <tr key={row.pacote} className="hover:bg-[#f7fbf8]">
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 font-mono font-bold">{row.pacote}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 font-bold capitalize text-blue-700">{row.origem}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 font-mono">{row.placa || '—'}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 font-semibold">{row.rotaOtimizada || 'Não localizada'}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 font-black">{row.doca || '—'}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2">{row.onda || '—'}</td>
                    <td className={`border-b border-r border-[#cbd5e1] px-3 py-2 font-black ${stateColor(row.classificacao)}`}>{row.classificacao}</td>
                    <td className="border-b border-r border-[#cbd5e1] px-3 py-2 text-left">
                      {row.classificacao === 'A mais' ? (
                        row.rotaOtimizada && row.doca
                          ? <span className="font-bold text-blue-800">DOCA {row.doca} • {row.rotaOtimizada}{row.onda ? ` • ${row.onda}` : ''}</span>
                          : <span className="text-slate-500">Destino não localizado</span>
                      ) : backlogLoading ? (
                        <span className="text-slate-500">Verificando backlog…</span>
                      ) : backlog.length ? (
                        <span className="font-bold text-emerald-700">{backlog.slice(0, 2).map(occurrenceLabel).join(' | ')}</span>
                      ) : (
                        <span className="text-slate-500">Não encontrado em lista do dia</span>
                      )}
                    </td>
                    <td className="border-b border-[#cbd5e1] px-3 py-2">
                      <input type="checkbox" checked={Boolean(store.localizados?.[row.pacote])} onChange={() => toggleLocated(row.pacote)} className="h-4 w-4 accent-emerald-600" />
                    </td>
                  </tr>
                );
              })}
              {!rows.length && (
                <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-slate-500">Nenhum erro encontrado com os filtros atuais.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {!!counts.semDoca && (
        <section className="rounded-xl border border-slate-300 bg-slate-50 p-4">
          <div className="flex items-start gap-3">
            <Truck className="mt-0.5 h-5 w-5 text-slate-700" />
            <div>
              <p className="text-sm font-black text-slate-900">{counts.semDoca} erro(s) sem doca localizada</p>
              <p className="text-xs text-slate-600">Isso ocorre quando a placa do pacote não existe na Base Despacho atual. Atualize a Base Despacho e o cruzamento será recalculado automaticamente.</p>
            </div>
          </div>
        </section>
      )}

      {report && (
        <section className="rounded-xl border border-black bg-[#fff7cc] p-4">
          <div className="grid gap-4 sm:grid-cols-4">
            <div><p className="text-xs font-bold text-slate-500">Pendentes</p><p className="text-2xl font-black">{pending}</p></div>
            <div><p className="text-xs font-bold text-slate-500">Recuperação</p><p className="text-2xl font-black">{recoveryRate}%</p></div>
            <div className="sm:col-span-2"><p className="text-xs font-bold text-slate-500">Docas críticas</p><p className="text-sm font-black">{criticalDocks.map(dock => `D${dock.doca}: ${dock.amais + dock.faltantes}`).join(' • ')}</p></div>
          </div>
        </section>
      )}
    </div>
  );
}
