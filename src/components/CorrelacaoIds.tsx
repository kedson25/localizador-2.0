import React, { useMemo, useRef, useState } from 'react';
import { CheckCircle2, Copy, Download, FileSpreadsheet, RefreshCw, Search, Upload, XCircle } from 'lucide-react';
import { cleanDigits, detectDelimiter } from '../utils/csvParser';

type CsvData = {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
};

type Match = {
  idLista: string;
  idFos: string;
  motivo: string;
  data: string;
};

function parseCsv(text: string): { headers: string[]; rows: Record<string, string>[] } {
  const source = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const lines = source.split('\n').filter(line => line.trim());
  if (!lines.length) return { headers: [], rows: [] };

  const delimiter = detectDelimiter(source);
  const splitLine = (line: string) => {
    const values: string[] = [];
    let value = '';
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
      const char = line[index];
      if (char === '"') {
        if (quoted && line[index + 1] === '"') {
          value += '"';
          index += 1;
        } else quoted = !quoted;
      } else if (char === delimiter && !quoted) {
        values.push(value.trim());
        value = '';
      } else value += char;
    }
    values.push(value.trim());
    return values;
  };

  const headers = splitLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const values = splitLine(line);
    return headers.reduce<Record<string, string>>((row, header, index) => {
      row[header] = values[index] || '';
      return row;
    }, {});
  });
  return { headers, rows };
}

function suggestHeader(headers: string[], patterns: RegExp[]) {
  return headers.find(header => patterns.some(pattern => pattern.test(header))) || headers[0] || '';
}

function normalizeId(value: string) {
  return cleanDigits(String(value || '')).replace(/\.0$/, '');
}

function extractPair(value: string) {
  const ids = String(value || '').match(/\d{10,15}/g) || [];
  if (ids.length < 2) return null;
  return { idFos: ids[0], idLista: ids[ids.length - 1] };
}

function escapeCsv(value: string) {
  return `"${String(value || '').replace(/"/g, '""')}"`;
}

