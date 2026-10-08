import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { Download, FilePlus2, Plus, Trash2 } from 'lucide-react';

type Entry = { id: string; rota: string };
type Workspace = { key: string; name: string; fileName: string; rows: Entry[]; scans: string[] };
const STORAGE = 'ecooy_refugo_csv_workspaces_v1';

const normalize = (value: unknown) => String(value ?? '').trim().toUpperCase();
function parseFile(text: string): Entry[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.some(error => error.code === 'MissingQuotes')) throw new Error('CSV com aspas inválidas.');
  const lines = parsed.data.filter(row => row.some(cell => String(cell ?? '').trim()));
  if (!lines.length) throw new Error('Arquivo CSV vazio.');
  const header = lines[0].map(normalize);
  const idColumn = header.findIndex(cell => /^(ID|SHIPMENT ID|PACOTE|TRACKING ID|CODIGO|CÓDIGO)$/.test(cell));
  const routeColumn = header.findIndex(cell => /ROTA|CONTENEDOR|CONTAINER/.test(cell));
  const body = idColumn >= 0 ? lines.slice(1) : lines;
  const output = new Map<string, Entry>();
  body.forEach(line => {
    const id = normalize(line[idColumn >= 0 ? idColumn : 0]);
    const rota = String(line[routeColumn >= 0 ? routeColumn : 1] ?? '').trim();
    if (id) output.set(id, { id, rota });
  });
  if (!output.size) throw new Error('CSV sem IDs válidos.');
  return [...output.values()];
}
const read = (): Workspace[] => {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE) || '[]');
    if (!Array.isArray(value)) return [];
    return value.filter(item => item && typeof item.key === 'string' && Array.isArray(item.rows) && Array.isArray(item.scans));
  } catch { return []; }
};
const csvEscape = (value: string) => '"' + String(value).replace(/"/g, '""') + '"';

export function RefugoCsvWorkspaces() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>(read);
  const [selected, setSelected] = useState<string>(() => { try { return localStorage.getItem(STORAGE + ':selected') || ''; } catch { return ''; } });
  const [input, setInput] = useState('');
  const [error, setError] = useState('');
  const current = workspaces.find(item => item.key === selected) || workspaces[0];
  const matches = useMemo(() => new Map((current?.rows || []).map(row => [row.id, row])), [current]);
  const found = current?.scans.filter(id => matches.has(id)).length || 0;
  const notFound = (current?.scans.length || 0) - found;

  useEffect(() => {
    try { localStorage.setItem(STORAGE, JSON.stringify(workspaces)); } catch { setError('Espaço insuficiente neste navegador para salvar as bases. Exporte os resultados.'); }
  }, [workspaces]);
  useEffect(() => { try { localStorage.setItem(STORAGE + ':selected', current?.key || ''); } catch {} }, [current?.key]);

  const update = (fn: (workspace: Workspace) => Workspace) => {
    if (!current) return;
    setWorkspaces(prev => prev.map(item => item.key === current.key ? fn(item) : item));
  };
  const create = () => {
    const name = window.prompt('Nome da nova aba de Refugo:', `Refugo ${workspaces.length + 1}`)?.trim();
    if (!name) return;
    const key = crypto.randomUUID();
    setWorkspaces(prev => [...prev, { key, name, fileName: '', rows: [], scans: [] }]);
    setSelected(key); setInput(''); setError('');
  };
  const upload = async (file?: File) => {
    if (!file || !current) return;
    try {
      const parsed = parseFile(await file.text());
      if (current.rows.length && !window.confirm('Substituir o CSV desta aba? As leituras desta aba serão preservadas.')) return;
      update(item => ({ ...item, rows: parsed, fileName: file.name }));
      setError('');
    } catch (e) { setError(e instanceof Error ? e.message : 'Erro ao ler CSV.'); }
  };
  const scan = (e: React.FormEvent) => {
    e.preventDefault();
    const id = normalize(input);
    if (!id || !current) return;
    if (current.scans.includes(id)) { setError('Este ID já foi registrado nesta aba.'); setInput(''); return; }
    update(item => ({ ...item, scans: [id, ...item.scans] }));
    setError(matches.has(id) ? '' : 'ID não encontrado no CSV desta aba.');
    setInput('');
  };
  const exportCsv = () => {
    if (!current) return;
    const data = ['ID,ROTA,STATUS', ...current.scans.map(id => [csvEscape(id), csvEscape(matches.get(id)?.rota || ''), csvEscape(matches.has(id) ? 'ENCONTRADO' : 'NAO ENCONTRADO')].join(','))].join('\r\n');
    const blob = new Blob(['\uFEFF', data], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url; link.download = `refugo_${current.name.replace(/[^a-z0-9_-]/gi, '_')}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 60000);
  };
  return (
    <section className="space-y-3 rounded-lg border border-slate-300 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 className="text-base font-bold">Refugos separados por CSV</h2><p className="text-xs text-slate-500">Cada aba tem seu CSV e suas leituras, salvos somente neste navegador.</p></div>
        <button type="button" onClick={create} className="ecooy-action px-3 text-sm"><Plus size={16}/> Nova aba</button>
      </div>
      {workspaces.length === 0 ? <p className="rounded border border-dashed border-slate-300 p-5 text-sm text-slate-500">Crie uma aba para importar seu primeiro CSV independente.</p> : (
        <>
          <div className="flex gap-2 overflow-x-auto border-b border-slate-200 pb-2" role="tablist" aria-label="Bases independentes de Refugo">
            {workspaces.map(item => <button key={item.key} type="button" role="tab" aria-selected={current?.key === item.key} onClick={() => {setSelected(item.key);setError('');setInput('');}} className={`shrink-0 rounded-md border px-3 py-2 text-sm font-semibold ${current?.key === item.key ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 bg-white text-slate-600'}`}>{item.name}</button>)}
          </div>
          {current && <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <label className="ecooy-action cursor-pointer px-3 text-sm"><FilePlus2 size={16}/> {current.fileName ? 'Trocar CSV' : 'Carregar CSV'}<input type="file" accept=".csv,.txt,text/csv" className="sr-only" onChange={e=>{void upload(e.target.files?.[0]);e.target.value='';}} /></label>
              <span className="min-w-0 flex-1 truncate text-xs text-slate-500">{current.fileName || 'Nenhuma base carregada'}</span>
              <button className="ecooy-action px-3 text-xs" type="button" disabled={!current.scans.length} onClick={exportCsv}><Download size={14}/> Exportar</button>
              <button className="ecooy-action px-3 text-xs text-red-700" type="button" onClick={() => {if (!window.confirm(`Excluir a aba "${current.name}" e suas leituras locais?`)) return;setWorkspaces(prev=>prev.filter(x=>x.key!==current.key));setSelected('');}}><Trash2 size={14}/> Excluir aba</button>
            </div>
            <div className="grid grid-cols-3 gap-2 text-center text-xs">
              <div className="rounded border border-slate-200 p-3">Na base <b className="block text-lg">{current.rows.length}</b></div>
              <div className="rounded border border-slate-200 p-3">Encontrados <b className="block text-lg">{found}</b></div>
              <div className="rounded border border-slate-200 p-3">Sem correspondência <b className="block text-lg">{notFound}</b></div>
            </div>
            <form onSubmit={scan} className="flex gap-2"><input className="ecooy-control min-w-0 flex-1 px-3" value={input} onChange={e=>setInput(e.target.value)} placeholder="Bipar ou digitar ID nesta aba" aria-label="ID do pacote" disabled={!current.rows.length}/><button type="submit" className="rounded bg-slate-900 px-4 text-sm font-bold text-white disabled:opacity-50" disabled={!current.rows.length}>Registrar</button></form>
            {error && <p role="alert" className="text-xs font-semibold text-amber-700">{error}</p>}
            <div className="max-h-52 overflow-auto divide-y divide-slate-100">{current.scans.slice(0,100).map(id=><div key={id} className="flex justify-between gap-3 py-2 text-xs"><span className="truncate font-mono">{id}</span><span className={matches.has(id)?'font-bold text-emerald-700':'font-bold text-amber-700'}>{matches.get(id)?.rota || 'Não encontrado'}</span></div>)}</div>
          </div>}
        </>
      )}
    </section>
  );
}
