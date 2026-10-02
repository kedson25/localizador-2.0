import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileSpreadsheet, PackageCheck, RefreshCcw, Search, Trash2, UploadCloud } from 'lucide-react';
import { getLocalValue, setLocalValue } from '../lib/localPersistence';
import { enrichExpedicao, parseBaseDespacho, parseExpedicaoRows, type ExpedicaoStore, type FonteExpedicao } from '../lib/expedicao';

const STORAGE_KEY = 'expedicao-daily-v1';
const empty: ExpedicaoStore = { base: [], aduana: [], auditoria: [] };
type Tab = 'aduana' | 'auditoria';

export function ExpedicaoPanel() {
  const [store, setStore] = useState<ExpedicaoStore>(empty);
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>('aduana');
  const [query, setQuery] = useState('');
  const baseInput = useRef<HTMLInputElement>(null);
  const aduanaInput = useRef<HTMLInputElement>(null);
  const auditInput = useRef<HTMLInputElement>(null);

  useEffect(() => { getLocalValue<ExpedicaoStore>(STORAGE_KEY).then(saved => { if (saved) setStore(saved); setReady(true); }); }, []);
  const save = async (next: ExpedicaoStore) => { setStore(next); await setLocalValue(STORAGE_KEY, next); };
  const importFile = async (file: File, source: 'base' | FonteExpedicao) => {
    const text = await file.text();
    const next: ExpedicaoStore = { ...store, updatedAt: new Date().toISOString(), filenames: { ...store.filenames, [source]: file.name } };
    if (source === 'base') next.base = parseBaseDespacho(text);
    else next[source] = parseExpedicaoRows(text, source);
    await save(next);
  };
  const enriched = useMemo(() => enrichExpedicao(store), [store]);
  const rows = enriched.filter(row => row.origem === tab && `${row.pacote} ${row.rotaInformada} ${row.rotaOtimizada} ${row.placa} ${row.estado}`.toLowerCase().includes(query.trim().toLowerCase()));
  const counts = useMemo(() => ({ amais: enriched.filter(row => row.classificacao === 'A mais').length, faltantes: enriched.filter(row => row.classificacao === 'Faltante').length, ambos: enriched.filter(row => row.classificacao === 'Em ambos').length, vinculados: enriched.filter(row => row.rotaOtimizada || row.doca || row.placa).length }), [enriched]);
  if (!ready) return <div className="py-16 text-center text-sm text-slate-500">Carregando Expedição…</div>;
  const action = (label: string, ref: React.RefObject<HTMLInputElement | null>, active = false) => <button type="button" onClick={() => ref.current?.click()} className={`inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-xs font-black shadow-sm ${active ? 'bg-[#253b80] text-white hover:bg-[#1f2464]' : 'border border-slate-200 bg-white text-slate-700 hover:bg-slate-50'}`}><UploadCloud className="h-4 w-4" />{label}</button>;
  return <div className="space-y-5">
    <input ref={baseInput} className="hidden" type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && importFile(e.target.files[0], 'base')} />
    <input ref={aduanaInput} className="hidden" type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && importFile(e.target.files[0], 'aduana')} />
    <input ref={auditInput} className="hidden" type="file" accept=".csv,text/csv" onChange={e => e.target.files?.[0] && importFile(e.target.files[0], 'auditoria')} />
    <section className="rounded-2xl bg-[#253b80] p-5 text-white shadow-sm sm:p-6"><div className="flex flex-col justify-between gap-5 lg:flex-row lg:items-center"><div><div className="flex items-center gap-2 text-blue-100"><PackageCheck className="h-5 w-5" /><span className="text-xs font-bold uppercase tracking-wider">Operação diária</span></div><h1 className="mt-2 text-3xl font-black tracking-tight">Expedição</h1><p className="mt-1 max-w-2xl text-sm text-blue-100">Carregue primeiro a Base Despacho. Depois atualize Aduana e Auditoria quantas vezes precisar — rota otimizada, doca e placa são recalculadas automaticamente.</p></div><div className="flex flex-wrap gap-2">{action(store.base.length ? 'Atualizar Base Despacho' : '1. Carregar Base Despacho', baseInput, true)}{action('Carregar Aduana', aduanaInput)}{action('Carregar Auditoria', auditInput)}</div></div></section>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[['Base Despacho', store.base.length, 'rotas'], ['A mais', counts.amais, 'somente Aduana'], ['Faltantes', counts.faltantes, 'somente Auditoria'], ['Vinculados', counts.vinculados, 'com rota/doca/placa']].map(([label, count, note]) => <div key={String(label)} className="rounded-2xl border border-slate-100 bg-white p-4 shadow-sm"><p className="text-xs font-bold text-slate-500">{label}</p><p className="mt-1 text-2xl font-black text-slate-900">{count}</p><p className="mt-1 text-[11px] text-slate-400">{note}</p></div>)}</div>
    {!store.base.length && <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"><b>Próximo passo:</b> carregue a Base Despacho do dia para habilitar o preenchimento de rota, doca e placa.</div>}
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"><div className="flex flex-col gap-3 border-b border-slate-200 p-4 sm:flex-row sm:items-center sm:justify-between"><div className="flex gap-2"><button onClick={() => setTab('aduana')} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === 'aduana' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Aduana ({store.aduana.length})</button><button onClick={() => setTab('auditoria')} className={`rounded-lg px-3 py-2 text-xs font-bold ${tab === 'auditoria' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-600'}`}>Auditoria ({store.auditoria.length})</button></div><label className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-slate-400"/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Buscar pacote, rota ou placa" className="h-9 rounded-lg border border-slate-200 pl-9 pr-3 text-xs outline-none focus:border-blue-400"/></label></div><div className="app-scroll-x"><table className="w-full min-w-[850px] text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr>{['Pacote', 'Status', 'Classificação', 'Rota otimizada', 'Doca', 'Placa', 'Detalhe'].map(head => <th key={head} className="whitespace-nowrap px-4 py-3 font-bold">{head}</th>)}</tr></thead><tbody className="divide-y divide-slate-100">{rows.slice(0, 1000).map(row => <tr key={`${row.origem}-${row.pacote}`}><td className="px-4 py-3 font-mono font-bold text-slate-800">{row.pacote}</td><td className="px-4 py-3">{row.estado || '—'}</td><td className="px-4 py-3"><span className={`rounded-full px-2 py-1 text-[10px] font-black ${row.classificacao === 'A mais' ? 'bg-amber-100 text-amber-800' : row.classificacao === 'Faltante' ? 'bg-rose-100 text-rose-700' : 'bg-emerald-100 text-emerald-700'}`}>{row.classificacao}</span></td><td className="px-4 py-3 font-semibold">{row.rotaOtimizada || 'Não localizada'}</td><td className="px-4 py-3">{row.doca || '—'}</td><td className="px-4 py-3 font-mono">{row.placa || '—'}</td><td className="max-w-[240px] truncate px-4 py-3 text-slate-500" title={row.detalhe}>{row.detalhe || '—'}</td></tr>)}{!rows.length && <tr><td colSpan={7} className="px-4 py-12 text-center text-slate-400">Carregue o CSV de {tab === 'aduana' ? 'Aduana' : 'Auditoria'} para ver os pacotes.</td></tr>}</tbody></table></div>{rows.length > 1000 && <div className="border-t p-3 text-center text-xs text-slate-500">Mostrando os primeiros 1.000 resultados. Use a busca para filtrar.</div>}</section>
    {store.updatedAt && <div className="flex items-center justify-between text-[11px] text-slate-400"><span>Última atualização: {new Date(store.updatedAt).toLocaleString('pt-BR')}</span><button onClick={() => { if (window.confirm('Apagar somente os dados salvos de Expedição neste navegador?')) save(empty); }} className="inline-flex items-center gap-1 hover:text-rose-600"><Trash2 className="h-3.5 w-3.5"/>Limpar Expedição</button></div>}
  </div>;
}
