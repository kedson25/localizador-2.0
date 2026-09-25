import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  RefreshCw,
  Share2,
  Trash2,
  Upload,
} from 'lucide-react';
import type { ColetaItem, ColetaLista, CsvRow } from '../types';
import { cleanDigits } from '../utils/csvParser';
import { getAllItemsForExport, listenToListas } from '../lib/firebase';

interface WhatsappReportEnhancedProps {
  rows: CsvRow[];
}

const normalizeGroupName = (value?: string) =>
  String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toUpperCase();

const extractCleanCycle = (value?: string): string => {
  const text = String(value || '').trim();
  if (!text) return 'SD';

  const explicit = text.match(/\b(AM|PM|SD)\b/i);
  if (explicit) return explicit[1].toUpperCase();

  const dCycle = text.match(/\bD\s*-?\s*(\d+)\b/i);
  if (dCycle) return `D${dCycle[1]}`;

  const numberedCycle = text.match(/\bCICLO\s*(\d+)\b/i);
  if (numberedCycle) return `Ciclo ${numberedCycle[1]}`;

  return text
    .replace(/^(ciclos?|sa[íi]da|origem)[:\s-]*/gi, '')
    .trim()
    .toUpperCase() || 'SD';
};

const getTodayFormatted = () => {
  const today = new Date();
  const day = String(today.getDate()).padStart(2, '0');
  const month = String(today.getMonth() + 1).padStart(2, '0');
  return `${day}/${month}/${today.getFullYear()}`;
};

const getDefaultGreeting = () => {
  const hour = new Date().getHours();
  if (hour >= 5 && hour < 12) return 'Bom dia, time! 👋';
  if (hour >= 12 && hour < 18) return 'Boa tarde, time! 👋';
  return 'Boa noite, time! 👋';
};

