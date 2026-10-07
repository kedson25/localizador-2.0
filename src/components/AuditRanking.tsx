import React, { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { ExpedicaoRow } from '../lib/expedicao';
import { normalizeRanking, type RankingEntry, type RankingSource } from '../lib/auditRanking';

export const AuditRanking = memo(function AuditRanking({ aduana, auditoria }: { aduana: ExpedicaoRow[]; auditoria: ExpedicaoRow[] }) {
  const [files, setFiles] = useState<Partial<Record<RankingSource, File>>>({});
  const [ranking, setRanking] = useState<RankingEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const workerRef = useRef<Worker | null>(null);
  useEffect(() => {
    const worker = new Worker(new URL('../lib/auditRanking.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    setBusy(true);
    setError('');
    worker.onmessage = ({ data }) => {
      setBusy(false);
      if (data.error) { setError(data.error); setRanking([]); }
      else { setRanking(data.ranking); setPage(0); }
    };
    worker.onerror = () => { setBusy(false); setError('Não foi possível processar os arquivos. Confira o formato CSV.'); };
    const compact = (rows: ExpedicaoRow[]) => rows.map(({ pacote, estado, detalhe, dataRegistro }) => ({ pacote, estado, detalhe, dataRegistro }));
    worker.postMessage({
      sources: { aduana: files.aduana ? [] : compact(aduana), auditoria: files.auditoria ? [] : compact(auditoria) },
      files: Object.entries(files).map(([source, file]) => ({ source, file })),
    });
    return () => { worker.terminate(); workerRef.current = null; };
  }, [aduana, auditoria, files]);
  const filtered = useMemo(() => ranking.filter(row => normalizeRanking(row.nome).includes(normalizeRanking(query))), [ranking, query]);
  const pages = Math.max(1, Math.ceil(filtered.length / 50));
  const currentPage = Math.min(page, pages - 1);
  const total = useMemo(() => ranking.reduce((sum, row) => sum + row.total, 0), [ranking]);
  return <section className="space-y-3 border border-slate-300 bg-white p-3 shadow-sm">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-sm font-black">Ranking de pacotes auditados como correto</h2><p className="text-xs text-slate-500">Maior para o menor • {total.toLocaleString('pt-BR')} pacotes • {ranking.length} responsáveis</p></div>
      <button type="button" className="border px-3 py-2 text-xs font-bold" onClick={() => setFiles({})}>Usar dados já carregados</button>
    </div>
    <div className="grid gap-3 sm:grid-cols-2">{(['aduana', 'auditoria'] as const).map(source => <label key={source} className="space-y-1 text-xs font-bold">
      <span className="block">{source === 'aduana' ? 'Docas / Aduana' : 'Auditoria'}: {files[source]?.name || 'dados já carregados'}</span>
      <input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="block w-full text-xs" onChange={event => { const file = event.target.files?.[0]; if (file) setFiles(current => ({ ...current, [source]: file })); event.target.value = ''; }} />
    </label>)}</div>
    <p className="text-xs text-slate-500">Cada arquivo substitui sua fonte no ranking. Conta uma vez cada Shipment ID por fonte, usando o estado da auditoria mais recente. O total soma Docas e Auditoria.</p>
    {busy ? <p role="status" className="text-sm">Processando ranking em segundo plano…</p> : error ? <p role="alert" className="text-sm text-red-700">{error}</p> : <>
      <input aria-label="Buscar responsável no ranking" placeholder="Buscar responsável…" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} className="w-full border px-3 py-2 text-sm sm:w-80" />
      <div className="overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-100"><tr>{['Posição', 'Responsável', 'Docas', 'Auditoria', 'Total correto'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead><tbody>
        {filtered.slice(currentPage * 50, (currentPage + 1) * 50).map(row => <tr key={normalizeRanking(row.nome)} className="border-t"><td className="p-2">{ranking.indexOf(row) + 1}º</td><td className="p-2 font-bold">{row.nome}</td><td className="p-2">{row.aduana.toLocaleString('pt-BR')}</td><td className="p-2">{row.auditoria.toLocaleString('pt-BR')}</td><td className="p-2 font-black text-emerald-700">{row.total.toLocaleString('pt-BR')}</td></tr>)}
      </tbody></table></div>
      {!filtered.length && <p className="text-xs text-slate-500">Nenhum pacote correto encontrado. Carregue os CSVs ou use os dados existentes.</p>}
      <div className="flex items-center gap-3 text-xs"><button type="button" disabled={!currentPage} onClick={() => setPage(currentPage - 1)} className="border px-3 py-2 disabled:opacity-40">Anterior</button><span>Página {currentPage + 1} de {pages}</span><button type="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)} className="border px-3 py-2 disabled:opacity-40">Próxima</button></div>
    </>}
  </section>;
});
