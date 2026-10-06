import React, { useMemo, useRef, useState } from 'react';
import { crossSources, CsvTemplate, DynamicCsvSource, indexSource, loadTemplates, parseDynamicCsv, sameColumns, TEMPLATE_KEY } from '../lib/dynamicCsv';

const inputStyle = 'rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm';
const buttonStyle = 'rounded-lg bg-[#3483FA] px-4 py-2 text-sm font-semibold text-white disabled:opacity-40';

function SourcePreview({ source }: { source: DynamicCsvSource }) {
  return <div className="space-y-3">
    <p className="text-sm">{source.fileName} • {source.rows.length.toLocaleString('pt-BR')} registros • {source.columns.length} colunas</p>
    <p className="text-sm font-semibold">Colunas encontradas</p>
    <div className="flex flex-wrap gap-2">{source.columns.map(column => <span key={column} className="rounded-lg border border-gray-200 px-3 py-1 text-sm whitespace-pre-wrap">{column}</span>)}</div>
    <div className="max-h-64 overflow-auto rounded-lg border border-gray-200"><table className="w-full text-left text-sm"><caption className="p-2 text-left text-gray-500">Prévia: primeiras 8 linhas</caption><thead className="bg-gray-50"><tr>{source.columns.map(column => <th key={column} className="whitespace-pre px-3 py-2">{column}</th>)}</tr></thead><tbody>{source.rows.slice(0, 8).map((row, i) => <tr key={i} className="border-t border-gray-100">{source.columns.map(column => <td key={column} className="whitespace-pre px-3 py-2">{row[column]}</td>)}</tr>)}</tbody></table></div>
  </div>;
}

