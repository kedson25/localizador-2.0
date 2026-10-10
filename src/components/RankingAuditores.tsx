import React, { useEffect, useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { BarChart3, CheckCircle2, Download, Trash2, UploadCloud } from 'lucide-react';
import type { ExpedicaoRow } from '../lib/expedicao';
import { dateScore } from '../lib/expedicao';
import { deleteLocalValue, getLocalValue, setLocalValue } from '../lib/localPersistence';

type Source = 'aduana' | 'auditoria';
type AuditRecord = { id: string; auditor: string; status: string; rota: string; timestamp: string; source: Source };
type RankingRow = { auditor: string; total: number; corretos: number; amais: number; faltantes: number; pendentes: number; rotas: number; pacotes: number };

const normalize = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const field = (row: Record<string, unknown>, ...names: string[]) => {
  const key = Object.keys(row).find(name => names.some(expected => normalize(name) === normalize(expected)));
  return key ? String(row[key] ?? '').trim() : '';
};
const route = (value: string) => value.split('|')[0].trim().toUpperCase();
const status = (value: string) => normalize(value).replace(/\s+/g, ' ');
const sourceName = (source: Source) => source === 'aduana' ? 'Aduana' : 'Auditoria';
const RANKING_STORAGE_KEY = 'docas-ranking-auditores-v3';
const FILE_STORAGE_KEY = 'docas-ranking-csvs-v1';
type SavedFile = { name: string; records: AuditRecord[] };
type SavedFiles = Partial<Record<Source, SavedFile>>;
type RankingSummary = { registros: number; corretos: number; rotas: number; auditores: number; amais: number; faltantes: number; pendentes: number };
type SavedRanking = { version: 3; ranking: RankingRow[]; summary: RankingSummary; savedAt: string };
const safeCount = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;
const formatCount = (value: unknown): string => safeCount(value).toLocaleString('pt-BR');
const emptySummary = (): RankingSummary => ({ registros: 0, corretos: 0, rotas: 0, auditores: 0, amais: 0, faltantes: 0, pendentes: 0 });
const readSavedRanking = (cycle: 'todos' | 'AM' | 'PM' | 'SD' = 'todos'): SavedRanking | null => {
  try {
    const json = window.localStorage.getItem(`${RANKING_STORAGE_KEY}:${cycle}`);
    if (!json) return null;
    const value = JSON.parse(json) as SavedRanking;
    if (value.version !== 3 || !Array.isArray(value.ranking) || !value.summary) return null;
    const summary = { ...emptySummary(), ...value.summary };
    for (const key of Object.keys(emptySummary()) as (keyof RankingSummary)[]) summary[key] = safeCount(summary[key]);
    const ranking = value.ranking.filter(row => row && typeof row.auditor === 'string').map(row => ({
      ...row,
      total: safeCount(row.total), rotas: safeCount(row.rotas), pacotes: safeCount(row.pacotes),
      corretos: safeCount(row.corretos), amais: safeCount(row.amais),
      faltantes: safeCount(row.faltantes), pendentes: safeCount(row.pendentes),
    }));
    return { ...value, summary, ranking };
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
      item = { auditor: record.auditor, total: 0, corretos: 0, amais: 0, faltantes: 0, pendentes: 0, rotas: 0, pacotes: 0, routes: new Set(), ids: new Set() };
      byAuditor.set(key, item);
    }
    item.total++;
    item.ids.add(record.id);
    if (record.rota) item.routes.add(record.rota);
    const estado = status(record.status);
    if (estado === 'correto') item.corretos++;
    else if (estado === 'a mais' || estado === 'amais') item.amais++;
    else if (estado === 'faltante' || estado === 'faltantes' || estado === 'a menos' || estado === 'amenos') item.faltantes++;
    else item.pendentes++;
  });
  return [...byAuditor.values()].map(({ routes, ids, ...item }) => ({ ...item, rotas: routes.size, pacotes: ids.size }))
    .sort((a, b) => b.total - a.total || b.rotas - a.rotas || b.corretos - a.corretos || a.auditor.localeCompare(b.auditor, 'pt-BR'));
}