export const CorrelacaoIds: React.FC = () => {
  const [lista, setLista] = useState<CsvData | null>(null);
  const [fos, setFos] = useState<CsvData | null>(null);
  const [listaKey, setListaKey] = useState('');
  const [fosKey, setFosKey] = useState('');
  const [motivoKey, setMotivoKey] = useState('');
  const [dataKey, setDataKey] = useState('');
  const [matches, setMatches] = useState<Match[]>([]);
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [searched, setSearched] = useState(false);
  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const listaInput = useRef<HTMLInputElement>(null);
  const fosInput = useRef<HTMLInputElement>(null);

  const loadFile = (file: File, source: 'lista' | 'fos') => {
    const reader = new FileReader();
    reader.onload = event => {
      const parsed = parseCsv(String(event.target?.result || ''));
      const data = { fileName: file.name, ...parsed };
      if (source === 'lista') {
        setLista(data);
        setListaKey(suggestHeader(parsed.headers, [/^id$/i, /pacote/i, /shipment/i, /barcode/i, /c[oó]digo/i]));
      } else {
        setFos(data);
        setFosKey(suggestHeader(parsed.headers, [/shipment/i, /pacote.*fos/i, /cruzado/i, /id.*fos/i, /^id$/i]));
        setMotivoKey(suggestHeader(parsed.headers, [/motivo/i, /devolu/i, /reason/i, /status/i]));
        setDataKey(suggestHeader(parsed.headers, [/data/i, /date/i, /hor[aá]rio/i, /criado/i]));
      }
      setSearched(false);
    };
    reader.readAsText(file, 'UTF-8');
  };

  const correlate = () => {
    if (!lista || !fos || !listaKey || !fosKey) return;
    const fosMap = new Map<string, Omit<Match, 'idLista'>>();
    fos.rows.forEach(row => {
      const pair = extractPair(row[fosKey]);
      if (!pair) return;
      fosMap.set(normalizeId(pair.idLista), {
        idFos: pair.idFos,
        motivo: motivoKey ? row[motivoKey] || 'Não informado' : 'Não mapeado',
        data: dataKey ? row[dataKey] || 'Não informada' : 'Não mapeada',
      });
    });

    const found: Match[] = [];
    const absent: string[] = [];
    const processed = new Set<string>();
    lista.rows.forEach(row => {
      const idLista = normalizeId(row[listaKey]);
      if (!idLista || processed.has(idLista)) return;
      processed.add(idLista);
      const detail = fosMap.get(idLista);
      if (detail) found.push({ idLista, ...detail });
      else absent.push(idLista);
    });
    setMatches(found);
    setUnmatched(absent);
    setSearched(true);
  };

  const filteredMatches = useMemo(() => {
    const term = filter.trim().toLowerCase();
    if (!term) return matches;
    return matches.filter(item => `${item.idLista} ${item.idFos} ${item.motivo} ${item.data}`.toLowerCase().includes(term));
  }, [filter, matches]);

  const copy = async (text: string, key: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1500);
  };

  const exportMatches = () => {
    if (!matches.length) return;
    const csv = [
      'ID LISTA;ID FOS;MOTIVO;DATA',
      ...matches.map(item => [item.idLista, item.idFos, escapeCsv(item.motivo), escapeCsv(item.data)].join(';')),
    ].join('\r\n');
    const blob = new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'correlacao-ids.csv';
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const fileCard = (label: string, data: CsvData | null, input: React.RefObject<HTMLInputElement | null>, source: 'lista' | 'fos') => (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-wider text-slate-500">{label}</p>
          <p className="mt-1 text-sm font-bold text-slate-900">{data ? data.fileName : 'Nenhum arquivo selecionado'}</p>
        </div>
        <span className="rounded-lg bg-blue-50 px-2.5 py-1 text-xs font-bold text-blue-700">{data ? `${data.rows.length} linhas` : 'CSV'}</span>
      </div>
      <input ref={input} type="file" accept=".csv,.txt,.tsv" className="hidden" onChange={event => {
        const file = event.target.files?.[0];
        if (file) loadFile(file, source);
        event.currentTarget.value = '';
      }} />
      <button type="button" onClick={() => input.current?.click()} className="flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-blue-300 bg-blue-50/40 px-4 py-4 text-sm font-bold text-blue-700 transition hover:bg-blue-50">
        <Upload className="h-4 w-4" /> {data ? 'Trocar arquivo' : 'Selecionar CSV'}
      </button>
    </div>
  );

  return (
    <div className="space-y-5">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-950">Correlação de IDs</h1>
            <p className="mt-1 text-sm text-slate-500">Compare uma lista de IDs com a base FOS e encontre o ID vinculado, motivo e data.</p>
          </div>
          {searched && <span className="rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700">Correlação concluída</span>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {fileCard('Lista 1 · IDs para comparar', lista, listaInput, 'lista')}
        {fileCard('Lista 2 · Base FOS', fos, fosInput, 'fos')}
      </div>

      {(lista || fos) && <section className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:grid-cols-2 lg:grid-cols-4">
        {lista && <label className="text-xs font-bold text-slate-600">Coluna do ID da lista<select value={listaKey} onChange={event => setListaKey(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800">{lista.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
        {fos && <label className="text-xs font-bold text-slate-600">Coluna com ID FOS - ID lista<select value={fosKey} onChange={event => setFosKey(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800">{fos.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
        {fos && <label className="text-xs font-bold text-slate-600">Coluna do motivo<select value={motivoKey} onChange={event => setMotivoKey(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"><option value="">Não mapear</option>{fos.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
        {fos && <label className="text-xs font-bold text-slate-600">Coluna da data<select value={dataKey} onChange={event => setDataKey(event.target.value)} className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-800"><option value="">Não mapear</option>{fos.headers.map(header => <option key={header}>{header}</option>)}</select></label>}
      </section>}

      <button type="button" disabled={!lista || !fos || !listaKey || !fosKey} onClick={correlate} className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-5 py-3 text-sm font-black text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300">
        <RefreshCw className="h-4 w-4" /> Comparar IDs
      </button>

      {searched && <>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4"><p className="text-xs font-bold uppercase text-emerald-700">Conciliados</p><p className="mt-1 text-2xl font-black text-emerald-900">{matches.length}</p></div>
          <div className="rounded-xl border border-red-200 bg-red-50 p-4"><p className="text-xs font-bold uppercase text-red-700">Não localizados</p><p className="mt-1 text-2xl font-black text-red-900">{unmatched.length}</p></div>
          <div className="rounded-xl border border-blue-200 bg-blue-50 p-4"><p className="text-xs font-bold uppercase text-blue-700">Taxa de correlação</p><p className="mt-1 text-2xl font-black text-blue-900">{lista?.rows.length ? ((matches.length / (matches.length + unmatched.length)) * 100).toFixed(1) : '0.0'}%</p></div>
        </div>

        <div className="grid gap-5 xl:grid-cols-2">
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-black text-slate-900"><CheckCircle2 className="h-5 w-5 text-emerald-600" /> Conciliados ({matches.length})</h2><p className="mt-1 text-xs text-slate-500">IDs da lista encontrados na base FOS.</p></div><button type="button" onClick={exportMatches} disabled={!matches.length} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:text-slate-300"><Download className="h-4 w-4" /> Exportar CSV</button></div>
            <div className="relative mb-3"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><input value={filter} onChange={event => setFilter(event.target.value)} placeholder="Filtrar ID ou motivo..." className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm outline-none focus:border-blue-500" /></div>
            <div className="max-h-[440px] space-y-2 overflow-y-auto pr-1">{filteredMatches.map(item => <article key={item.idLista} className="rounded-xl border border-slate-200 p-3"><div className="flex items-center justify-between gap-2 font-mono text-xs"><span className="font-bold text-slate-800">Lista: {item.idLista}</span><button type="button" onClick={() => copy(item.idFos, item.idLista)} className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 font-bold text-blue-700 hover:bg-blue-100">{copied === item.idLista ? 'Copiado!' : <><Copy className="h-3 w-3" /> FOS: {item.idFos}</>}</button></div><div className="mt-2 grid grid-cols-2 gap-2 border-t border-slate-100 pt-2 text-xs text-slate-600"><span><b>Motivo:</b> {item.motivo}</span><span><b>Data:</b> {item.data}</span></div></article>)}{!filteredMatches.length && <p className="py-10 text-center text-sm text-slate-400">Nenhum ID conciliado.</p>}</div>
          </section>
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><div className="mb-4 flex items-center justify-between gap-3"><div><h2 className="flex items-center gap-2 font-black text-slate-900"><XCircle className="h-5 w-5 text-red-500" /> Não localizados ({unmatched.length})</h2><p className="mt-1 text-xs text-slate-500">IDs da primeira lista sem par na FOS.</p></div>{unmatched.length > 0 && <button type="button" onClick={() => copy(unmatched.join('\n'), 'unmatched')} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">{copied === 'unmatched' ? 'Copiado!' : <><Copy className="h-4 w-4" /> Copiar lista</>}</button>}</div><div className="max-h-[440px] space-y-1.5 overflow-y-auto pr-1">{unmatched.map(id => <div key={id} className="rounded-lg border border-red-100 bg-red-50/50 px-3 py-2 font-mono text-sm font-bold text-slate-700">{id}</div>)}{!unmatched.length && <p className="py-10 text-center text-sm text-emerald-600">Todos os IDs foram encontrados.</p>}</div></section>
        </div>
      </>}
    </div>
  );
};