export interface SearchSession { source: DynamicCsvSource | null; searchColumn: string; returnColumns: string[] }
export function DynamicCsvPanel({ mode = 'search', session, onSessionChange }: { mode?: 'search' | 'cross'; session?: SearchSession; onSessionChange?: React.Dispatch<React.SetStateAction<SearchSession>> }) {
  const isCross = mode === 'cross';
  const [localA, setLocalA] = useState<DynamicCsvSource | null>(null);
  const [b, setB] = useState<DynamicCsvSource | null>(null);
  const [aColumn, setAColumn] = useState('');
  const [localSearchColumn, setLocalSearchColumn] = useState('');
  const [localReturnColumns, setLocalReturnColumns] = useState<string[]>([]);
  const a = session && !isCross ? session.source : localA;
  const searchColumn = session && !isCross ? session.searchColumn : localSearchColumn;
  const returnColumns = session && !isCross ? session.returnColumns : localReturnColumns;
  const setA = (source: DynamicCsvSource) => { if (session && onSessionChange && !isCross) onSessionChange({ source, searchColumn: '', returnColumns: [] }); else setLocalA(source); };
  const setSearchColumn = (column: string) => { if (session && onSessionChange && !isCross) onSessionChange(previous => ({ ...previous, searchColumn: column })); else setLocalSearchColumn(column); };
  const setReturnColumns = (columns: string[]) => { if (session && onSessionChange && !isCross) onSessionChange(previous => ({ ...previous, returnColumns: columns })); else setLocalReturnColumns(columns); };
  const [query, setQuery] = useState('');
  const [searched, setSearched] = useState<string | null>(null);
  const [crossResults, setCrossResults] = useState<ReturnType<typeof crossSources> | null>(null);
  const [page, setPage] = useState(0);
  const [templates, setTemplates] = useState(loadTemplates);
  const [templateName, setTemplateName] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState(false);
  const requests = useRef({ a: 0, b: 0 });
  const source = isCross ? b : a;
  const ready = !!source && source.columns.includes(searchColumn) && returnColumns.length > 0 && (!isCross || !!a?.columns.includes(aColumn));
  const index = useMemo(() => source && source.columns.includes(searchColumn) ? indexSource(source, searchColumn) : new Map<string, Record<string, string>[]>(), [source, searchColumn]);
  const detected = source && !dismissed ? templates.filter(template => sameColumns(template.columns, source.columns) && source.columns.includes(template.searchColumn) && template.returnColumns.length > 0 && template.returnColumns.every(column => source.columns.includes(column)) && (isCross ? !!a && !!template.sourceAColumns && sameColumns(template.sourceAColumns, a.columns) && a.columns.includes(template.sourceAColumn || '') : !template.sourceAColumns)) : [];
  const invalidate = () => { setSearched(null); setCrossResults(null); setPage(0); setMessage(''); };

  async function upload(file: File, side: 'a' | 'b') {
    const request = ++requests.current[side];
    try {
      const buffer = await file.arrayBuffer();
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
      catch { text = new TextDecoder('windows-1252').decode(buffer); }
      const parsed = parseDynamicCsv(text, file.name);
      if (request !== requests.current[side]) return;
      if (side === 'a') { setA(parsed); setAColumn(''); } else setB(parsed);
      if (side === 'b' || (!isCross && !session)) { setLocalSearchColumn(''); setLocalReturnColumns([]); }
      setDismissed(false); setError(''); invalidate();
    } catch (err) {
      if (request === requests.current[side]) setError(err instanceof Error ? err.message : 'Não foi possível ler o arquivo.');
    }
  }

  function saveTemplate() {
    if (!ready || !source || !templateName.trim()) return;
    const template: CsvTemplate = { id: crypto.randomUUID(), name: templateName.trim(), columns: source.columns, searchColumn, returnColumns, ...(isCross && a ? { sourceAColumns: a.columns, sourceAColumn: aColumn } : {}) };
    try {
      const next = [...loadTemplates(), template];
      localStorage.setItem(TEMPLATE_KEY, JSON.stringify(next)); setTemplates(next); setDismissed(true); setTemplateName(''); setMessage('Configuração salva neste navegador.'); setError('');
    } catch { setError('Não foi possível salvar a configuração neste navegador.'); }
  }

  const results = isCross ? crossResults : searched === null ? null : (index.get(searched) || []).map(data => ({ value: searched, found: true, data }));
  return <section className="space-y-4 rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">
    <h2 className="text-lg font-bold">{isCross ? 'Cruzador Visual de Dados' : 'Localizador — mapeamento visual de CSV'}</h2>
    <p className="text-sm text-gray-500">Carregue o arquivo, confira os dados e escolha as colunas para procurar e retornar.</p>
    {(['a', ...(isCross ? ['b'] : [])] as ('a' | 'b')[]).map(side => <div key={side} className="space-y-3">
      <label className="block text-sm font-semibold">{isCross ? `Tabela ${side.toUpperCase()}` : 'Carregar base CSV'}<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" className="mt-2 block w-full text-sm" onChange={event => { const file = event.currentTarget.files?.[0]; if (file) void upload(file, side); event.currentTarget.value = ''; }} /></label>
      {(side === 'a' ? a : b) && <SourcePreview source={(side === 'a' ? a : b)!} />}
      {isCross && side === 'a' && a && <label className="block text-sm">Qual coluna da Tabela A contém os valores que você quer procurar?<select className={`${inputStyle} mt-2 block w-full`} value={aColumn} onChange={event => { setAColumn(event.target.value); invalidate(); }}><option value="">Selecione uma coluna</option>{a.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>}
    </div>)}
    {detected.map(template => <div key={template.id} className="space-y-2 rounded-lg border border-gray-200 p-3"><p>Configuração detectada: <strong>{template.name}</strong></p><div className="flex flex-wrap gap-2"><button type="button" className={buttonStyle} onClick={() => { setSearchColumn(template.searchColumn); setReturnColumns([...template.returnColumns]); if (isCross) setAColumn(template.sourceAColumn || ''); setDismissed(true); invalidate(); }}>Usar configuração</button><button type="button" className={inputStyle} onClick={() => { setDismissed(true); setSearchColumn(''); setReturnColumns([]); if (isCross) setAColumn(''); invalidate(); }}>Configurar novamente</button></div></div>)}
    {source && <>
      <label className="block text-sm font-semibold">{isCross ? 'Em qual coluna da Tabela B devemos procurar?' : 'Em qual coluna está a informação que você pretende procurar?'}<select className={`${inputStyle} mt-2 block w-full`} value={searchColumn} onChange={event => { setSearchColumn(event.target.value); invalidate(); }}><option value="">Selecione uma coluna</option>{source.columns.map(column => <option key={column} value={column}>{column}</option>)}</select></label>
      <fieldset><legend className="mb-2 text-sm font-semibold">Quando encontrar, quais dados você quer visualizar?</legend><div className="flex flex-wrap gap-3">{source.columns.map(column => <label key={column} className="flex items-center gap-2 rounded-lg border border-gray-200 px-3 py-2 text-sm"><input type="checkbox" checked={returnColumns.includes(column)} onChange={event => { setReturnColumns(event.target.checked ? [...returnColumns, column] : returnColumns.filter(value => value !== column)); invalidate(); }} />{column}</label>)}</div></fieldset>
      {ready && <div className="space-y-2 rounded-lg bg-gray-50 p-3 text-sm"><p className="font-semibold">{isCross ? 'Cruzamento configurado' : 'Localizador configurado'}</p>{isCross && <p>Origem: Tabela A → {aColumn}</p>}<p>{isCross ? 'Comparar com: Tabela B' : 'Pesquisar usando'} → {searchColumn}</p><p>Retornar: {returnColumns.join(' • ')}</p><p className="text-gray-500">Edite as seleções acima para alterar o mapeamento.</p></div>}
      <div className="flex flex-wrap items-end gap-2"><label className="text-sm">Salvar configuração — nome<input className={`${inputStyle} mt-1 block`} value={templateName} onChange={event => setTemplateName(event.target.value)} placeholder="Expedição diária" /></label><button type="button" className={buttonStyle} disabled={!ready || !templateName.trim()} onClick={saveTemplate}>Salvar</button></div>
      {isCross ? <button type="button" className={buttonStyle} disabled={!ready} onClick={() => { if (a && b) { setCrossResults(crossSources(a, b, { sourceAId: a.id, sourceAColumn: aColumn, sourceBId: b.id, sourceBColumn: searchColumn, returnColumns })); setPage(0); } }}>Executar cruzamento</button> : <form className="flex flex-wrap items-end gap-2" onSubmit={event => { event.preventDefault(); if (ready && query !== '') { setSearched(query); setQuery(''); setPage(0); } }}><label className="text-sm font-semibold">Pesquisar / bipar<input className={`${inputStyle} mt-1 block`} disabled={!ready} value={query} onChange={event => setQuery(event.target.value)} autoComplete="off" /></label><button className={buttonStyle} disabled={!ready || query === ''}>Pesquisar</button></form>}
    </>}
    {error && <p role="alert" className="text-sm text-red-600">{error}</p>}{message && <p role="status" className="text-sm text-green-700">{message}</p>}
    {results && <div className="space-y-3" aria-live="polite"><p className="text-sm font-semibold">{isCross ? `${results.length} resultados • ${results.filter(result => result.found).length} encontrados` : `${searched} — ${results.length ? '✓ Encontrado' : 'Não encontrado'} (${results.length} correspondências)`}</p>{results.slice(page * 25, (page + 1) * 25).map((result, i) => <div key={page * 25 + i} className="rounded-lg border border-gray-200 p-3"><p className="font-semibold break-all">{result.value || '(valor vazio)'} — {result.found ? '✓ Encontrado' : 'Não encontrado'}</p>{result.found && <dl className="mt-2 grid gap-3 sm:grid-cols-3">{returnColumns.map(column => <div key={column}><dt className="text-xs text-gray-500 whitespace-pre-wrap">{column}</dt><dd className="break-all text-sm whitespace-pre-wrap">{result.data[column] || '—'}</dd></div>)}</dl>}</div>)}{results.length > 25 && <div className="flex items-center gap-3"><button type="button" className={inputStyle} disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><span className="text-sm">Página {page + 1} de {Math.ceil(results.length / 25)}</span><button type="button" className={inputStyle} disabled={(page + 1) * 25 >= results.length} onClick={() => setPage(page + 1)}>Próxima</button></div>}</div>}
  </section>;
}
