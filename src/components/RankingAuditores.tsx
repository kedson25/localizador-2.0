import React, { useMemo, useState } from 'react';
import Papa from 'papaparse';
import { BarChart3, UploadCloud } from 'lucide-react';
import type { ExpedicaoRow } from '../lib/expedicao';
import { dateScore } from '../lib/expedicao';

type Source = 'aduana' | 'auditoria';
type AuditRecord = { id: string; auditor: string; status: string; rota: string; timestamp: string; source: Source };
type RankingRow = { auditor: string; total: number; corretos: number; amais: number; pendentes: number; rotas: number; pacotes: number };

const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const field = (row: Record<string, unknown>, ...names: string[]) => {
  const key = Object.keys(row).find(name => names.some(expected => normalize(name) === normalize(expected)));
  return key ? String(row[key] ?? '').trim() : '';
};
const route = (value: string) => value.split('|')[0].trim().toUpperCase();
const status = (value: string) => normalize(value).replace(/\s+/g, ' ');
const sourceName = (source: Source) => source === 'aduana' ? 'Aduana' : 'Auditoria';

function parseRankingCsv(text: string, source: Source): AuditRecord[] {
  const result = Papa.parse<Record<string, unknown>>(text.replace(/^\uFEFF/, ''), { header: true, skipEmptyLines: 'greedy' });
  if (result.errors.some(error => error.code === 'MissingQuotes')) throw new Error('CSV com aspas inválidas.');
  const headers = result.meta.fields || [];
  if (!headers.some(h => normalize(h) === 'shipment id') || !headers.some(h => normalize(h) === 'rep auditoria')) {
    throw new Error(sourceName(source) + ': é necessário ter as colunas Shipment ID e Rep auditoria.');
  }
  return result.data.map(row => ({
    id: field(row, 'Shipment ID', 'Shipment', 'ID'),
    auditor: field(row, 'Rep auditoria', 'Responsável'),
    status: field(row, 'Estado', 'Status'),
    rota: route(field(row, 'ID da rota', 'Contenedor', 'Rota')),
    timestamp: field(row, 'Data auditoria', 'Data da auditoria', 'Data'),
    source,
  })).filter(row => row.id && row.auditor);
}

function computeRanking(records: AuditRecord[]): RankingRow[] {
  // Cada pacote tem apenas um estado final por fonte. Uma rota conta uma vez por auditor.
  const latest = new Map<string, AuditRecord>();
  records.forEach(record => {
    const key = record.source + ':' + record.id;
    const previous = latest.get(key);
    if (!previous || dateScore(record.timestamp) >= dateScore(previous.timestamp)) latest.set(key, record);
  });
  const byAuditor = new Map<string, RankingRow & { routes: Set<string>; ids: Set<string> }>();
  latest.forEach(record => {
    const key = normalize(record.auditor).replace(/\s+/g, ' ');
    let item = byAuditor.get(key);
    if (!item) {
      item = { auditor: record.auditor, total: 0, corretos: 0, amais: 0, pendentes: 0, rotas: 0, pacotes: 0, routes: new Set(), ids: new Set() };
      byAuditor.set(key, item);
    }
    item.total++;
    item.ids.add(record.id);
    if (record.rota) item.routes.add(record.rota);
    const estado = status(record.status);
    if (estado === 'correto') item.corretos++;
    else if (estado === 'a mais' || estado === 'amais') item.amais++;
    else item.pendentes++;
  });
  return [...byAuditor.values()].map(({ routes, ids, ...item }) => ({ ...item, rotas: routes.size, pacotes: ids.size }))
    .sort((a, b) => b.corretos - a.corretos || b.rotas - a.rotas || b.total - a.total || a.auditor.localeCompare(b.auditor, 'pt-BR'));
}

