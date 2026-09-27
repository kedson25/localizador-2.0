import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { CheckCircle2, FileUp } from 'lucide-react';

type Baixa = { id: string; status: string };
const STORAGE_KEY = 'baixas_fluxo_report_v1';

function norm(value: unknown) {
  return String(value || '').trim().toUpperCase();
}

function parseBaixas(text: string): Baixa[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' }).data;
  if (!parsed.length) return [];
  const header = parsed[0].map(norm);
  const idIndex = header.findIndex(value => /(^ID$|PACOTE|PACKAGE|SHIPMENT|TRACKING)/.test(value));
  const statusIndex = header.findIndex(value => /STATUS|SITUACAO|SITUAÇÃO/.test(value));
  const data = idIndex >= 0 ? parsed.slice(1) : parsed;
  const ids = new Map<string, Baixa>();
  data.forEach(row => {
    const id = norm(row[idIndex >= 0 ? idIndex : 0]);
    const status = norm(row[statusIndex >= 0 ? statusIndex : 1]);
    if (id && (status.includes('ENTREG') || status.includes('EM ROTA') || status.includes('EM_ROTA'))) ids.set(id, { id, status });
  });
  return Array.from(ids.values());
}

export const BaixasPanel: React.FC = () => {
  const [fileName, setFileName] = useState('');
  const [items, setItems] = useState<Baixa[]>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); } catch { return []; }
  });
  const summary = useMemo(() => {
    const entregues = items.filter(item => item.status.includes('ENTREG')).length;
    const emRota = items.length - entregues;
    return { entregues, emRota, total: items.length, taxa: items.length ? Math.round((entregues / items.length) * 100) : 0 };
  }, [items]);

  const loadFile = async (file?: File) => {
    if (!file) return;
    const next = parseBaixas(await file.text());
    setItems(next); setFileName(file.name);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new Event('baixas-report-updated'));
  };

  return <div className="mx-auto max-w-4xl space-y-4">
    <section className="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center gap-3"><FileUp className="h-6 w-6 text-blue-600" /><div><h2 className="text-lg font-black text-gray-900">Baixas</h2><p className="text-xs text-gray-500">Importe CSV com IDs em status Entregue ou Em rota. O resultado alimenta a taxa de entrega dos Relatórios.</p></div></div>
      <input type="file" accept=".csv,.txt,text/csv" onChange={event => void loadFile(event.target.files?.[0])} className="mt-5 block w-full text-xs" />
      {fileName && <p className="mt-2 text-xs text-emerald-700">Arquivo processado: {fileName}</p>}
    </section>
    <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
      <Card label="Pacotes no fluxo" value={summary.total} />
      <Card label="Entregues" value={summary.entregues} />
      <Card label="Em rota" value={summary.emRota} />
      <Card label="Taxa de entrega" value={`${summary.taxa}%`} />
    </section>
    {items.length > 0 && <section className="rounded-xl border border-gray-200 bg-white p-4"><div className="mb-3 flex items-center gap-2 text-sm font-bold text-gray-800"><CheckCircle2 className="h-4 w-4 text-emerald-600" /> Últimas baixas importadas</div><div className="max-h-80 overflow-auto text-xs">{items.slice(0, 200).map(item => <div key={item.id} className="flex justify-between border-b border-gray-100 py-2"><span className="font-mono">{item.id}</span><span>{item.status}</span></div>)}</div></section>}
  </div>;
};

const Card: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm"><p className="text-[11px] font-semibold uppercase text-gray-400">{label}</p><p className="mt-2 text-2xl font-black text-gray-900">{value}</p></div>;