export function WhatsappReportEnhanced({ rows }: WhatsappReportEnhancedProps) {
  const [listas, setListas] = useState<ColetaLista[]>([]);
  const [selectedListaId, setSelectedListaId] = useState('');
  const [selectedListaItens, setSelectedListaItens] = useState<ColetaItem[]>([]);
  const [isLoadingListaItens, setIsLoadingListaItens] = useState(false);
  const [listaItensError, setListaItensError] = useState<string | null>(null);

  const [inputText, setInputText] = useState('');
  const [useAllBase, setUseAllBase] = useState(false);
  const [copied, setCopied] = useState(false);

  const [greeting, setGreeting] = useState(getDefaultGreeting());
  const [reportDate, setReportDate] = useState(getTodayFormatted());
  const [customCycle, setCustomCycle] = useState('');
  const [cycleOverridden, setCycleOverridden] = useState(false);
  const [customFooterNote, setCustomFooterNote] = useState('');

  useEffect(() => listenToListas(setListas), []);

  const selectedLista = useMemo(
    () => listas.find(lista => lista.id === selectedListaId),
    [listas, selectedListaId]
  );

  useEffect(() => {
    let cancelled = false;
    setSelectedListaItens([]);
    setListaItensError(null);

    if (!selectedListaId) {
      setIsLoadingListaItens(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoadingListaItens(true);

    getAllItemsForExport(selectedListaId)
      .then(itens => {
        if (!cancelled) {
          setSelectedListaItens(Array.isArray(itens) ? itens : []);
        }
      })
      .catch(error => {
        console.error('Erro ao carregar itens da lista selecionada:', error);
        if (!cancelled) {
          setSelectedListaItens([]);
          setListaItensError('Não foi possível carregar os dados desta lista.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingListaItens(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedListaId]);

  const parsedIds = useMemo(() => {
    if (!inputText.trim()) return [];
    const tokens = inputText.split(/[\n\r,;\t\s]+/);
    return Array.from(new Set(tokens.map(token => token.trim()).filter(Boolean)));
  }, [inputText]);

  const reportData = useMemo(() => {
    if (selectedLista) {
      const motivosMap = new Map<string, number>();
      const saidasSet = new Set<string>();

      selectedListaItens.forEach(item => {
        const motivo = (item.motivo || 'Sem Motivo').trim();
        motivosMap.set(motivo, (motivosMap.get(motivo) || 0) + 1);

        const saida = (item.saida || selectedLista.saidaPadrao || selectedLista.saida || '').trim();
        if (saida) saidasSet.add(saida);
      });

      return {
        matchedRows: selectedListaItens as unknown as CsvRow[],
        notFoundIds: [] as string[],
        detectedSaidaList: Array.from(saidasSet),
        motivosCount: Array.from(motivosMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      };
    }

    if (useAllBase) {
      const motivosMap = new Map<string, number>();
      const saidasSet = new Set<string>();

      rows.forEach(row => {
        const motivo = (row.motivo || row.rawFields?.MOTIVO || 'Sem Motivo').trim();
        motivosMap.set(motivo, (motivosMap.get(motivo) || 0) + 1);

        const saida = (row.saida || row.rawFields?.['Saída'] || row.rawFields?.Saida || '').trim();
        if (saida) saidasSet.add(saida);
      });

      return {
        matchedRows: rows,
        notFoundIds: [] as string[],
        detectedSaidaList: Array.from(saidasSet),
        motivosCount: Array.from(motivosMap.entries())
          .map(([name, count]) => ({ name, count }))
          .sort((a, b) => b.count - a.count),
      };
    }

    if (parsedIds.length === 0 || rows.length === 0) {
      return {
        matchedRows: [] as CsvRow[],
        notFoundIds: parsedIds,
        detectedSaidaList: [] as string[],
        motivosCount: [] as { name: string; count: number }[],
      };
    }

    const rowById = new Map<string, CsvRow>();
    const rowByCleanId = new Map<string, CsvRow>();

    rows.forEach(row => {
      if (row.id) rowById.set(row.id.trim(), row);
      if (row.originalId) rowById.set(row.originalId.trim(), row);
      if (row.cleanId) rowByCleanId.set(row.cleanId, row);
      if (row.concat) {
        rowById.set(row.concat.trim(), row);
        const concatClean = cleanDigits(row.concat);
        if (concatClean) rowByCleanId.set(concatClean, row);
      }
    });

    const foundList: CsvRow[] = [];
    const notFoundList: string[] = [];
    const seenRows = new Set<number>();
    const saidasSet = new Set<string>();
    const motivosMap = new Map<string, number>();

    parsedIds.forEach(term => {
      const cleanTerm = cleanDigits(term);
      let match = rowById.get(term) || (cleanTerm ? rowByCleanId.get(cleanTerm) : undefined);

      if (!match) {
        match = rows.find(row =>
          row.id === term ||
          (cleanTerm && row.cleanId === cleanTerm) ||
          row.id.includes(term) ||
          Boolean(row.concat?.includes(term))
        );
      }

      if (!match) {
        notFoundList.push(term);
        return;
      }

      if (seenRows.has(match.rowIndex)) return;
      seenRows.add(match.rowIndex);
      foundList.push(match);

      const motivo = (match.motivo || match.rawFields?.MOTIVO || 'Sem Motivo').trim();
      motivosMap.set(motivo, (motivosMap.get(motivo) || 0) + 1);

      const saida = (match.saida || match.rawFields?.['Saída'] || match.rawFields?.Saida || '').trim();
      if (saida) saidasSet.add(saida);
    });

    return {
      matchedRows: foundList,
      notFoundIds: notFoundList,
      detectedSaidaList: Array.from(saidasSet),
      motivosCount: Array.from(motivosMap.entries())
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    };
  }, [parsedIds, rows, selectedLista, selectedListaItens, useAllBase]);

  const cpgGroupIds = useMemo(() => {
    if (!selectedLista?.grupos?.length) return new Set<string>();
    return new Set(
      selectedLista.grupos
        .filter(grupo => normalizeGroupName(grupo.nome) === 'CPG')
        .map(grupo => grupo.id)
    );
  }, [selectedLista?.grupos]);

  const cpgCount = useMemo(() => {
    if (cpgGroupIds.size === 0) return 0;
    return selectedListaItens.filter(item => item.grupoId && cpgGroupIds.has(item.grupoId)).length;
  }, [cpgGroupIds, selectedListaItens]);

  const hasCpgGroup = cpgGroupIds.size > 0;

  useEffect(() => {
    if (selectedListaId) {
      const cycleFromList =
        selectedLista?.saidaPadrao ||
        selectedLista?.saida ||
        reportData.detectedSaidaList[0] ||
        'SD';

      setCustomCycle(extractCleanCycle(cycleFromList));
      setCycleOverridden(false);
      return;
    }

    if (cycleOverridden) return;

    const cycleFromData = reportData.detectedSaidaList[0] || rows.find(row => row.saida)?.saida || 'SD';
    setCustomCycle(extractCleanCycle(cycleFromData));
  }, [
    selectedListaId,
    selectedLista?.saidaPadrao,
    selectedLista?.saida,
    reportData.detectedSaidaList,
    rows,
    cycleOverridden,
  ]);

  const generatedMessage = useMemo(() => {
    const totalCount = reportData.matchedRows.length;
    const activeCycle = extractCleanCycle(customCycle || selectedLista?.saidaPadrao || 'SD');
    const defaultFooter = `📎 Anexado o reporte com os pacotes desconteinerizados adicionados ao ciclo ${activeCycle}.`;
    const finalFooter = customFooterNote.trim() || defaultFooter;

    const motivosText = reportData.motivosCount.length > 0
      ? reportData.motivosCount
          .map(motivo => `* ${motivo.name}: ${motivo.count} ${motivo.count === 1 ? 'pacote' : 'pacotes'}`)
          .join('\n')
      : '* (Nenhum motivo identificado nos IDs)';

    const lines = [
      greeting,
      '',
      'Segue o reporte da lista de inventário de hoje.',
      '',
      `Lista total:  ${totalCount} ${totalCount === 1 ? 'pacote' : 'pacotes'}`,
    ];

    if (hasCpgGroup) {
      lines.push(`CPG: ${cpgCount} ${cpgCount === 1 ? 'pacote' : 'pacotes'}`);
    }

    lines.push(
      '',
      `Origem agregada no Ciclo ${activeCycle}  (${reportDate})`,
      '',
      motivosText,
      '',
      finalFooter,
    );

    return lines.join('\n');
  }, [
    cpgCount,
    customCycle,
    customFooterNote,
    greeting,
    hasCpgGroup,
    reportData.matchedRows.length,
    reportData.motivosCount,
    reportDate,
    selectedLista?.saidaPadrao,
  ]);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(generatedMessage);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch (error) {
      console.error('Falha ao copiar texto:', error);
    }
  };

  const handleShareWhatsapp = () => {
    window.open(`https://api.whatsapp.com/send?text=${encodeURIComponent(generatedMessage)}`, '_blank');
  };

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = loadEvent => {
      const content = String(loadEvent.target?.result || '');
      if (!content) return;

      const validLines = content.split(/\r?\n/).filter(line => line.trim());
      if (validLines.length === 0) return;

      const startIndex = validLines.length > 1 && !/^\d{5,}/.test(validLines[0].trim()) ? 1 : 0;
      const ids = validLines
        .slice(startIndex)
        .map(line => line.trim().split(/[,;\t]/)[0]?.trim().replace(/^["']|["']$/g, ''))
        .filter(Boolean);

      setSelectedListaId('');
      setUseAllBase(false);
      setInputText(ids.join('\n'));
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const informedCount = selectedLista
    ? selectedListaItens.length
    : useAllBase
      ? rows.length
      : parsedIds.length;

  const statGridClass = hasCpgGroup ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-3';

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="space-y-3 lg:col-span-5">
          <div className="space-y-3 rounded-lg border border-gray-300 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="block text-xs font-bold uppercase tracking-wide text-gray-700">
                IDs para o Reporte
              </label>

              <div className="flex items-center gap-1.5">
                <label className="inline-flex cursor-pointer items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2.5 py-1 text-[11px] font-bold text-amber-900 transition-colors hover:bg-amber-100">
                  <Upload className="h-3 w-3 text-amber-700" />
                  Arquivo
                  <input type="file" accept=".csv,.txt,.tsv" onChange={handleFileUpload} className="hidden" />
                </label>

                {(inputText || selectedListaId) && (
                  <button
                    type="button"
                    onClick={() => {
                      setInputText('');
                      setSelectedListaId('');
                      setUseAllBase(false);
                    }}
                    className="inline-flex items-center gap-1 rounded bg-gray-100 px-2 py-1 text-[11px] font-medium text-gray-700 transition hover:bg-gray-200"
                  >
                    <Trash2 className="h-3 w-3" />
                    Limpar
                  </button>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-[11px] font-bold uppercase tracking-wide text-gray-500">
                Lista do Sistema
              </label>
              <select
                value={selectedListaId}
                onChange={event => {
                  const nextId = event.target.value;
                  setSelectedListaId(nextId);
                  setCycleOverridden(false);
                  if (nextId) {
                    setUseAllBase(false);
                    setInputText('');
                  }
                }}
                className="w-full rounded border border-gray-300 bg-white p-2 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
              >
                <option value="">-- Nenhuma --</option>
                {listas.map(lista => (
                  <option key={lista.id} value={lista.id}>
                    {lista.nome} ({lista.data} - {lista.status === 'finalizada' ? 'Finalizada' : 'Em Andamento'})
                  </option>
                ))}
              </select>
            </div>

            {!selectedListaId && (
              <>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <button
                    type="button"
                    onClick={() => setUseAllBase(false)}
                    className={`rounded border px-2 py-1.5 font-semibold ${!useAllBase ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
                  >
                    Colar IDs {parsedIds.length > 0 ? `(${parsedIds.length})` : ''}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setUseAllBase(true);
                      setInputText('');
                    }}
                    className={`rounded border px-2 py-1.5 font-semibold ${useAllBase ? 'border-emerald-400 bg-emerald-50 text-emerald-900' : 'border-gray-200 bg-gray-50 text-gray-600'}`}
                  >
                    Base CSV ({rows.length})
                  </button>
                </div>

                {!useAllBase ? (
                  <textarea
                    rows={8}
                    value={inputText}
                    onChange={event => setInputText(event.target.value)}
                    placeholder="Cole os IDs (um por linha)..."
                    className="w-full resize-y rounded border border-gray-300 bg-white p-2.5 font-mono text-xs text-gray-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                  />
                ) : (
                  <div className="rounded border border-emerald-200 bg-emerald-50/70 p-2.5 text-xs text-emerald-900">
                    <p className="flex items-center gap-1.5 font-bold">
                      <CheckCircle2 className="h-4 w-4" />
                      Base CSV ({rows.length} registros).
                    </p>
                  </div>
                )}
              </>
            )}

            {selectedListaId && selectedLista && (
              <div className={`rounded border p-2.5 text-xs ${listaItensError ? 'border-red-200 bg-red-50 text-red-900' : isLoadingListaItens ? 'border-blue-200 bg-blue-50 text-blue-900' : 'border-emerald-200 bg-emerald-50/70 text-emerald-900'}`}>
                <p className="flex items-center gap-1.5 font-bold">
                  {listaItensError ? (
                    <AlertCircle className="h-4 w-4" />
                  ) : isLoadingListaItens ? (
                    <RefreshCw className="h-4 w-4 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-4 w-4" />
                  )}
                  {listaItensError || (isLoadingListaItens ? 'Carregando dados da lista...' : `Lista selecionada (${selectedListaItens.length} registros).`)}
                </p>
              </div>
            )}

            <div className={`grid ${statGridClass} gap-2 pt-1 text-center font-mono`}>
              <div className="rounded border border-gray-200 bg-gray-50 p-2">
                <span className="block text-[10px] font-bold uppercase text-gray-500">Informados</span>
                <span className="text-sm font-black text-gray-900">{informedCount}</span>
              </div>
              <div className="rounded border border-emerald-200 bg-emerald-50 p-2">
                <span className="block text-[10px] font-bold uppercase text-emerald-700">Encontrados</span>
                <span className="text-sm font-black text-emerald-900">{reportData.matchedRows.length}</span>
              </div>
              <div className={`rounded border p-2 ${reportData.notFoundIds.length > 0 ? 'border-red-200 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
                <span className="block text-[10px] font-bold uppercase text-gray-500">Não Achados</span>
                <span className={`text-sm font-black ${reportData.notFoundIds.length > 0 ? 'text-red-700' : 'text-gray-600'}`}>{reportData.notFoundIds.length}</span>
              </div>
              {hasCpgGroup && (
                <div className="rounded border border-purple-200 bg-purple-50 p-2">
                  <span className="block text-[10px] font-bold uppercase text-purple-700">CPG</span>
                  <span className="text-sm font-black text-purple-900">{cpgCount}</span>
                </div>
              )}
            </div>

            {reportData.notFoundIds.length > 0 && !useAllBase && (
              <div className="space-y-1.5 rounded border border-red-200 bg-red-50 p-2.5 text-xs text-red-900">
                <div className="flex items-center gap-1 font-bold text-red-800">
                  <AlertCircle className="h-3.5 w-3.5" />
                  {reportData.notFoundIds.length} não constam no CSV
                </div>
                <div className="max-h-24 space-y-0.5 overflow-y-auto rounded border border-red-200 bg-white p-1.5 font-mono text-[11px] text-red-700">
                  {reportData.notFoundIds.map(id => <div key={id}>• {id}</div>)}
                </div>
              </div>
            )}
          </div>

          <div className="space-y-3 rounded-lg border border-gray-300 bg-white p-3 shadow-xs">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="text-[11px] font-bold uppercase text-gray-500">
                Ciclo
                <input
                  value={customCycle}
                  onChange={event => {
                    setCustomCycle(event.target.value);
                    setCycleOverridden(true);
                  }}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-black text-gray-900 outline-none focus:border-emerald-500"
                  placeholder="PM, SD, AM..."
                />
              </label>
              <label className="text-[11px] font-bold uppercase text-gray-500">
                Data
                <input
                  value={reportDate}
                  onChange={event => setReportDate(event.target.value)}
                  className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs font-bold text-gray-900 outline-none focus:border-emerald-500"
                />
              </label>
            </div>
            <label className="block text-[11px] font-bold uppercase text-gray-500">
              Saudação
              <input
                value={greeting}
                onChange={event => setGreeting(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-emerald-500"
              />
            </label>
            <label className="block text-[11px] font-bold uppercase text-gray-500">
              Rodapé opcional
              <input
                value={customFooterNote}
                onChange={event => setCustomFooterNote(event.target.value)}
                className="mt-1 w-full rounded border border-gray-300 px-2 py-1.5 text-xs text-gray-900 outline-none focus:border-emerald-500"
                placeholder="Deixe vazio para usar o texto padrão"
              />
            </label>
          </div>

          <div className="space-y-2 rounded-lg border border-gray-300 bg-white p-3 shadow-xs">
            <h3 className="flex items-center justify-between text-xs font-bold uppercase tracking-wide text-gray-700">
              <span>Motivos</span>
              <span className="font-mono text-[11px] font-normal text-gray-500">{reportData.motivosCount.length}</span>
            </h3>
            {reportData.motivosCount.length === 0 ? (
              <p className="py-2 text-center text-xs italic text-gray-400">Nenhum dado informado.</p>
            ) : (
              <div className="max-h-48 space-y-1.5 overflow-y-auto pr-1">
                {reportData.motivosCount.map(motivo => {
                  const percent = reportData.matchedRows.length > 0
                    ? Math.round((motivo.count / reportData.matchedRows.length) * 100)
                    : 0;
                  return (
                    <div key={motivo.name} className="flex items-center justify-between rounded border border-gray-200 bg-gray-50 p-1.5 text-xs">
                      <span className="max-w-[200px] truncate font-medium text-gray-800" title={motivo.name}>{motivo.name}</span>
                      <div className="flex items-center gap-2 font-mono">
                        <span className="text-[11px] text-gray-500">{percent}%</span>
                        <span className="rounded border border-emerald-300 bg-emerald-100 px-2 py-0.5 text-xs font-bold text-emerald-950">
                          {motivo.count} {motivo.count === 1 ? 'pct' : 'pcts'}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-3 lg:col-span-7">
          <div className="space-y-3 rounded-lg border border-gray-300 bg-white p-4 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-200 pb-3">
              <h3 className="flex items-center gap-1.5 text-sm font-bold text-gray-900">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                Mensagem WhatsApp
              </h3>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopy}
                  className="inline-flex items-center gap-1.5 rounded-md bg-emerald-600 px-3.5 py-1.5 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
                >
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                  {copied ? 'Copiado!' : 'Copiar'}
                </button>
                <button
                  type="button"
                  onClick={handleShareWhatsapp}
                  className="inline-flex items-center gap-1.5 rounded-md bg-[#25D366] px-3.5 py-1.5 text-xs font-bold text-gray-950 shadow-xs transition hover:bg-[#20bd5a]"
                >
                  <Share2 className="h-4 w-4" />
                  Enviar WhatsApp
                </button>
              </div>
            </div>

            <div className="relative min-h-[300px] rounded-lg border border-gray-300/80 bg-[#EFEAE2] p-4 shadow-inner">
              <div className="relative max-w-xl rounded-lg rounded-tl-xs border border-gray-200/80 bg-white p-3.5 text-xs leading-relaxed text-gray-800 shadow-sm sm:text-sm">
                <div className="absolute -left-2 top-0 h-0 w-0 border-l-8 border-t-8 border-l-transparent border-t-white" />
                <div className="select-all whitespace-pre-wrap leading-normal">{generatedMessage}</div>
                <div className="flex items-center justify-end gap-1 pt-1 font-mono text-[10px] text-gray-400">
                  <span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                  <span className="font-bold text-emerald-500">✓✓</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
