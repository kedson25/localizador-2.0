import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Download, FileSpreadsheet, UploadCloud } from 'lucide-react';

type Row = Record<string, string>;
type Result = { shipment: string; rotaOriginal: string; rotaBase: string; rotaOtimizada: string; valorUsd: number | null; status: string };
const key = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const get = (r: Row, ...names: string[]) => {
  const entry = Object.entries(r).find(([k]) => names.some(n => key(k) === key(n)));
  return String(entry?.[1] ?? '').trim();
};
const normalizeRoute = (value: string) => {
  const route = value.trim().toUpperCase();
  return route.replace(/^(.+_\d+)_\d+$/, '$1');
};
const usd = (value: string): number | null => {
  let s = value.replace(/[^\d,.-]/g, '');
  if (!s) return null;
  if (s.includes(',') && s.includes('.')) s = s.lastIndexOf(',') > s.lastIndexOf('.') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  else if (s.includes(',')) s = s.replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const parse = (text: string): Row[] => {
  const result = Papa.parse<Row>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy', delimiter: '' });
  if (result.errors.length && !result.data.length) throw new Error(result.errors[0].message);
  return result.data;
};
const csvCell = (value: string | number | null) => '"' + String(value ?? '').replace(/"/g, '""') + '"';
const download = (rows: Result[]) => {
  const header = ['Shipment', 'Rota original', 'Rota base', 'Rota otimizada', 'Valor USD', 'Status'];
  const data = rows.map(r => [r.shipment, r.rotaOriginal, r.rotaBase, r.rotaOtimizada, r.valorUsd, r.status]);
  const content = '\uFEFF' + [header, ...data].map(line => line.map(csvCell).join(';')).join('\r\n');
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a'); a.href = url; a.download = 'reports-bpp.csv'; a.click(); URL.revokeObjectURL(url);
};
export function ReportsBpp() {
  const [files, setFiles] = useState<{ bpp: Row[]; routes: Row[]; values: Row[] }>({ bpp: [], routes: [], values: [] });
  const [names, setNames] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const load = async (type: 'bpp' | 'routes' | 'values', file?: File) => {
    if (!file) return;
    try {
      const rows = parse(await file.text());
      const required = type === 'bpp' ? [['unit_id'], ['route_name']] : type === 'routes' ? [['ID Planejado'], ['ID Otimizado']] : [['Shipment'], ['Valor usd']];
      if (required.some(group => !group.some(field => Object.keys(rows[0] || {}).some(k => key(k) === key(field))))) throw new Error('Colunas obrigatórias não encontradas neste arquivo.');
      setFiles(prev => ({ ...prev, [type]: rows })); setNames(prev => ({ ...prev, [type]: file.name })); setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Falha ao importar CSV'); }
  };
  const results = useMemo(() => {
    const routes = new Map<string, string>();
    files.routes.forEach(r => { const planned = get(r, 'ID Planejado').toUpperCase(); if (planned) routes.set(planned, get(r, 'ID Otimizado')); });
    const values = new Map<string, number>();
    files.values.forEach(r => { const id = get(r, 'Shipment'); const n = usd(get(r, 'Valor usd')); if (id && n !== null) values.set(id, n); });
    return files.bpp.map(r => {
      const shipment = get(r, 'unit_id');
      const rotaOriginal = get(r, 'route_name');
      const rotaBase = normalizeRoute(rotaOriginal);
      const rotaOtimizada = routes.get(rotaBase) || '';
      const valorUsd = values.get(shipment) ?? null;
      const status = [!rotaOtimizada && 'Rota não encontrada', valorUsd === null && 'Valor não encontrado'].filter(Boolean).join(' / ') || 'OK';
      return { shipment, rotaOriginal, rotaBase, rotaOtimizada, valorUsd, status };
    });
  }, [files]);
  const filtered = useMemo(() => results.filter(r => [r.shipment, r.rotaOriginal, r.rotaBase, r.rotaOtimizada, r.status].some(s => s.toLowerCase().includes(search.toLowerCase()))), [results, search]);
  const money = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'USD' });
  const total = results.reduce((sum, r) => sum + (r.valorUsd ?? 0), 0);
  return <div className="space-y-5">
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="flex items-center gap-3"><FileSpreadsheet className="h-7 w-7 text-blue-600" /><div><h1 className="text-2xl font-black text-slate-900">Reports</h1><p className="text-sm text-slate-500">BPP • Cruzamento de rotas e valores USD</p></div></div></div>
    <div className="grid gap-3 md:grid-cols-3">{([['bpp','1. BPP CSV','unit_id + route_name'],['routes','2. Otimização','ID Planejado + ID Otimizado'],['values','3. Valores USD','Shipment + Valor usd']] as const).map(([type,title,subtitle]) => <label key={type} className="cursor-pointer rounded-xl border border-slate-200 bg-white p-5 shadow-sm hover:border-blue-400"><UploadCloud className="mb-3 h-6 w-6 text-blue-600"/><div className="font-bold text-slate-900">{title}</div><p className="mb-3 text-xs text-slate-500">{subtitle}</p><span className="break-all text-xs font-semibold text-blue-600">{names[type] || 'Selecionar CSV'}</span><input className="sr-only" type="file" accept=".csv,.txt,text/csv,text/plain" onChange={e => void load(type,e.target.files?.[0])}/></label>)}</div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    <div className="grid gap-3 sm:grid-cols-3">{[['Shipments',results.length.toLocaleString('pt-BR')],['Rotas otimizadas',results.filter(r => r.rotaOtimizada).length.toLocaleString('pt-BR')],['Valor total encontrado',money(total)]].map(([title,value]) => <div key={title} className="rounded-xl border border-slate-200 bg-white p-4"><p className="text-xs text-slate-500">{title}</p><p className="mt-1 text-xl font-black text-slate-900">{value}</p></div>)}</div>
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm"><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><input className="w-full max-w-sm rounded-lg border border-slate-300 px-3 py-2 text-sm" placeholder="Pesquisar Shipment, rota ou status" value={search} onChange={e => setSearch(e.target.value)}/><button disabled={!filtered.length} onClick={() => download(filtered)} className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white disabled:opacity-40"><Download className="h-4 w-4"/>Exportar CSV</button></div><div className="max-h-[560px] overflow-auto"><table className="w-full min-w-[780px] text-left text-sm"><thead className="sticky top-0 bg-slate-100 text-xs uppercase text-slate-600"><tr>{['Shipment','Rota original','Rota base','Rota otimizada','Valor USD','Status'].map(h => <th key={h} className="px-3 py-3">{h}</th>)}</tr></thead><tbody>{filtered.slice(0,1000).map((r,i) => <tr key={i} className="border-t border-slate-100"><td className="px-3 py-2">{r.shipment}</td><td className="px-3 py-2">{r.rotaOriginal}</td><td className="px-3 py-2">{r.rotaBase}</td><td className="px-3 py-2 font-bold">{r.rotaOtimizada || '—'}</td><td className="px-3 py-2">{r.valorUsd === null ? '—' : money(r.valorUsd)}</td><td className="px-3 py-2 text-xs">{r.status}</td></tr>)}</tbody></table></div>{filtered.length > 1000 && <p className="mt-3 text-xs text-slate-500">Exibindo 1.000 linhas; a exportação inclui todos os resultados filtrados.</p>}</div>
  </div>;
}
