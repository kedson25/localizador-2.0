import React, { useEffect, useMemo, useState } from 'react';
import Papa from 'papaparse';
import { BarChart3, CheckCircle2, Download, Trash2, UploadCloud } from 'lucide-react';
import type { ExpedicaoRow } from '../lib/expedicao';
import { dateScore } from '../lib/expedicao';
import { deleteLocalValue, getLocalValue, setLocalValue } from '../lib/localPersistence';

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
const RANKING_STORAGE_KEY = 'docas-ranking-auditores-v2';
const FILE_STORAGE_KEY = 'docas-ranking-csvs-v1';
type SavedFile = { name: string; records: AuditRecord[] };
type SavedFiles = Partial<Record<Source, SavedFile>>;
type RankingSummary = { registros: number; corretos: number; rotas: number; auditores: number; amais: number; pendentes: number };
type SavedRanking = { version: 2; ranking: RankingRow[]; summary: RankingSummary; savedAt: string };
const emptySummary = (): RankingSummary => ({ registros: 0, corretos: 0, rotas: 0, auditores: 0, amais: 0, pendentes: 0 });
const readSavedRanking = (): SavedRanking | null => {
  try {
    const json = window.localStorage.getItem(RANKING_STORAGE_KEY);
    if (!json) return null;
    const value = JSON.parse(json) as SavedRanking;
    if (value.version !== 2 || !Array.isArray(value.ranking) || !value.summary) return null;
    return value;
  } catch { return null; }
};

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
    .sort((a, b) => b.total - a.total || b.rotas - a.rotas || b.corretos - a.corretos || a.auditor.localeCompare(b.auditor, 'pt-BR'));
}