export function RankingAuditores({ aduana, auditoria, cycle = 'todos' }: { aduana: ExpedicaoRow[]; auditoria: ExpedicaoRow[]; cycle?: 'todos' | 'AM' | 'PM' | 'SD' }) {
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
  const [saved, setSaved] = useState<SavedRanking | null>(() => readSavedRanking(cycle));
  useEffect(() => { setSaved(readSavedRanking(cycle)); }, [cycle]);
  const ranking = saved?.ranking || [];
  const summary = saved?.summary || emptySummary();
  const [filter, setFilter] = useState('');
  const [topMode, setTopMode] = useState<'all' | 'top10'>('all');
  const [working, setWorking] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const downloadLock = useRef(false);
  const [error, setError] = useState('');
  const calculated = saved !== null;
  const resetRanking = async () => {
    if (!window.confirm('Zerar somente o ranking salvo? Os CSVs salvos no ranking serão apagados, mas o monitoramento de docas não será alterado.')) return;
    try {
      window.localStorage.removeItem(`${RANKING_STORAGE_KEY}:${cycle}`);
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
      const cycleRecords = cycle === 'todos' ? combined : combined.filter(row => row.rota.toUpperCase().split(/[^A-Z0-9]+/).some(token => token === cycle || (token.startsWith(cycle) && /^[0-9]+$/.test(token.slice(cycle.length)))));
      if (!cycleRecords.length) throw new Error(`Nenhum registro do ciclo ${cycle} encontrado nos CSVs.`);
      const result = computeRanking(cycleRecords);
      const nextSummary: RankingSummary = {
        registros: result.reduce((n, row) => n + row.total, 0),
        corretos: result.reduce((n, row) => n + row.corretos, 0),
        rotas: new Set(cycleRecords.map(row => row.rota).filter(Boolean)).size,
        auditores: result.length,
        amais: result.reduce((n, row) => n + row.amais, 0),
        faltantes: result.reduce((n, row) => n + row.faltantes, 0),
        pendentes: result.reduce((n, row) => n + row.pendentes, 0),
      };
      const next: SavedRanking = { version: 3, ranking: result, summary: nextSummary, savedAt: new Date().toISOString() };
      window.localStorage.setItem(`${RANKING_STORAGE_KEY}:${cycle}`, JSON.stringify(next));
      setSaved(next);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Erro ao calcular e salvar ranking.');
    } finally {
      setWorking(false);
    }
  };

  const downloadReport = async () => {
    if (downloadLock.current) return;
    downloadLock.current = true;
    setIsDownloading(true);
    setError('');
    try {
      // Permite ao React renderizar 'Baixando...' antes do canvas pesado.
      await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const loadPng = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Imagem não encontrada: ' + src));
      image.src = src;
    });
    let header: HTMLImageElement;
    let footer: HTMLImageElement;
    try {
      [header, footer] = await Promise.all([loadPng('/ranking-cabecalho.png'), loadPng('/ranking-rodape.png')]);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Falha nas imagens do reporte.');
      return;
    }
    const exportRows = ranking.filter(row => normalize(row.auditor).includes(normalize(filter)));
    const reportRows = topMode === 'top10' ? exportRows.slice(0, 10) : exportRows;
    if (!reportRows.length) { setError('Nenhum auditor para exportar.'); return; }
    const width = 2172;
    const scale = width / 1200;
    const bannerHeight = 544;
    const rowHeight = 42;
    const rowsPerImage = 55;
    const fmt = (n: number) => n.toLocaleString('pt-BR');
    const ratio = (r: RankingRow) => r.rotas ? Math.round(r.total / r.rotas).toLocaleString('pt-BR') : '—';
    const reportDate = new Date().toLocaleDateString('pt-BR');
    for (let offset = 0; offset < reportRows.length; offset += rowsPerImage) {
      const rows = reportRows.slice(offset, offset + rowsPerImage);
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = bannerHeight * 2 + Math.ceil((124 + 54 + rows.length * rowHeight) * scale);
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
      ctx.drawImage(header, 0, 0, width, bannerHeight);
      // Data gerada sobre o próprio cabeçalho, sem editar o PNG de origem.
      ctx.save();
      ctx.fillStyle = '#ffe600';
      ctx.fillRect(1690, 327, 435, 187);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#111820';
      ctx.font = 'bold 37px Arial';
      ctx.fillText('DATA:', 1907, 374);
      ctx.font = 'bold 63px Arial';
      ctx.fillText(reportDate, 1907, 453);
      ctx.restore();
      ctx.save();
      ctx.translate(0, bannerHeight);
      ctx.scale(scale, scale);
      rect(0, 0, 1200, 124, '#ffe600');

      const stats = [
        ['PACOTES AUDITADOS', summary.registros],
        ['ROTAS DISTINTAS', summary.rotas],
        ['AUDITORES', summary.auditores],
      ] as const;
      stats.forEach(([label, value], i) => {
        const x = 36 + i * 392;
        rect(x, 15, 368, 96, '#fff3b0');
        print(label, x + 15, 42, 'bold 17px Arial', '#222');
        print(value.toLocaleString('pt-BR'), x + 15, 88, 'bold 38px Arial', '#111820');
      });
      const tableY = 124;
      const xs = [25, 125, 565, 735, 930, 1175];
      rect(25, tableY, 1150, 54, '#111820');
      print('RANK', xs[0] + 10, tableY + 35, 'bold 18px Arial', '#fff');
      print('COLABORADOR', xs[1] + 10, tableY + 35, 'bold 18px Arial', '#fff');
      const centerHeader = (label: string, index: number) => {
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.font = 'bold 18px Arial';
        ctx.fillStyle = '#ffffff';
        ctx.fillText(label, (xs[index] + xs[index + 1]) / 2, tableY + 27);
        ctx.restore();
      };
      centerHeader('ROTAS', 2);
      centerHeader('PACOTES', 3);
      centerHeader('PACOTES / ROTA', 4);
      const printCentered = (text: string, x: number, y: number, font: string) => {
        ctx.save(); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = '#111820'; ctx.font = font; ctx.fillText(text, x, y); ctx.restore();
      };
      rows.forEach((row, i) => {
        const y = tableY + 54 + i * rowHeight;
        const position = offset + i + 1;
        rect(25, y, 1150, rowHeight, position <= 3 ? '#ffe34f' : i % 2 ? '#fff' : '#edf0f4');
        ctx.strokeStyle = '#cad1d9'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(25, y + rowHeight); ctx.lineTo(1175, y + rowHeight); ctx.stroke();
        printCentered(position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : String(position), (xs[0] + xs[1]) / 2, y + rowHeight / 2, 'bold 22px Arial');
        print(row.auditor, 137, y + rowHeight / 2 + 7, position <= 3 ? 'bold 21px Arial' : '19px Arial', '#111820', 417);
        printCentered(fmt(row.rotas), (xs[2] + xs[3]) / 2, y + rowHeight / 2, 'bold 21px Arial');
        printCentered(fmt(row.total), (xs[3] + xs[4]) / 2, y + rowHeight / 2, 'bold 21px Arial');
        printCentered(ratio(row), (xs[4] + xs[5]) / 2, y + rowHeight / 2, 'bold 20px Arial');
      });
      ctx.strokeStyle = '#b9c1cb'; ctx.lineWidth = 1;
      xs.forEach(x => { ctx.beginPath(); ctx.moveTo(x, tableY); ctx.lineTo(x, tableY + 54 + rows.length * rowHeight); ctx.stroke(); });
      ctx.restore();
      ctx.drawImage(footer, 0, canvas.height - bannerHeight, width, bannerHeight);
      const link = document.createElement('a');
      link.download = 'aduana-ranking-' + reportDate.replace(/\//g, '-') + '-parte-' + (Math.floor(offset / rowsPerImage) + 1) + '.png';
      const png = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Não foi possível criar o PNG.')), 'image/png');
      });
      const url = URL.createObjectURL(png);
      link.href = url;
      document.body.appendChild(link);
      link.click();
      link.remove();
      // Aguarda o navegador iniciar o download antes de liberar o recurso.
      window.setTimeout(() => URL.revokeObjectURL(url), 60000);
    }
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Erro ao baixar o PNG. Tente novamente.');
    } finally {
      downloadLock.current = false;
      setIsDownloading(false);
    }
  };

  const visible = useMemo(() => {
    const rows = ranking.filter(row => normalize(row.auditor).includes(normalize(filter)));
    return topMode === 'top10' ? rows.slice(0, 10) : rows;
  }, [ranking, filter, topMode]);
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
          {([['PACOTES AUDITADOS', summary.registros], ['ROTAS AUDITADAS', summary.rotas], ['CORRETOS', summary.corretos], ['A MAIS', summary.amais], ['FALTANTES', summary.faltantes], ['AUDITORES', summary.auditores]] as const).map(([label, value]) => <div key={label} className="border border-slate-300 bg-white p-4"><div className="text-xs font-black uppercase text-slate-600">{label}</div><div className="mt-2 text-4xl font-black text-slate-950">{formatCount(value)}</div></div>)}
        </section>
        <section className="overflow-hidden border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 p-3"><div className="flex items-center gap-3"><h3 className="text-lg font-black">Ranking por pacotes auditados</h3><button type="button" disabled={isDownloading} onClick={() => void downloadReport()} className="inline-flex items-center gap-2 bg-slate-900 px-4 py-2 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-60"><Download size={17} />{isDownloading ? "Baixando..." : "Baixar reporte PNG"}</button><select aria-label="Exibir ranking" value={topMode} onChange={event => setTopMode(event.target.value as 'all' | 'top10')} className="border border-slate-300 bg-white px-3 py-2 text-sm font-semibold"><option value="all">Todos</option><option value="top10">Top 10</option></select></div><input className="w-full border border-slate-300 px-3 py-2 text-sm sm:w-64" value={filter} onChange={event => setFilter(event.target.value)} placeholder="Pesquisar auditor" /></div>
          <div className="overflow-x-auto">
            <div className="bg-[#ffe600] px-5 py-4 text-[#111820]">
              <div className="text-sm font-black uppercase tracking-wide">Mercado Livre • SSP21 Mooca</div>
            </div>
            <div className="bg-[#10151d] px-5 py-4 text-2xl font-black text-white">
              ADUANA DO DIA {saved ? new Date().toLocaleDateString('pt-BR') : ''}
            </div>
            <table className="w-full min-w-[1120px] table-fixed text-sm">
              <colgroup><col style={{ width: '8%' }} /><col style={{ width: '30%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '13%' }} /></colgroup>
              <thead className="bg-[#111820] text-white">
                <tr>{['🏆 Ranking', 'Colaborador', 'Rotas', 'Pacotes', 'Corretos', 'A mais', 'Faltantes'].map(label => <th key={label} className="border-r border-slate-500 px-3 py-4 text-center font-black last:border-r-0">{label}</th>)}</tr>
              </thead>
              <tbody>
                {visible.map(row => {
                  const position = ranking.indexOf(row) + 1;
                  return <tr key={normalize(row.auditor)} className={position <= 3 ? 'bg-[#ffe34f] font-black text-[#111820]' : position % 2 ? 'bg-[#eef1f5]' : 'bg-white'}>
                    <td className="border border-slate-300 px-3 py-2 text-center font-black">{position === 1 ? '🥇' : position === 2 ? '🥈' : position === 3 ? '🥉' : position}</td>
                    <td className="border border-slate-300 px-3 py-2 font-semibold">{row.auditor}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums">{formatCount(row.rotas)}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums">{formatCount(row.total)}</td>
                    <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums text-emerald-700">{formatCount(row.corretos)}</td>
                     <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums text-red-700">{formatCount(row.amais)}</td>
                     <td className="border border-slate-300 px-3 py-2 text-center font-bold tabular-nums text-amber-700">{formatCount(row.faltantes)}</td>
                  </tr>;
                })}
                {!visible.length && <tr><td colSpan={7} className="p-8 text-center text-slate-500">Nenhum auditor encontrado.</td></tr>}
              </tbody>
            </table>
            <div className="border-t-4 border-[#ffe600] bg-[#10151d] px-5 py-5 text-white">
              <strong className="text-lg text-[#ffe600]">FOCO • DISCIPLINA • RESULTADO</strong>
              <p className="mt-1 text-sm">Cada rota, cada pacote, cada colaborador faz a diferença!</p>
            </div>
          </div>
        </section>
        <p className="text-xs text-slate-500">Critério: um registro final por Shipment ID e por arquivo, usando Data auditoria. Rotas auditadas = cada código de rota é contado apenas uma vez por auditor, mesmo quando aparece nos arquivos de Aduana e Auditoria. O ranking é ordenado pelo TOTAL de pacotes auditados, incluindo Corretos, A mais, Faltantes e outros estados. Cada situação aparece separada nas colunas do ranking.</p>
      </>}
    </div>
  );
}