export function RankingAuditores({ aduana, auditoria }: { aduana: ExpedicaoRow[]; auditoria: ExpedicaoRow[] }) {
  const [files, setFiles] = useState<Partial<Record<Source, File>>>({});
  const [ranking, setRanking] = useState<RankingRow[]>([]);
  const [summary, setSummary] = useState({ registros: 0, corretos: 0, rotas: 0, auditores: 0 });
  const [filter, setFilter] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [calculated, setCalculated] = useState(false);

  const calculate = async () => {
    setWorking(true);
    setError('');
    try {
      const fallback = (rows: ExpedicaoRow[], source: Source): AuditRecord[] => rows.map(row => ({
        id: row.pacote, auditor: field(row.raw || {}, 'Rep auditoria', 'Responsável') || row.detalhe,
        status: row.estado, rota: route(row.rotaInformada), timestamp: row.dataRegistro, source,
      })).filter(row => row.id && row.auditor);
      const combined: AuditRecord[] = [];
      for (const source of ['aduana', 'auditoria'] as const) {
        if (files[source]) combined.push(...parseRankingCsv(await files[source]!.text(), source));
        else combined.push(...fallback(source === 'aduana' ? aduana : auditoria, source));
      }
      if (!combined.length) throw new Error('Carregue ao menos um CSV de Aduana ou Auditoria.');
      const result = computeRanking(combined);
      setRanking(result);
      setSummary({
        registros: result.reduce((n, row) => n + row.total, 0),
        corretos: result.reduce((n, row) => n + row.corretos, 0),
        rotas: new Set(combined.map(row => row.rota).filter(Boolean)).size,
        auditores: result.length,
      });
      setCalculated(true);
    } catch (cause) {
      setCalculated(false);
      setError(cause instanceof Error ? cause.message : 'Erro ao calcular ranking.');
    } finally {
      setWorking(false);
    }
  };

  const visible = useMemo(() => ranking.filter(row => normalize(row.auditor).includes(normalize(filter))), [ranking, filter]);
  return (
    <div className="space-y-3">
      <section className="border border-slate-300 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><BarChart3 size={19} /><h2 className="text-lg font-black">Ranking de auditores</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['aduana', 'auditoria'] as const).map(source => (
            <label key={source} className="flex cursor-pointer items-center gap-3 border border-dashed border-slate-400 bg-slate-50 p-3 hover:bg-slate-100">
              <UploadCloud size={20} className="shrink-0" />
              <span className="min-w-0 flex-1 text-xs font-bold"><strong className="block text-sm">{sourceName(source)} CSV</strong><span className="block truncate text-slate-500">{files[source]?.name || 'Selecionar arquivo CSV (ou usar o já importado)'}</span></span>
              <input aria-label={'Importar CSV ' + sourceName(source)} className="sr-only" type="file" accept=".csv,text/csv" onChange={event => { const file = event.target.files?.[0]; if (file) { setFiles(old => ({ ...old, [source]: file })); setCalculated(false); } }} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={working} onClick={calculate} className="bg-slate-900 px-6 py-2.5 text-sm font-black text-white disabled:opacity-50">{working ? 'Calculando...' : 'Calcular ranking'}</button>
          <span className="text-xs text-slate-500">O cálculo não altera nem apaga o monitoramento existente.</span>
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
      </section>
      {calculated && <>
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([['Registros auditados', summary.registros], ['Corretos', summary.corretos], ['Rotas distintas', summary.rotas], ['Auditores', summary.auditores]] as const).map(([label, value]) => <div key={label} className="border border-slate-300 bg-white p-3"><div className="text-[10px] font-bold uppercase text-slate-500">{label}</div><div className="mt-1 text-2xl font-black">{value}</div></div>)}
        </section>
        <section className="overflow-hidden border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3"><h3 className="text-sm font-black">Produtividade por representante</h3><input className="w-full border border-slate-300 px-3 py-2 text-sm sm:w-64" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Pesquisar auditor" /></div>
          <div className="overflow-x-auto"><table className="w-full min-w-[680px] text-left text-xs">
            <thead className="bg-slate-100 text-slate-600"><tr>{['#', 'Rep auditoria', 'Corretos', 'Rotas auditadas', 'Total', 'A mais', 'Outros / pendentes'].map(label => <th key={label} className="px-3 py-3 font-black">{label}</th>)}</tr></thead>
            <tbody>{visible.map(row => <tr key={normalize(row.auditor)} className="border-t border-slate-200 hover:bg-slate-50"><td className="px-3 py-3 font-bold">{ranking.indexOf(row) + 1}</td><td className="px-3 py-3 font-black">{row.auditor}</td><td className="px-3 py-3 font-black text-emerald-700">{row.corretos}</td><td className="px-3 py-3 font-black">{row.rotas}</td><td className="px-3 py-3">{row.total}</td><td className="px-3 py-3">{row.amais}</td><td className="px-3 py-3">{row.pendentes}</td></tr>)}
              {!visible.length && <tr><td colSpan={7} className="p-8 text-center text-slate-500">Nenhum auditor encontrado.</td></tr>}
            </tbody>
          </table></div>
        </section>
        <p className="text-xs text-slate-500">Critério: um registro final por Shipment ID e por arquivo, usando Data auditoria. Rotas auditadas = quantidade de códigos de rota distintos por auditor (sem contar cada pacote da mesma rota como nova rota). A coluna Corretos considera apenas Estado = Correto.</p>
      </>}
    </div>
  );
}
