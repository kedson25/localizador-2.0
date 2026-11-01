import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  AlertTriangle,
  Search,
  Copy,
  Check,
  Download,
  Trash2,
  Upload,
  Share2,
  MapPin,
  ChevronDown,
  ChevronUp,
  FileSpreadsheet,
  Layers,
  ArrowUpDown,
  X,
  Truck,
  CheckCircle2,
  HelpCircle
} from 'lucide-react';
import type { ExpedicaoStore, EnrichedExpedicaoRow, BaseDespachoRow } from '../lib/expedicao';
import type { TodayListOccurrence } from '../lib/listaMultiSearch';
import { cleanDigits, cleanTrackingId } from '../utils/csvParser';

const STORAGE_KEY = 'docas-tentativas-csv-v2';
const CHECKED_STORAGE_KEY = 'docas-tentativas-checked-v1';

export interface TentativaItem {
  id: string;
  tentativas: number;
}

export interface MatchedTentativaRow {
  id: string;
  tentativas: number;
  vaga: string; // ex: "4", "12", or ""
  vagaLabel: string; // ex: "VAGA 4" or "SEM VAGA"
  vagaOrigem: 'aduana' | 'auditoria' | 'despacho' | 'nenhuma';
  rota: string;
  placa: string;
  onda: string;
  classificacao?: 'A mais' | 'Faltante';
  origemRegistro?: 'aduana' | 'auditoria';
  statusDetalhe: string;
  emListaHoje: boolean;
  listaDetalhes?: string;
  conferido: boolean;
}

interface DocasTentativasProps {
  store: ExpedicaoStore;
  cycleStore: ExpedicaoStore;
  enriched: EnrichedExpedicaoRow[];
  aduanaRows: EnrichedExpedicaoRow[];
  auditoriaRows: EnrichedExpedicaoRow[];
  backlogById: Record<string, TodayListOccurrence[]>;
  cycle?: 'todos' | 'AM' | 'PM' | 'SD';
  onNavigateToAduana?: (vaga?: string) => void;
}