export function RankingAuditores({ aduana, auditoria }: { aduana: ExpedicaoRow[]; auditoria: ExpedicaoRow[] }) {
  const [files, setFiles] = useState<SavedFiles>({});
  const [filesReady, setFilesReady] = useState(false);
  useEffect(() => {
    let mounted = true;
    getLocalValue<SavedFiles>(FILE_STORAGE_KEY).then(savedFiles => {
      if (mounted && savedFiles) setFiles(savedFiles);
    }).finally(() => { if (mounted) setFilesReady(true); });
    return () => { mounted = false; };
  }, []);
  const loadFile = async (source: Source, file: File) => {
    setWorking(true);
    setError('');
    try {
      const records = parseRankingCsv(await file.text(), source);
      if (!records.length) throw new Error('Arquivo CSV sem registros válidos.');
      const next = { ...files, [source]: { name: file.name, records } };
      await setLocalValue(FILE_STORAGE_KEY, next);
      setFiles(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao carregar arquivo.');
    } finally {
      setWorking(false);
    }
  };
  const [saved, setSaved] = useState<SavedRanking | null>(readSavedRanking);
  const ranking = saved?.ranking || [];
  const summary = saved?.summary || emptySummary();
  const [filter, setFilter] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const calculated = saved !== null;
  const resetRanking = async () => {
    if (!window.confirm('Zerar somente o ranking salvo? Os CSVs salvos no ranking serão apagados, mas o monitoramento de docas não será alterado.')) return;
    try {
      window.localStorage.removeItem(RANKING_STORAGE_KEY);
      await deleteLocalValue(FILE_STORAGE_KEY);
      setSaved(null);
      setFiles({});
      setFilter('');
      setError('');
    } catch {
      setError('Não foi possível zerar o ranking salvo neste navegador.');
    }
  };

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
        if (files[source]) combined.push(...files[source]!.records);
        else combined.push(...fallback(source === 'aduana' ? aduana : auditoria, source));
      }
      if (!combined.length) throw new Error('Carregue ao menos um CSV de Aduana ou Auditoria.');
      const result = computeRanking(combined);
      const nextSummary: RankingSummary = {
        registros: result.reduce((n, row) => n + row.total, 0),
        corretos: result.reduce((n, row) => n + row.corretos, 0),
        rotas: new Set(combined.map(row => row.rota).filter(Boolean)).size,
        auditores: result.length,
        amais: result.reduce((n, row) => n + row.amais, 0),
        pendentes: result.reduce((n, row) => n + row.pendentes, 0),
      };
      const next: SavedRanking = { version: 2, ranking: result, summary: nextSummary, savedAt: new Date().toISOString() };
      window.localStorage.setItem(RANKING_STORAGE_KEY, JSON.stringify(next));
      setSaved(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao calcular e salvar ranking.');
    } finally {
      setWorking(false);
    }
  };

  const downloadReport = () => {
    if (!ranking.length) return;
    const width = 1200;
    const rowHeight = 42;
    const rowsPerImage = 55;
    const fmt = (n: number) => n.toLocaleString('pt-BR');
    const ratio = (r: RankingRow) => r.rotas ? (r.total / r.rotas).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—';
    const stamp = saved?.savedAt ? new Date(saved.savedAt) : new Date();
    const reportDate = stamp.toLocaleDateString('pt-BR');
    for (let offset = 0; offset < ranking.length; offset += rowsPerImage) {
      const rows = ranking.slice(offset, offset + rowsPerImage);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = 325 + rows.length * rowHeight + 175;
      const ctx = canvas.getContext('2d');
      if (!ctx) { setError('Não foi possível gerar a imagem.'); return; }
      const rect = (x: number, y: number, w: number, h: number, color: string) => {
        ctx.fillStyle = color; ctx.fillRect(x, y, w, h);
      };
      const print = (text: string, x: number, y: number, font: string, color: string, maxWidth?: number) => {
        ctx.fillStyle = color; ctx.font = font;
        if (maxWidth) {
          let label = text;
          while (label.length > 1 && ctx.measureText(label).width > maxWidth) label = label.slice(0, -1);
          ctx.fillText(label.length < text.length ? label + '…' : label, x, y);
        } else ctx.fillText(text, x, y);
      };
      rect(0, 0, width, canvas.height, '#fff');
      rect(0, 0, width, 93, '#ffe600');
      print('MERCADO LIVRE', 45, 55, 'bold 38px Arial', '#0b111a');
      print('SSP21  •  MOOCA', 780, 55, 'bold 30px Arial', '#0b111a');
      rect(0, 93, width, 108, '#0d1117');
      print('ADUANA DO DIA  ' + reportDate, 45, 164, 'bold 53px Arial', '#fff');
      rect(0, 201, width, 124, '#ffe600');
      const stats = [
        ['PACOTES AUDITADOS', fmt(summary.registros)],
        ['ROTAS DISTINTAS', fmt(summary.rotas)],
        ['AUDITORES', fmt(summary.auditores)],
      ];
      stats.forEach(([label, value], i) => {
        const x = 36 + i * 392;
        rect(x, 214, 368, 96, '#fff5b8');
        print(label, x + 15, 241, 'bold 17px Arial', '#222');
        print(value, x + 15, 287, 'bold 38px Arial', '#0d1117');
      });
      const tableY = 325;
      const xs = [25, 125, 565, 760, 970, 1175];
      rect(25, tableY, 1150, 54, '#111820');
      ['RANK', 'COLABORADOR', 'ROTAS CONFERIDAS', 'PACOTES AUDITADOS', 'PACOTES / ROTA'].forEach((heading, i) => {
        print(heading, xs[i] + 10, tableY + 35, 'bold 18px Arial', '#fff', xs[i+1] - xs[i] - 18);
      });
      rows.forEach((row, i) => {
        const y = tableY + 54 + i * rowHeight;
        const position = offset + i + 1;
        rect(25, y, 1150, rowHeight, position <= 3 ? '#ffe34f' : i % 2 ? '#fff' : '#edf0f4');
        ctx.strokeStyle = '#cad1d9'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(25, y + rowHeight); ctx.lineTo(1175, y + rowHeight); ctx.stroke();
        print(position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : String(position), 42, y + 29, 'bold 22px Arial', '#111820');
        print(row.auditor, 137, y + 29, position <= 3 ? 'bold 21px Arial' : '19px Arial', '#111820', 417);
        print(fmt(row.rotas), 635, y + 29, 'bold 21px Arial', '#111820');
        print(fmt(row.total), 836, y + 29, 'bold 21px Arial', '#111820');
        print(ratio(row), 1040, y + 29, 'bold 20px Arial', '#111820');
      });
      ctx.strokeStyle = '#b9c1cb'; ctx.lineWidth = 1;
      xs.forEach(x => { ctx.beginPath(); ctx.moveTo(x, tableY); ctx.lineTo(x, tableY + 54 + rows.length * rowHeight); ctx.stroke(); });
      const bottom = tableY + 54 + rows.length * rowHeight + 14;
      rect(0, bottom, width, canvas.height - bottom, '#0d1117');
      rect(0, bottom, width, 8, '#ffe600');
      print('FOCO  •  DISCIPLINA  •  RESULTADO', 44, bottom + 52, 'bold 27px Arial', '#ffe600');
      print('Cada rota, cada pacote, cada colaborador faz a diferença!', 44, bottom + 80, '19px Arial', '#fff');
      print('SSP21  |  Página ' + (Math.floor(offset / rowsPerImage) + 1), 925, bottom + 81, 'bold 16px Arial', '#ffe600');
      const link = document.createElement('a');
      link.download = 'aduana-ranking-' + reportDate.replace(/\//g, '-') + '-parte-' + (Math.floor(offset / rowsPerImage) + 1) + '.png';
      link.href = canvas.toDataURL('image/png');
      link.click();
    }
  };

  const visible = useMemo(() => ranking.filter(row => normalize(row.auditor).includes(normalize(filter))), [ranking, filter]);
  return (
    <div className="space-y-3">
      <section className="border border-slate-300 bg-white p-4 shadow-sm">
        <div className="mb-4 flex items-center gap-2"><BarChart3 size={19} /><h2 className="text-lg font-black">Ranking de auditores</h2></div>
        <div className="grid gap-3 sm:grid-cols-2">
          {(['aduana', 'auditoria'] as const).map(source => (
            <label key={source} className={`flex cursor-pointer items-center gap-3 border-2 border-dashed p-3 transition-colors ${files[source] ? 'border-emerald-500 bg-emerald-50 text-emerald-900' : 'border-slate-400 bg-slate-50 hover:bg-slate-100'}`}>
              {files[source] ? <CheckCircle2 size={22} className="shrink-0 text-emerald-700" /> : <UploadCloud size={20} className="shrink-0" />}
              <span className="min-w-0 flex-1 text-xs font-bold"><strong className="block text-sm">{sourceName(source)} CSV</strong><span className="block truncate text-slate-500">{files[source] ? `✓ Carregado: ${files[source].name}` : 'Selecionar arquivo CSV (ou usar o já importado)'}</span></span>
              <input aria-label={'Importar CSV ' + sourceName(source)} className="sr-only" type="file" accept=".csv,text/csv" disabled={!filesReady || working} onChange={event => { const file = event.target.files?.[0]; if (file) void loadFile(source, file); event.target.value = ''; }} />
            </label>
          ))}
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" disabled={working || !filesReady} onClick={calculate} className="bg-slate-900 px-6 py-2.5 text-sm font-black text-white disabled:opacity-50">{working ? 'Calculando...' : 'Calcular ranking'}</button>
          <button type="button" onClick={resetRanking} disabled={!calculated || working} className="inline-flex items-center gap-2 border border-red-300 bg-white px-4 py-2.5 text-sm font-black text-red-700 disabled:cursor-not-allowed disabled:opacity-40"><Trash2 size={16} />Zerar ranking</button>
          <span className="text-xs text-slate-500">Ranking e arquivos CSV salvos neste navegador até você zerar. Calcular substitui apenas o resultado anterior.</span>
          {saved && <span className="text-xs font-semibold text-emerald-700">✓ Salvo em {new Date(saved.savedAt).toLocaleString('pt-BR')}</span>}
        </div>
        {error && <p role="alert" className="mt-3 text-sm font-bold text-red-700">{error}</p>}
      </section>
      {calculated && <>
        <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {([['PACOTES AUDITADOS', summary.registros], ['ROTAS AUDITADAS', summary.rotas], ['CORRETOS', summary.corretos], ['AUDITORES', summary.auditores]] as const).map(([label, value]) => <div key={label} className="border border-slate-300 bg-white p-4"><div className="text-xs font-black uppercase text-slate-600">{label}</div><div className="mt-2 text-4xl font-black text-slate-950">{value.toLocaleString('pt-BR')}</div></div>)}
        </section>
        <section className="overflow-hidden border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3"><div className="flex items-center gap-3"><h3 className="text-lg font-black">Ranking por pacotes auditados</h3><button type="button" onClick={downloadReport} className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-black text-white"><Download size={17} />Baixar reporte PNG</button></div><input className="w-full border border-slate-300 px-3 py-2 text-sm sm:w-64" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Pesquisar auditor" /></div>
          <div className="overflow-x-auto">
            <div className="bg-[#ffe600] px-5 py-4 text-[#111820]">
              <div className="text-sm font-black uppercase tracking-wide">Mercado Livre • SSP21 Mooca</div>
            </div>
            <div className="bg-[#10151d] px-5 py-4 text-2xl font-black text-white">
              ADUANA DO DIA {saved ? new Date(saved.savedAt).toLocaleDateString('pt-BR') : ''}
            </div>
            <table className="w-full min-w-[920px] table-fixed text-sm">
              <colgroup><col style={{ width: '9%' }} /><col style={{ width: '37%' }} /><col style={{ width: '18%' }} /><col style={{ width: '19%' }} /><col style={{ width: '17%' }} /></colgroup>
              <thead className="bg-[#111820] text-white">
                <tr>{['🏆 Ranking', 'Colaborador', 'Rotas conferidas', 'Pacotes auditados', 'Pacotes / rota'].map(label => <th key={label} className="border-r border-slate-500 px-3 py-4 text-center font-black last:border-r-0">{label}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(row => {
                  const position = ranking.indexOf(row) + 1;
                  return <tr key={normalize(row.auditor)} className={position <= 3 ? 'bg-[#ffe34f] font-black text-[#111820]' : position % 2 ? 'bg-[#eef1f5]' : 'bg-white'}>
                    <td className="border border-slate-300 px-3 py-2 text-center font-black">{position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : position}</td>
                    <td className="border border-slate-300 px-3 py-2 font-semibold">{row.auditor}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums">{row.rotas.toLocaleString('pt-BR')}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums">{row.total.toLocaleString('pt-BR')}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums">{row.rotas ? (row.total / row.rotas).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '—'}</td>
                  </tr>;
                })}
                {!visible.length && <tr><td colSpan={5} className="p-8 text-center text-slate-500">Nenhum auditor encontrado.</td></tr>}
              </tbody>
            </table>
            <div className="border-t-4 border-[#ffe600] bg-[#10151d] px-5 py-5 text-white">
              <strong className="text-lg text-[#ffe600]">FOCO • DISCIPLINA • RESULTADO</strong>
              <p className="mt-1 text-sm">Cada rota, cada pacote, cada colaborador faz a diferença!</p>
            </div>
          </div>
        </section>
        <p className="text-xs text-slate-500">Critério: um registro final por Shipment ID e por arquivo, usando Data auditoria. Rotas auditadas = cada código de rota é contado apenas uma vez por auditor, mesmo quando aparece nos arquivos de Aduana e Auditoria. O ranking é ordenado pelo TOTAL de pacotes auditados, incluindo Correto, A mais e demais estados. Corretos é uma métrica complementar.</p>
      </>}
    </div>
  );
}