export function parseTentativasCsv(text: string): TentativaItem[] {
  if (!text || !text.trim()) return [];

  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!lines.length) return [];

  const itemsMap = new Map<string, number>();

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Dividir por tabulação, ponto-e-vírgula ou vírgula
    let parts = line.split(/[\t;,]+/).map(p => p.trim().replace(/^["']|["']$/g, ''));
    if (parts.length < 2) {
      const spaceParts = line.split(/\s+/).map(p => p.trim());
      if (spaceParts.length >= 2) {
        parts = spaceParts;
      } else {
        continue;
      }
    }

    const col0 = parts[0];
    const col1 = parts[1];

    // Pula linha de cabeçalho
    if (/id|pacote|shipment|tracking/i.test(col0) && /tentativa|qtd|quantidade/i.test(col1)) {
      continue;
    }

    const cleanId = cleanTrackingId(col0) || cleanDigits(col0);
    const tentativasNum = parseInt(col1.replace(/\D/g, ''), 10);

    if (cleanId && !isNaN(tentativasNum)) {
      const prev = itemsMap.get(cleanId) || 0;
      itemsMap.set(cleanId, Math.max(prev, tentativasNum));
    }
  }

  return Array.from(itemsMap.entries()).map(([id, tentativas]) => ({
    id,
    tentativas,
  })).sort((a, b) => b.tentativas - a.tentativas || a.id.localeCompare(b.id));
}

const normalizeDockNumber = (value?: string): string => {
  if (!value) return '';
  const match = String(value).match(/\d+/);
  return match ? String(Number(match[0])) : String(value).trim();
};

export const DocasTentativas: React.FC<DocasTentativasProps> = ({
  store,
  cycleStore,
  enriched,
  aduanaRows,
  auditoriaRows,
  backlogById,
  cycle = 'todos',
  onNavigateToAduana,
}) => {
  const [rawInput, setRawInput] = useState<string>(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) || '';
    } catch {
      return '';
    }
  });

  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(CHECKED_STORAGE_KEY);
      return saved ? JSON.parse(saved) : {};
    } catch {
      return {};
    }
  });

  const [inputExpanded, setInputExpanded] = useState<boolean>(() => !rawInput.trim());
  const [filterTentativas, setFilterTentativas] = useState<'gte3' | 'all' | '4plus' | '3' | '2' | '1'>('gte3');
  const [filterVagaStatus, setFilterVagaStatus] = useState<'all' | 'com-vaga' | 'sem-vaga'>('all');
  const [selectedVaga, setSelectedVaga] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedZap, setCopiedZap] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Salvar no localStorage quando o texto mudar
  const handleSaveText = (text: string) => {
    setRawInput(text);
    try {
      localStorage.setItem(STORAGE_KEY, text);
    } catch {}
  };

  const toggleChecked = (id: string) => {
    setCheckedMap(prev => {
      const next = { ...prev, [id]: !prev[id] };
      try {
        localStorage.setItem(CHECKED_STORAGE_KEY, JSON.stringify(next));
      } catch {}
      return next;
    });
  };

  const clearAllData = () => {
    if (!window.confirm('Deseja limpar todos os dados de tentativas colados?')) return;
    setRawInput('');
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {}
    setSelectedVaga(null);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (content) {
        handleSaveText(content);
        setInputExpanded(false);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // Parsing da lista de tentativas
  const parsedItems = useMemo(() => {
    return parseTentativasCsv(rawInput);
  }, [rawInput]);

  // Indexação rápida da base e dos enriquecidos para lookup O(1)
  const lookupMaps = useMemo(() => {
    const enrichedMap = new Map<string, EnrichedExpedicaoRow>();
    const baseMap = new Map<string, BaseDespachoRow>();

    // Indexar enriched (Aduana / Auditoria)
    enriched.forEach(row => {
      if (row.pacote) {
        enrichedMap.set(row.pacote, row);
        const digits = cleanDigits(row.pacote);
        if (digits) enrichedMap.set(digits, row);
      }
    });

    // Indexar base despacho (ciclo ativo ou global)
    const baseSource = cycleStore.base.length > 0 ? cycleStore.base : store.base;
    baseSource.forEach(row => {
      if (row.pacote) {
        baseMap.set(row.pacote, row);
        const digits = cleanDigits(row.pacote);
        if (digits) baseMap.set(digits, row);
      }
    });

    return { enrichedMap, baseMap };
  }, [enriched, cycleStore.base, store.base]);

  // Cruzamento dos itens com as vagas
  const matchedRows = useMemo<MatchedTentativaRow[]>(() => {
    const { enrichedMap, baseMap } = lookupMaps;

    return parsedItems.map(item => {
      const cleanId = cleanDigits(item.id) || item.id;
      const enrichedRow = enrichedMap.get(item.id) || enrichedMap.get(cleanId);
      const baseRow = baseMap.get(item.id) || baseMap.get(cleanId);
      const backlogList = backlogById[item.id] || backlogById[cleanId] || [];

      let rawVaga = '';
      let vagaOrigem: MatchedTentativaRow['vagaOrigem'] = 'nenhuma';
      let rota = '';
      let placa = '';
      let onda = '';
      let classificacao: MatchedTentativaRow['classificacao'] = undefined;
      let origemRegistro: MatchedTentativaRow['origemRegistro'] = undefined;
      let statusDetalhe = 'Não localizado';

      if (enrichedRow) {
        origemRegistro = enrichedRow.origem;
        classificacao = enrichedRow.classificacao;
        rota = enrichedRow.encontradoRota || enrichedRow.destinoRota || '';
        placa = enrichedRow.placa || enrichedRow.encontradoPlaca || '';
        onda = enrichedRow.onda || enrichedRow.destinoOnda || '';

        if (enrichedRow.vagaOperacional || enrichedRow.encontradoDoca) {
          rawVaga = enrichedRow.vagaOperacional || enrichedRow.encontradoDoca;
          vagaOrigem = enrichedRow.origem; // 'aduana' ou 'auditoria'
          statusDetalhe = `${enrichedRow.origem === 'aduana' ? 'Aduana' : 'Auditoria'} (${enrichedRow.classificacao})`;
        } else if (enrichedRow.destinoDoca) {
          rawVaga = enrichedRow.destinoDoca;
          vagaOrigem = 'despacho';
          statusDetalhe = `Despacho (${enrichedRow.classificacao})`;
        } else if (baseRow?.doca) {
          rawVaga = baseRow.doca;
          vagaOrigem = 'despacho';
          statusDetalhe = 'Base Despacho';
        }
      } else if (baseRow) {
        rawVaga = baseRow.doca;
        vagaOrigem = 'despacho';
        rota = baseRow.rotaOtimizada || baseRow.rotaOriginal || '';
        placa = baseRow.placa || '';
        onda = baseRow.onda || '';
        statusDetalhe = 'Base Despacho';
      }

      const vagaNorm = normalizeDockNumber(rawVaga);
      const vagaLabel = vagaNorm ? `VAGA ${vagaNorm}` : 'SEM VAGA';

      const emListaHoje = backlogList.length > 0;
      let listaDetalhes = '';
      if (emListaHoje) {
        const first = backlogList[0];
        listaDetalhes = `${first.grupoNome || 'Lista'} (${first.item?.responsavel || 'Bipado'})`;
      }

      return {
        id: item.id,
        tentativas: item.tentativas,
        vaga: vagaNorm,
        vagaLabel,
        vagaOrigem,
        rota,
        placa,
        onda,
        classificacao,
        origemRegistro,
        statusDetalhe,
        emListaHoje,
        listaDetalhes,
        conferido: Boolean(checkedMap[item.id]),
      };
    });
  }, [parsedItems, lookupMaps, backlogById, checkedMap]);

  // Estatísticas e agrupamentos
  const stats = useMemo(() => {
    const totalPasted = matchedRows.length;
    const gte3Rows = matchedRows.filter(r => r.tentativas >= 3);
    const countGte3 = gte3Rows.length;
    const count4Plus = matchedRows.filter(r => r.tentativas >= 4).length;
    const count3 = matchedRows.filter(r => r.tentativas === 3).length;
    const count2 = matchedRows.filter(r => r.tentativas === 2).length;
    const count1 = matchedRows.filter(r => r.tentativas === 1).length;

    // Estatísticas considerando os pacotes críticos (>= 3 tentativas)
    const gte3ComVaga = gte3Rows.filter(r => Boolean(r.vaga)).length;
    const gte3SemVaga = countGte3 - gte3ComVaga;
    const gte3Conferidos = gte3Rows.filter(r => r.conferido).length;

    // Vagas que contêm pacotes com >= 3 tentativas
    const vagasMap = new Map<string, { vaga: string; total: number; pacotes: MatchedTentativaRow[] }>();
    gte3Rows.forEach(row => {
      const v = row.vaga || 'SEM_VAGA';
      const existing = vagasMap.get(v) || { vaga: v, total: 0, pacotes: [] };
      existing.total += 1;
      existing.pacotes.push(row);
      vagasMap.set(v, existing);
    });

    const vagasList = Array.from(vagasMap.values()).sort((a, b) => {
      if (a.vaga === 'SEM_VAGA') return 1;
      if (b.vaga === 'SEM_VAGA') return -1;
      const numA = parseInt(a.vaga, 10);
      const numB = parseInt(b.vaga, 10);
      if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
      return a.vaga.localeCompare(b.vaga);
    });

    return {
      totalPasted,
      countGte3,
      count4Plus,
      count3,
      count2,
      count1,
      gte3ComVaga,
      gte3SemVaga,
      gte3Conferidos,
      vagasList,
    };
  }, [matchedRows]);

  // Filtragem dos dados para exibição na tabela
  const filteredRows = useMemo(() => {
    return matchedRows.filter(row => {
      // 1. Filtro de Tentativas
      if (filterTentativas === 'gte3' && row.tentativas < 3) return false;
      if (filterTentativas === '4plus' && row.tentativas < 4) return false;
      if (filterTentativas === '3' && row.tentativas !== 3) return false;
      if (filterTentativas === '2' && row.tentativas !== 2) return false;
      if (filterTentativas === '1' && row.tentativas !== 1) return false;

      // 2. Filtro de Status de Vaga
      if (filterVagaStatus === 'com-vaga' && !row.vaga) return false;
      if (filterVagaStatus === 'sem-vaga' && Boolean(row.vaga)) return false;

      // 3. Filtro de Vaga Selecionada no Mapa de Vagas
      if (selectedVaga) {
        if (selectedVaga === 'SEM_VAGA') {
          if (Boolean(row.vaga)) return false;
        } else {
          if (row.vaga !== selectedVaga) return false;
        }
      }

      // 4. Busca por texto
      if (searchQuery.trim()) {
        const q = searchQuery.trim().toLowerCase();
        const haystack = [
          row.id,
          row.vagaLabel,
          row.rota,
          row.placa,
          row.statusDetalhe,
          row.listaDetalhes,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [matchedRows, filterTentativas, filterVagaStatus, selectedVaga, searchQuery]);

  // Gerador de relatório para WhatsApp focado em pacotes com 3+ tentativas
  const handleCopyWhatsapp = async () => {
    const today = new Date().toLocaleDateString('pt-BR');
    const gte3Rows = matchedRows.filter(r => r.tentativas >= 3);

    // Agrupar por vaga
    const byVaga = new Map<string, MatchedTentativaRow[]>();
    gte3Rows.forEach(r => {
      const v = r.vaga ? `VAGA ${r.vaga}` : 'SEM VAGA CONFIRMADA';
      const list = byVaga.get(v) || [];
      list.push(r);
      byVaga.set(v, list);
    });

    const lines: string[] = [
      `🚨 *PACOTES COM 3+ TENTATIVAS DE ENTREGA* 🚨`,
      `📅 Data: ${today}`,
      `📦 Total de pacotes críticos: ${gte3Rows.length} ${gte3Rows.length === 1 ? 'pacote' : 'pacotes'}`,
      `📍 Com vaga identificada: ${stats.gte3ComVaga} pacotes`,
      '',
    ];

    Array.from(byVaga.entries())
      .sort(([a], [b]) => {
        if (a.includes('SEM VAGA')) return 1;
        if (b.includes('SEM VAGA')) return -1;
        return a.localeCompare(b, 'pt-BR', { numeric: true });
      })
      .forEach(([vagaTitle, items]) => {
        lines.push(`*${vagaTitle}* (${items.length}):`);
        items.forEach(item => {
          const infoRota = item.rota ? ` - Rota ${item.rota}` : '';
          const infoPlaca = item.placa ? ` | Placa ${item.placa}` : '';
          lines.push(`  • ${item.id} (${item.tentativas}x tentativas)${infoRota}${infoPlaca}`);
        });
        lines.push('');
      });

    lines.push(`📎 Controle de Docas - SSP21 Mooca`);

    const fullText = lines.join('\n');
    try {
      await navigator.clipboard.writeText(fullText);
      setCopiedZap(true);
      setTimeout(() => setCopiedZap(false), 2500);
    } catch {
      alert('Não foi possível copiar automaticamente para a área de transferência.');
    }
  };

  const handleExportCsv = () => {
    if (!matchedRows.length) return;
    const header = ['ID_PACOTE', 'TENTATIVAS', 'VAGA', 'ORIGEM_VAGA', 'ROTA', 'PLACA', 'ONDA', 'STATUS', 'EM_LISTA_HOJE', 'CONFERIDO'];
    const csvLines = [
      header.join(';'),
      ...filteredRows.map(r => [
        `"${r.id}"`,
        r.tentativas,
        `"${r.vaga ? `VAGA ${r.vaga}` : 'SEM VAGA'}"`,
        `"${r.vagaOrigem}"`,
        `"${r.rota || ''}"`,
        `"${r.placa || ''}"`,
        `"${r.onda || ''}"`,
        `"${r.statusDetalhe}"`,
        `"${r.emListaHoje ? 'SIM' : 'NAO'}"`,
        `"${r.conferido ? 'SIM' : 'NAO'}"`
      ].join(';'))
    ];
    const blob = new Blob(['\uFEFF' + csvLines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `tentativas-docas-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const copyIndividualId = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  return (
    <div className="space-y-3">
      {/* SEÇÃO DE ENTRADA DO CSV */}
      <section className="border border-slate-300 bg-white p-3.5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-sm bg-amber-500 font-black text-slate-950">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-sm font-black text-slate-900 uppercase tracking-wide">
                Tentativas de Entrega • Localizador de Vagas
              </h2>
              <p className="text-[11px] font-semibold text-slate-500">
                Cole o CSV com <span className="font-mono font-bold text-slate-700">ID_PACOTE</span> e <span className="font-mono font-bold text-slate-700">QTD_TENTATIVAS_ENTREGA</span> para identificar em qual vaga está cada pacote.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv,text/plain"
              className="hidden"
              onChange={handleFileUpload}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
            >
              <Upload className="h-3.5 w-3.5" /> Importar arquivo
            </button>
            {rawInput.trim() && (
              <button
                type="button"
                onClick={clearAllData}
                className="inline-flex h-8 items-center gap-1.5 border border-red-200 bg-red-50 px-2.5 text-xs font-bold text-red-700 hover:bg-red-100 cursor-pointer"
              >
                <Trash2 className="h-3.5 w-3.5" /> Limpar
              </button>
            )}
            <button
              type="button"
              onClick={() => setInputExpanded(!inputExpanded)}
              className="inline-flex h-8 items-center gap-1 border border-slate-300 bg-white px-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
            >
              {inputExpanded ? (
                <>Recolher <ChevronUp className="h-3.5 w-3.5" /></>
              ) : (
                <>Editar dados ({parsedItems.length} IDs) <ChevronDown className="h-3.5 w-3.5" /></>
              )}
            </button>
          </div>
        </div>

        {inputExpanded && (
          <div className="mt-3 space-y-2 border-t border-slate-200 pt-3">
            <label className="block text-[11px] font-bold text-slate-700">
              Cole abaixo as linhas do relatório de tentativas (separadas por tabulação ou vírgula):
            </label>
            <textarea
              value={rawInput}
              onChange={e => handleSaveText(e.target.value)}
              placeholder={`ID_PACOTE\tQTD_TENTATIVAS_ENTREGA\n48190992568\t4\n48239018160\t3\n48189019499\t3\n...`}
              rows={7}
              className="w-full border border-slate-300 bg-slate-50 p-2.5 font-mono text-xs leading-relaxed text-slate-800 focus:border-slate-900 focus:bg-white focus:outline-hidden"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] font-semibold text-slate-500">
              <span>
                {parsedItems.length > 0 ? (
                  <b className="text-emerald-700">✓ {parsedItems.length} pacotes identificados com sucesso.</b>
                ) : (
                  'Cole os dados acima. Aceita cópia direta de Excel, Planilhas Google ou arquivo CSV.'
                )}
              </span>
              <button
                type="button"
                onClick={() => setInputExpanded(false)}
                disabled={!parsedItems.length}
                className="bg-slate-900 px-4 py-1.5 text-xs font-black text-white hover:bg-slate-800 disabled:opacity-50 cursor-pointer"
              >
                Concluir e ver vagas
              </button>
            </div>
          </div>
        )}
      </section>

      {/* AVISO SE NÃO TIVER DADOS IMPORTADOS NO DESPACHO / ADUANA */}
      {store.base.length === 0 && store.aduana.length === 0 && (
        <div className="border border-amber-300 bg-amber-50/80 p-3 text-xs text-amber-900 flex items-start gap-2.5">
          <HelpCircle className="h-4 w-4 shrink-0 text-amber-700 mt-0.5" />
          <div>
            <b>Atenção:</b> A Base de Despacho e/ou Aduana ainda não foi importada nesta sessão de monitoramento.
            Importe o CSV de <b>Despacho</b> ou <b>Aduana</b> no topo para que o cruzamento encontre as vagas exatas de cada ID.
          </div>
        </div>
      )}

      {/* SEÇÃO PRINCIPAL - CARDS DE RESUMO E MAPA DE VAGAS */}
      {parsedItems.length > 0 && (
        <>
          {/* CARDS DE RESUMO KPI */}
          <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <div className="border-2 border-red-500 bg-red-50/60 p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-red-700 flex items-center justify-between">
                <span>Críticos (≥ 3 Tentativas)</span>
                <span className="rounded-full bg-red-600 px-1.5 py-0.2 text-[9px] text-white font-black">PRIORIDADE</span>
              </div>
              <div className="mt-1 text-3xl font-black text-red-900">
                {stats.countGte3}
              </div>
              <div className="mt-1 text-[10px] font-bold text-red-700">
                {stats.count4Plus > 0 ? `${stats.count4Plus} com 4+ tentativas • ` : ''}{stats.count3} com 3 tentativas
              </div>
            </div>

            <div className="border border-slate-300 bg-white p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Localizados com Vaga
              </div>
              <div className="mt-1 text-3xl font-black text-emerald-700">
                {stats.gte3ComVaga}
              </div>
              <div className="mt-1 text-[10px] font-bold text-slate-500">
                de {stats.countGte3} com ≥3 tentativas ({stats.countGte3 > 0 ? Math.round((stats.gte3ComVaga / stats.countGte3) * 100) : 0}%)
              </div>
            </div>

            <div className="border border-slate-300 bg-white p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Sem Vaga / Não Localizados
              </div>
              <div className="mt-1 text-3xl font-black text-amber-700">
                {stats.gte3SemVaga}
              </div>
              <div className="mt-1 text-[10px] font-bold text-slate-500">
                requerem conferência física
              </div>
            </div>

            <div className="border border-slate-300 bg-white p-3">
              <div className="text-[10px] font-black uppercase tracking-wider text-slate-500">
                Total Importado no CSV
              </div>
              <div className="mt-1 text-3xl font-black text-slate-900">
                {stats.totalPasted}
              </div>
              <div className="mt-1 text-[10px] font-bold text-slate-500">
                {stats.count2} com 2 tent. • {stats.count1} com 1 tent.
              </div>
            </div>
          </section>

          {/* MAPA DE VAGAS DOS PACOTES CRÍTICOS (≥ 3 TENTATIVAS) */}
          <section className="border border-slate-300 bg-white p-3 shadow-xs">
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
              <div className="flex items-center gap-2">
                <MapPin className="h-4 w-4 text-red-600" />
                <h3 className="text-xs font-black uppercase tracking-wide text-slate-900">
                  Onde estão os pacotes com 3+ tentativas (Vagas Encontradas)
                </h3>
              </div>
              {selectedVaga && (
                <button
                  type="button"
                  onClick={() => setSelectedVaga(null)}
                  className="text-[11px] font-black text-slate-600 underline hover:text-slate-900 cursor-pointer"
                >
                  Limpar filtro de vaga (mostrar todas)
                </button>
              )}
            </div>

            {stats.vagasList.length > 0 ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
                {stats.vagasList.map(item => {
                  const isSemVaga = item.vaga === 'SEM_VAGA';
                  const isSelected = selectedVaga === item.vaga;
                  return (
                    <button
                      key={item.vaga}
                      type="button"
                      onClick={() => setSelectedVaga(isSelected ? null : item.vaga)}
                      className={`border p-2 text-left transition relative cursor-pointer ${
                        isSelected
                          ? 'border-slate-950 bg-slate-950 text-white ring-2 ring-slate-950 ring-offset-1'
                          : isSemVaga
                            ? 'border-amber-300 bg-amber-50/70 hover:bg-amber-100/60'
                            : 'border-slate-300 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <span className={`text-[11px] font-black uppercase ${isSelected ? 'text-white' : isSemVaga ? 'text-amber-900' : 'text-slate-900'}`}>
                          {isSemVaga ? 'Sem Vaga' : `VAGA ${item.vaga}`}
                        </span>
                        <span
                          className={`rounded px-1.5 py-0.2 text-[10px] font-black ${
                            isSelected
                              ? 'bg-red-500 text-white'
                              : 'bg-red-100 text-red-800'
                          }`}
                        >
                          {item.total} {item.total === 1 ? 'pct' : 'pcts'}
                        </span>
                      </div>
                      <div className={`mt-1 text-[9px] font-semibold truncate ${isSelected ? 'text-slate-300' : 'text-slate-500'}`}>
                        {item.pacotes.slice(0, 2).map(p => `${p.tentativas}x`).join(', ')}
                        {item.pacotes.length > 2 ? '...' : ''}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="py-4 text-center text-xs font-semibold text-slate-500">
                Nenhum pacote com 3 ou mais tentativas encontrado.
              </div>
            )}
          </section>

          {/* BARRA DE FILTROS E AÇÕES DA TABELA */}
          <section className="border border-slate-300 bg-white p-3 shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2.5">
              {/* FILTROS DE TENTATIVAS */}
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-[11px] font-black uppercase text-slate-500 mr-1">Filtrar:</span>
                
                <button
                  type="button"
                  onClick={() => setFilterTentativas('gte3')}
                  className={`px-3 py-1.5 text-xs font-black transition cursor-pointer ${
                    filterTentativas === 'gte3'
                      ? 'bg-red-600 text-white shadow-xs'
                      : 'border border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  🔥 ≥ 3 tentativas ({stats.countGte3})
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTentativas('4plus')}
                  className={`px-2.5 py-1.5 text-xs font-black transition cursor-pointer ${
                    filterTentativas === '4plus'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  4+ tent. ({stats.count4Plus})
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTentativas('3')}
                  className={`px-2.5 py-1.5 text-xs font-black transition cursor-pointer ${
                    filterTentativas === '3'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  3 tent. ({stats.count3})
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTentativas('2')}
                  className={`px-2.5 py-1.5 text-xs font-black transition cursor-pointer ${
                    filterTentativas === '2'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  2 tent. ({stats.count2})
                </button>

                <button
                  type="button"
                  onClick={() => setFilterTentativas('all')}
                  className={`px-2.5 py-1.5 text-xs font-black transition cursor-pointer ${
                    filterTentativas === 'all'
                      ? 'bg-slate-900 text-white'
                      : 'border border-slate-300 bg-white text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  Todas ({stats.totalPasted})
                </button>

                <span className="mx-1 text-slate-300">|</span>

                <select
                  value={filterVagaStatus}
                  onChange={e => setFilterVagaStatus(e.target.value as any)}
                  className="h-8 border border-slate-300 bg-white px-2 text-xs font-bold text-slate-700 outline-hidden"
                >
                  <option value="all">Todas as localizações</option>
                  <option value="com-vaga">Somente com vaga</option>
                  <option value="sem-vaga">Somente sem vaga</option>
                </select>
              </div>

              {/* BUSCA E AÇÕES DE EXPORTAÇÃO */}
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 h-4 w-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Buscar ID, vaga, rota..."
                    className="h-8 w-44 sm:w-56 border border-slate-300 pl-8 pr-7 text-xs font-semibold focus:border-slate-900 focus:outline-hidden"
                  />
                  {searchQuery && (
                    <button
                      type="button"
                      onClick={() => setSearchQuery('')}
                      className="absolute right-1.5 top-1.5 text-slate-400 hover:text-slate-700"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleCopyWhatsapp}
                  className="inline-flex h-8 items-center gap-1.5 bg-emerald-600 px-3 text-xs font-black text-white hover:bg-emerald-700 shadow-xs cursor-pointer"
                  title="Copiar relatório formatado de 3+ tentativas para WhatsApp"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  {copiedZap ? 'Copiado p/ Zap! ✓' : 'Copiar p/ Zap'}
                </button>

                <button
                  type="button"
                  onClick={handleExportCsv}
                  className="inline-flex h-8 items-center gap-1.5 border border-slate-300 bg-white px-2.5 text-xs font-black text-slate-700 hover:bg-slate-50 cursor-pointer"
                  title="Exportar dados filtrados em CSV"
                >
                  <Download className="h-3.5 w-3.5" /> CSV
                </button>
              </div>
            </div>
          </section>

          {/* TABELA DE RESULTADOS */}
          <section className="overflow-hidden border border-slate-300 bg-white shadow-xs">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-black text-slate-700">
              <div className="flex items-center gap-2">
                <span>
                  Exibindo {filteredRows.length} de {matchedRows.length} pacotes
                  {filterTentativas === 'gte3' ? ' (apenas ≥ 3 tentativas)' : ''}
                  {selectedVaga ? ` • Vaga ${selectedVaga}` : ''}
                </span>
              </div>
              <span className="text-[11px] font-bold text-slate-500">
                Dica: clique no checkbox para marcar o pacote como conferido/retirado da vaga.
              </span>
            </div>

            <div className="max-h-[600px] overflow-auto">
              <table className="w-full min-w-[760px] border-collapse text-xs">
                <thead className="sticky top-0 z-10 bg-slate-900 text-white text-[11px]">
                  <tr>
                    <th className="border-b border-r border-slate-700 px-3 py-2.5 text-left font-black">ID DO PACOTE</th>
                    <th className="border-b border-r border-slate-700 px-3 py-2.5 text-center font-black">TENTATIVAS</th>
                    <th className="border-b border-r border-slate-700 px-3 py-2.5 text-left font-black">VAGA OPERACIONAL</th>
                    <th className="border-b border-r border-slate-700 px-3 py-2.5 text-left font-black">ROTA / PLACA</th>
                    <th className="border-b border-r border-slate-700 px-3 py-2.5 text-left font-black">SITUAÇÃO / ORIGEM</th>
                    <th className="border-b border-slate-700 px-3 py-2.5 text-center font-black">CONFERIDO</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => {
                    const isGte3 = row.tentativas >= 3;
                    const hasVaga = Boolean(row.vaga);
                    return (
                      <tr
                        key={row.id}
                        className={`transition ${
                          row.conferido
                            ? 'bg-slate-100/80 text-slate-400 opacity-60'
                            : isGte3
                              ? hasVaga
                                ? 'bg-red-50/40 hover:bg-red-50/80'
                                : 'bg-amber-50/40 hover:bg-amber-50/80'
                              : 'hover:bg-slate-50'
                        }`}
                      >
                        {/* ID DO PACOTE */}
                        <td className="border-b border-r border-slate-200 px-3 py-2">
                          <div className="flex items-center gap-1.5">
                            <span className={`font-mono font-black ${row.conferido ? 'line-through' : 'text-slate-900'}`}>
                              {row.id}
                            </span>
                            <button
                              type="button"
                              onClick={() => copyIndividualId(row.id)}
                              title="Copiar ID"
                              className="text-slate-400 hover:text-slate-700 cursor-pointer"
                            >
                              {copiedId === row.id ? (
                                <Check className="h-3.5 w-3.5 text-emerald-600" />
                              ) : (
                                <Copy className="h-3.5 w-3.5" />
                              )}
                            </button>
                          </div>
                        </td>

                        {/* TENTATIVAS */}
                        <td className="border-b border-r border-slate-200 px-3 py-2 text-center">
                          <span
                            className={`inline-flex items-center justify-center rounded-sm px-2.5 py-0.5 font-black text-xs ${
                              row.tentativas >= 4
                                ? 'border border-red-600 bg-red-600 text-white'
                                : row.tentativas === 3
                                  ? 'border border-red-300 bg-red-100 text-red-900 font-black'
                                  : row.tentativas === 2
                                    ? 'border border-amber-300 bg-amber-100 text-amber-900'
                                    : 'border border-slate-300 bg-slate-100 text-slate-700'
                            }`}
                          >
                            {row.tentativas} {row.tentativas === 1 ? 'vez' : 'vezes'}
                          </span>
                        </td>

                        {/* VAGA OPERACIONAL (DESTAQUE PRINCIPAL) */}
                        <td className="border-b border-r border-slate-200 px-3 py-2">
                          {hasVaga ? (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded bg-slate-900 px-2.5 py-1 text-xs font-black text-white shadow-xs">
                                <MapPin className="h-3 w-3 text-emerald-400" />
                                {row.vagaLabel}
                              </span>
                              <div className="mt-0.5 text-[10px] font-bold text-slate-500">
                                Fonte: {row.vagaOrigem === 'aduana' ? 'Aduana (Real)' : row.vagaOrigem === 'auditoria' ? 'Auditoria' : 'Base Despacho'}
                              </div>
                            </div>
                          ) : (
                            <div>
                              <span className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-black text-amber-800">
                                <HelpCircle className="h-3 w-3 text-amber-600" />
                                SEM VAGA CONFIRMADA
                              </span>
                              <div className="mt-0.5 text-[10px] font-semibold text-slate-400">
                                Não associado a vaga no momento
                              </div>
                            </div>
                          )}
                        </td>

                        {/* ROTA / PLACA */}
                        <td className="border-b border-r border-slate-200 px-3 py-2">
                          <div className="font-bold text-slate-800">
                            {row.rota || <span className="text-slate-400 italic">Sem rota</span>}
                          </div>
                          {row.placa && (
                            <div className="text-[10px] font-mono text-slate-500">
                              Placa: <b>{row.placa}</b>
                            </div>
                          )}
                        </td>

                        {/* SITUAÇÃO / ORIGEM */}
                        <td className="border-b border-r border-slate-200 px-3 py-2">
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                                row.origemRegistro === 'aduana'
                                  ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                  : row.origemRegistro === 'auditoria'
                                    ? 'bg-purple-100 text-purple-800 border border-purple-200'
                                    : row.vagaOrigem === 'despacho'
                                      ? 'bg-slate-100 text-slate-800 border border-slate-200'
                                      : 'bg-gray-100 text-gray-600 border border-gray-200'
                              }`}
                            >
                              {row.statusDetalhe}
                            </span>
                            {row.emListaHoje && (
                              <span className="rounded border border-emerald-300 bg-emerald-100 px-1.5 py-0.5 text-[10px] font-bold text-emerald-900">
                                ✓ Em Lista do Dia
                              </span>
                            )}
                          </div>
                          {row.listaDetalhes && (
                            <div className="mt-0.5 text-[9px] font-semibold text-slate-500">
                              {row.listaDetalhes}
                            </div>
                          )}
                        </td>

                        {/* CHECKBOX DE CONFERIDO */}
                        <td className="border-b border-slate-200 px-3 py-2 text-center">
                          <label className="inline-flex cursor-pointer items-center justify-center">
                            <input
                              type="checkbox"
                              checked={row.conferido}
                              onChange={() => toggleChecked(row.id)}
                              className="h-4 w-4 rounded accent-slate-900 cursor-pointer"
                            />
                          </label>
                        </td>
                      </tr>
                    );
                  })}

                  {!filteredRows.length && (
                    <tr>
                      <td colSpan={6} className="py-12 text-center text-xs font-bold text-slate-500">
                        Nenhum pacote encontrado com os filtros selecionados.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}

      {/* SE NÃO HOUVER NENHUM DADO COLADO AINDA */}
      {!parsedItems.length && !inputExpanded && (
        <div className="border border-dashed border-slate-300 bg-white py-12 text-center">
          <Layers className="mx-auto h-8 w-8 text-slate-400" />
          <h3 className="mt-2 text-sm font-black text-slate-800">Nenhum dado de tentativas carregado</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-md mx-auto">
            Cole a planilha com os códigos dos pacotes e as quantidades de tentativas de entrega para descobrir em quais vagas estão.
          </p>
          <button
            type="button"
            onClick={() => setInputExpanded(true)}
            className="mt-4 bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-800 cursor-pointer"
          >
            Colar CSV de Tentativas
          </button>
        </div>
      )}
    </div>
  );
};
