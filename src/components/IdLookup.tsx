import React, { useState, useMemo, useEffect } from 'react';
import {
  Search,
  Copy,
  Check,
  AlertCircle,
  Layers,
  X,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Upload,
  Filter,
  ListPlus,
  RotateCcw,
  MapPin,
  Clock,
  History,
  Sparkles,
  FileText,
  Truck
} from 'lucide-react';
import { CsvRow, LookupMatch, ColetaLista, ColetaItem, PacoteMovimento } from '../types';
import { cleanDigits } from '../utils/csvParser';
import { listenToListas, searchItemsAcrossAllListas, getItemsOfGrupo } from '../lib/firebase';
import { listenToRefugoScans, RefugoScan } from '../lib/firebase-core';
import { listenExpedicaoShared } from '../lib/expedicaoSync';
import { ExpedicaoStore, enrichExpedicao, EnrichedExpedicaoRow, BaseDespachoRow } from '../lib/expedicao';
import { getLocalValue } from '../lib/localPersistence';

interface IdLookupProps {
  rows: CsvRow[];
  onNavigateToUpload: () => void;
}

function cycleOnly(value?: string): string {
  const text = String(value || '').trim().toUpperCase();
  const match = text.match(/(?:^|[^A-Z])(AM|PM|SD)(?=$|[^A-Z])/);
  return match?.[1] || text || '—';
}

export function parseFlexibleTimestamp(value: unknown): number {
  if (!value) return 0;
  if (typeof value === 'number') {
    if (value > 10_000_000_000_000) return Math.floor(value / 1000);
    if (value > 1_000_000_000_000) return value;
    if (value > 1_000_000_000) return value * 1000;
    return value;
  }
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? 0 : value.getTime();
  }
  if (typeof value === 'object' && value !== null) {
    const anyVal = value as any;
    if (typeof anyVal.toDate === 'function') {
      try { return anyVal.toDate().getTime(); } catch {}
    }
    if (typeof anyVal.seconds === 'number') {
      return anyVal.seconds * 1000 + (anyVal.nanoseconds ? Math.floor(anyVal.nanoseconds / 1e6) : 0);
    }
  }

  const str = String(value).trim();
  if (!str) return 0;

  if (/^\d{10,13}$/.test(str)) {
    const num = Number(str);
    return num > 1_000_000_000_000 ? num : num * 1000;
  }

  const brMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})(?:[,\s]+(\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/);
  if (brMatch) {
    const day = parseInt(brMatch[1], 10);
    const month = parseInt(brMatch[2], 10) - 1;
    const year = parseInt(brMatch[3], 10);
    const hour = brMatch[4] ? parseInt(brMatch[4], 10) : 0;
    const minute = brMatch[5] ? parseInt(brMatch[5], 10) : 0;
    const second = brMatch[6] ? parseInt(brMatch[6], 10) : 0;
    const d = new Date(year, month, day, hour, minute, second);
    if (!isNaN(d.getTime())) return d.getTime();
  }

  const parsed = Date.parse(str);
  if (!isNaN(parsed)) return parsed;

  return 0;
}

export function formatFriendlyDate(timestampOrStr: number | string): string {
  if (!timestampOrStr) return '—';
  const ts = typeof timestampOrStr === 'number' ? timestampOrStr : parseFlexibleTimestamp(timestampOrStr);
  if (!ts) return String(timestampOrStr);

  const d = new Date(ts);
  const now = new Date();
  const isToday = d.getDate() === now.getDate() && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.getDate() === yesterday.getDate() && d.getMonth() === yesterday.getMonth() && d.getFullYear() === yesterday.getFullYear();

  const timeStr = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const dateStr = d.toLocaleDateString('pt-BR');

  if (isToday) return `Hoje às ${timeStr}`;
  if (isYesterday) return `Ontem às ${timeStr}`;
  return `${dateStr} às ${timeStr}`;
}

export const IdLookup: React.FC<IdLookupProps> = ({ rows, onNavigateToUpload }) => {
  const [inputText, setInputText] = useState<string>('');
  const [saidaFilter, setSaidaFilter] = useState<string>('');
  const [movimentoFilter, setMovimentoFilter] = useState<'todos' | 'vaga' | 'refugo' | 'lista' | 'base_csv' | 'nao_localizado'>('todos');
  const [copied, setCopied] = useState<boolean>(false);
  const [copiedDetailIdx, setCopiedDetailIdx] = useState<number | null>(null);
  const [expandedRowIdx, setExpandedRowIdx] = useState<number | null>(null);
  const [listas, setListas] = useState<ColetaLista[]>([]);
  const [refugoScans, setRefugoScans] = useState<RefugoScan[]>([]);
  const [expStore, setExpStore] = useState<ExpedicaoStore | null>(null);
  const [showGruposModal, setShowGruposModal] = useState(false);
  const [serverFoundMap, setServerFoundMap] = useState<Map<string, { item: ColetaItem; listaId: string }>>(new Map());
  const [isSearchingLists, setIsSearchingLists] = useState(false);
  const [listSearchError, setListSearchError] = useState('');

  // Paginação da Consulta de IDs para suportar 9.000+ IDs sem travar
  const [lookupPage, setLookupPage] = useState<number>(1);
  const [lookupPageSize, setLookupPageSize] = useState<number>(100);
  const [jumpLookupPageInput, setJumpLookupPageInput] = useState<string>('1');

  useEffect(() => {
    const unsubscribe = listenToListas((data) => setListas(data));
    return () => unsubscribe();
  }, []);

  // Escutar scans de Refugo em tempo real
  useEffect(() => {
    const unsubRefugo = listenToRefugoScans(scans => {
      setRefugoScans(scans || []);
    });
    return () => unsubRefugo();
  }, []);

  // Carregar e escutar Expedição / Controle de Docas (Aduana, Auditoria e Base Despacho)
  useEffect(() => {
    let active = true;
    getLocalValue<ExpedicaoStore>('expedicao_store_v1').then(saved => {
      if (active && saved) {
        setExpStore(saved);
      }
    });

    const unsubExp = listenExpedicaoShared(remote => {
      if (active && remote) {
        setExpStore(prev => ({
          base: [],
          aduana: [],
          auditoria: [],
          ...prev,
          ...remote
        } as ExpedicaoStore));
      }
    });

    return () => {
      active = false;
      unsubExp();
    };
  }, []);

  // Busca diretamente no servidor Firestore quando os termos de pesquisa mudam
  useEffect(() => {
    if (!inputText || !inputText.trim()) {
      setServerFoundMap(new Map());
      setIsSearchingLists(false);
      setListSearchError('');
      return;
    }
    const rawTerms = inputText
      .split(/[\n\r,;\t\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    if (rawTerms.length === 0) return;

    let cancelled = false;
    setIsSearchingLists(true);
    setListSearchError('');
    const timer = setTimeout(async () => {
      try {
        const results = await searchItemsAcrossAllListas(rawTerms);
        if (cancelled) return;
        setServerFoundMap(results);
      } catch (error) {
        if (cancelled) return;
        console.error('Falha ao buscar IDs nas listas e grupos:', error);
        setServerFoundMap(new Map());
        setListSearchError('A busca nas listas está temporariamente indisponível. A cota do Firebase precisa ser restabelecida.');
      } finally {
        if (!cancelled) setIsSearchingLists(false);
      }
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [inputText]);

  // Indexação de scans de Refugo
  const refugoMap = useMemo(() => {
    const map = new Map<string, RefugoScan>();
    refugoScans.forEach(scan => {
      if (scan.id) {
        map.set(scan.id.trim().toUpperCase(), scan);
      }
      if (scan.normalizedId) {
        map.set(scan.normalizedId.trim().toUpperCase(), scan);
      }
      const digits = cleanDigits(scan.id || scan.normalizedId);
      if (digits) {
        map.set(digits, scan);
      }
    });
    return map;
  }, [refugoScans]);

  // Indexação de Expedição (Aduana, Auditoria e Base Despacho)
  const expedicaoMaps = useMemo(() => {
    const enrichedMap = new Map<string, EnrichedExpedicaoRow>();
    const baseMap = new Map<string, BaseDespachoRow>();

    if (expStore) {
      try {
        const enriched = enrichExpedicao(expStore);
        enriched.forEach(row => {
          if (row.pacote) {
            const upper = row.pacote.trim().toUpperCase();
            enrichedMap.set(upper, row);
            const digits = cleanDigits(row.pacote);
            if (digits) enrichedMap.set(digits, row);
          }
        });
      } catch (err) {
        console.warn('Erro ao enriquecer expedição na consulta:', err);
      }

      if (Array.isArray(expStore.base)) {
        expStore.base.forEach(row => {
          if (row.pacote) {
            const upper = row.pacote.trim().toUpperCase();
            baseMap.set(upper, row);
            const digits = cleanDigits(row.pacote);
            if (digits) baseMap.set(digits, row);
          }
        });
      }
    }

    return { enrichedMap, baseMap };
  }, [expStore]);

  const matches: LookupMatch[] = useMemo(() => {
    if (!inputText || !inputText.trim()) return [];

    const rawTerms = inputText
      .split(/[\n\r,;\t\s]+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 0);

    const processedTerms = new Set<string>();
    const results: LookupMatch[] = [];

    for (const term of rawTerms) {
      if (processedTerms.has(term)) continue;
      processedTerms.add(term);

      const cleanTerm = cleanDigits(term);
      const termUpper = term.toUpperCase();
      const movimentos: PacoteMovimento[] = [];

      // 1. Procurar nas linhas da base carregada via CSV (se houver)
      const matchedRow = rows && rows.length > 0 ? rows.find((r) => {
        if (r.id === term || r.originalId === term) return true;
        if (cleanTerm.length > 0 && r.cleanId === cleanTerm) return true;
        if (r.id.includes(term)) return true;
        if (r.concat && (r.concat === term || cleanDigits(r.concat) === cleanTerm)) return true;
        return false;
      }) : undefined;

      // 2. Procurar nos resultados do servidor Firestore (Listas de Coleta)
      const foundEntry = serverFoundMap.get(termUpper) || (cleanTerm ? serverFoundMap.get(cleanTerm) : undefined);
      let foundInLista: { item: ColetaItem; lista: ColetaLista; grupoNome?: string } | null = null;

      if (foundEntry) {
        const lista = listas.find(l => l.id === foundEntry.listaId);
        if (lista) {
          let grupoNome = '';
          if (foundEntry.item.grupoId && lista.grupos) {
            const g = lista.grupos.find((grp) => grp.id === foundEntry.item.grupoId);
            if (g) grupoNome = g.nome;
          }
          foundInLista = { item: foundEntry.item, lista, grupoNome };
        }
      }

      // Extrair dados da lista de coleta encontrada
      const motivoLista = foundInLista?.item.motivo || foundInLista?.lista.motivoPadrao || '';
      const saidaLista = foundInLista?.item.saida || foundInLista?.lista.saidaPadrao || '';
      const grupoLista = foundInLista?.grupoNome || '';
      const nomeLista = foundInLista?.lista.nome || '';
      const bipadoPor = foundInLista?.item.responsavel || foundInLista?.lista.responsavel || '';
      const horarioBip = foundInLista?.item.scannedAt || '';
      const rotaLista = foundInLista?.item.rota || foundInLista?.lista.rota || '';

      // --- LEVANTAMENTO DE TODOS OS MOVIMENTOS REGISTRADOS ---

      // A) Movimento no Refugo
      const refugoScan = refugoMap.get(termUpper) || (cleanTerm ? refugoMap.get(cleanTerm) : undefined);
      if (refugoScan) {
        const tsRefugo = refugoScan.timestamp || parseFlexibleTimestamp(refugoScan.scannedAt);
        movimentos.push({
          tipo: 'refugo',
          titulo: 'Mesa de Refugo',
          localizacao: 'Refugo Operacional',
          responsavel: refugoScan.foundBy || 'Operador Refugo',
          rota: refugoScan.rota || '',
          status: refugoScan.status === 'found' ? 'Localizado no Refugo' : 'Bipado no Refugo',
          detalhe: refugoScan.status === 'found' ? 'Pacote encontrado e bipado na mesa de refugo' : 'Bipado no refugo',
          dataHora: refugoScan.scannedAt ? formatFriendlyDate(refugoScan.scannedAt) : (tsRefugo ? formatFriendlyDate(tsRefugo) : 'Registrado no Refugo'),
          timestamp: tsRefugo,
        });
      }

      // B) Movimento em Vaga / Expedição (Docas)
      const expRow = expedicaoMaps.enrichedMap.get(termUpper) || (cleanTerm ? expedicaoMaps.enrichedMap.get(cleanTerm) : undefined);
      const baseRow = expedicaoMaps.baseMap.get(termUpper) || (cleanTerm ? expedicaoMaps.baseMap.get(cleanTerm) : undefined);

      if (expRow || baseRow) {
        const rawVaga = expRow?.vagaOperacional || expRow?.encontradoDoca || expRow?.doca || baseRow?.doca || '';
        const cleanVaga = rawVaga.replace(/\D/g, '') || rawVaga;
        const vagaLabel = cleanVaga ? `Vaga ${cleanVaga}` : 'Docas / Expedição';
        const origemExp = expRow?.origem || (baseRow ? 'despacho' : '');
        const rotaExp = expRow?.encontradoRota || expRow?.destinoRota || expRow?.rotaInformada || baseRow?.rotaOtimizada || '';
        const placaExp = expRow?.encontradoPlaca || expRow?.placa || expRow?.placaInformada || baseRow?.placa || '';
        const dataReg = expRow?.dataRegistro || expStore?.updatedAt || '';
        const tsExp = parseFlexibleTimestamp(dataReg);

        movimentos.push({
          tipo: 'vaga',
          titulo: vagaLabel,
          localizacao: cleanVaga
            ? `Vaga ${cleanVaga} (${origemExp === 'aduana' ? 'Aduana' : origemExp === 'auditoria' ? 'Auditoria' : 'Base Despacho'})`
            : 'Controle de Docas',
          vaga: cleanVaga || rawVaga,
          rota: rotaExp,
          placa: placaExp,
          status: expRow?.classificacao ? `Classificação: ${expRow.classificacao}` : (origemExp === 'aduana' ? 'Aduana' : origemExp === 'auditoria' ? 'Auditoria' : 'Despacho'),
          detalhe: `${expRow?.classificacao ? `Classificado como ${expRow.classificacao}` : 'Endereçado na doca'}${rotaExp ? ` • Rota ${rotaExp}` : ''}${placaExp ? ` • Placa ${placaExp}` : ''}`,
          dataHora: dataReg ? formatFriendlyDate(dataReg) : 'Registrado em Docas',
          timestamp: tsExp,
        });
      }

      // C) Movimento em Lista de Coleta
      if (foundInLista) {
        const tsLista = parseFlexibleTimestamp(horarioBip) || parseFlexibleTimestamp(foundInLista.lista.data);
        movimentos.push({
          tipo: 'lista',
          titulo: `Lista: ${nomeLista}`,
          localizacao: `${nomeLista}${grupoLista ? ` (${grupoLista})` : ''}`,
          motivo: motivoLista,
          saida: saidaLista,
          rota: rotaLista,
          responsavel: bipadoPor,
          status: 'Bipado na Lista de Coleta',
          detalhe: `Motivo: ${motivoLista || 'Padrão'} | Saída: ${saidaLista || '—'}${bipadoPor ? ` | Bipado por ${bipadoPor}` : ''}`,
          dataHora: horarioBip ? formatFriendlyDate(horarioBip) : (foundInLista.lista.data || 'Hoje'),
          timestamp: tsLista,
        });
      }

      // D) Movimento na Base CSV carregada
      if (matchedRow) {
        movimentos.push({
          tipo: 'base_csv',
          titulo: 'Base CSV',
          localizacao: `Grupo: ${matchedRow.group}`,
          motivo: matchedRow.motivo,
          saida: matchedRow.saida,
          rota: matchedRow.concat,
          status: 'Carregado no Coletor',
          detalhe: `Saída: ${matchedRow.saida || '—'} | Motivo: ${matchedRow.motivo || '—'}`,
          dataHora: 'Carga inicial CSV',
          timestamp: 1, // Prioridade inicial base
        });
      }

      // ORDENAR: O movimento com o timestamp mais recente (maior) fica no topo (índice 0)
      movimentos.sort((a, b) => b.timestamp - a.timestamp);
      const ultimoMovimento = movimentos.length > 0 ? movimentos[0] : undefined;
      const isFound = movimentos.length > 0;

      // Monta o CsvRow consolidado para exibição e cópia
      let finalRow: CsvRow | undefined = undefined;

      if (matchedRow) {
        finalRow = {
          ...matchedRow,
          motivo: motivoLista || matchedRow.motivo || '',
          saida: saidaLista || matchedRow.saida || '',
          group: grupoLista || matchedRow.group,
          rawFields: {
            ...matchedRow.rawFields,
            ...(nomeLista ? { 'Lista de Coleta': nomeLista } : {}),
            ...(motivoLista ? { 'Motivo da Lista': motivoLista } : {}),
            ...(saidaLista ? { 'Saída da Lista': saidaLista } : {}),
            ...(bipadoPor ? { 'Bipado por': bipadoPor } : {}),
            ...(horarioBip ? { 'Horário do Bip': horarioBip } : {}),
            ...(rotaLista ? { 'Rota': rotaLista } : {}),
            ...(ultimoMovimento ? { 'Último Movimento': `${ultimoMovimento.titulo} (${ultimoMovimento.dataHora})` } : {}),
            ...(ultimoMovimento?.vaga ? { 'Vaga Atual': ultimoMovimento.vaga } : {}),
          }
        };
      } else if (foundInLista) {
        finalRow = {
          id: cleanTerm || term,
          originalId: term,
          cleanId: cleanTerm,
          group: grupoLista || (foundInLista.lista.tipo === 'grupos' ? 'Multirotas' : foundInLista.lista.nome),
          saida: saidaLista,
          motivo: motivoLista,
          concat: rotaLista,
          rawFields: {
            'Origem': 'Lista de Coleta',
            'Lista de Coleta': nomeLista,
            'Rota': rotaLista,
            'Saída': saidaLista,
            'Motivo': motivoLista,
            'Bipado por': bipadoPor,
            'Data / Hora': horarioBip,
            'Tipo de Lista': foundInLista.lista.tipo === 'grupos' ? 'Com Grupos' : 'Lista Comum',
            ...(ultimoMovimento ? { 'Último Movimento': `${ultimoMovimento.titulo} (${ultimoMovimento.dataHora})` } : {}),
            ...(ultimoMovimento?.vaga ? { 'Vaga Atual': ultimoMovimento.vaga } : {}),
          },
          rowIndex: -1
        };
      } else if (ultimoMovimento) {
        // Encontrado no Refugo ou em Vaga de Docas
        finalRow = {
          id: cleanTerm || term,
          originalId: term,
          cleanId: cleanTerm,
          group: ultimoMovimento.titulo,
          saida: ultimoMovimento.saida || '',
          motivo: ultimoMovimento.motivo || '',
          concat: ultimoMovimento.rota || '',
          rawFields: {
            'Origem': ultimoMovimento.titulo,
            'Último Movimento': ultimoMovimento.localizacao,
            'Data / Hora': ultimoMovimento.dataHora,
            ...(ultimoMovimento.vaga ? { 'Vaga Atual': ultimoMovimento.vaga } : {}),
            ...(ultimoMovimento.rota ? { 'Rota': ultimoMovimento.rota } : {}),
            ...(ultimoMovimento.placa ? { 'Placa': ultimoMovimento.placa } : {}),
            ...(ultimoMovimento.responsavel ? { 'Responsável': ultimoMovimento.responsavel } : {}),
            ...(ultimoMovimento.detalhe ? { 'Detalhes': ultimoMovimento.detalhe } : {}),
          },
          rowIndex: -1
        };
      }

      results.push({
        searchTerm: term,
        cleanSearchTerm: cleanTerm,
        found: isFound,
        row: finalRow,
        matchedGroup: finalRow?.group || (isFound ? ultimoMovimento?.titulo : undefined),
        ultimoMovimento,
        movimentos,
      });
    }

    return results;
  }, [inputText, rows, listas, serverFoundMap, refugoMap, expedicaoMaps, expStore]);

  // Contadores para os filtros rápidos de último movimento
  const countStats = useMemo(() => {
    let total = matches.length;
    let vaga = 0;
    let refugo = 0;
    let lista = 0;
    let baseCsv = 0;
    let naoLocalizado = 0;

    matches.forEach(m => {
      if (!m.found || !m.ultimoMovimento) {
        naoLocalizado++;
      } else if (m.ultimoMovimento.tipo === 'vaga') {
        vaga++;
      } else if (m.ultimoMovimento.tipo === 'refugo') {
        refugo++;
      } else if (m.ultimoMovimento.tipo === 'lista') {
        lista++;
      } else if (m.ultimoMovimento.tipo === 'base_csv') {
        baseCsv++;
      }
    });

    return { total, vaga, refugo, lista, baseCsv, naoLocalizado };
  }, [matches]);

  // Extract unique Saída values from found search matches (or loaded rows if no search)
  const availableSaidas = useMemo(() => {
    const set = new Set<string>();
    const foundRows = matches.length > 0
      ? matches.filter((m) => m.found && m.row).map((m) => m.row!)
      : rows;

    foundRows.forEach((r) => {
      if (r.saida && r.saida.trim()) {
        set.add(cycleOnly(r.saida));
      }
    });
    return Array.from(set).sort();
  }, [rows, matches]);

  // Apply Saída and Movimento filters & sort by Group / Último Movimento then ID
  const filteredMatches = useMemo(() => {
    let list = matches;

    // Filtro por Último Movimento
    if (movimentoFilter !== 'todos') {
      list = list.filter((m) => {
        if (movimentoFilter === 'nao_localizado') return !m.found;
        if (!m.found || !m.ultimoMovimento) return false;
        return m.ultimoMovimento.tipo === movimentoFilter;
      });
    }

    // Filtro por Saída
    if (saidaFilter) {
      list = list.filter((m) => {
        if (!m.found || !m.row) return false;
        return (m.row.saida || '').toLowerCase().includes(saidaFilter.toLowerCase());
      });
    }

    return [...list].sort((a, b) => {
      // Put found items before unfound items
      if (a.found && !b.found) return -1;
      if (!a.found && b.found) return 1;

      // Both found: sort by timestamp of último movimento (most recent first)
      if (a.found && b.found) {
        const tsA = a.ultimoMovimento?.timestamp || 0;
        const tsB = b.ultimoMovimento?.timestamp || 0;
        if (tsA !== tsB) return tsB - tsA;

        const groupA = a.row?.group || a.ultimoMovimento?.titulo || '';
        const groupB = b.row?.group || b.ultimoMovimento?.titulo || '';
        const groupComparison = groupA.localeCompare(groupB, undefined, {
          numeric: true,
          sensitivity: 'base',
        });
        if (groupComparison !== 0) return groupComparison;

        const idA = a.row?.id || a.cleanSearchTerm || a.searchTerm;
        const idB = b.row?.id || b.cleanSearchTerm || b.searchTerm;
        return idA.localeCompare(idB, undefined, { numeric: true, sensitivity: 'base' });
      }

      // Both not found: sort by search term
      return a.searchTerm.localeCompare(b.searchTerm, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [matches, saidaFilter, movimentoFilter]);

  useEffect(() => {
    setLookupPage(1);
    setJumpLookupPageInput('1');
  }, [inputText, saidaFilter]);

  const totalLookupPages = Math.max(1, Math.ceil(filteredMatches.length / lookupPageSize));

  useEffect(() => {
    if (lookupPage > totalLookupPages) {
      setLookupPage(totalLookupPages);
      setJumpLookupPageInput(String(totalLookupPages));
    }
  }, [totalLookupPages, lookupPage]);

  const startLookupIndex = (lookupPage - 1) * lookupPageSize;
  const endLookupIndex = Math.min(filteredMatches.length, startLookupIndex + lookupPageSize);

  const displayedMatches = useMemo(() => {
    return filteredMatches.slice(startLookupIndex, endLookupIndex);
  }, [filteredMatches, startLookupIndex, endLookupIndex]);

  const renderLookupPagination = (position: 'top' | 'bottom') => {
    if (filteredMatches.length === 0) return null;

    const delta = 2;
    const range: number[] = [];
    for (let i = 1; i <= totalLookupPages; i++) {
      if (i === 1 || i === totalLookupPages || (i >= lookupPage - delta && i <= lookupPage + delta)) {
        range.push(i);
      }
    }

    const rangeWithDots: (number | string)[] = [];
    let prevNum: number | undefined;
    for (const num of range) {
      if (prevNum) {
        if (num - prevNum === 2) {
          rangeWithDots.push(prevNum + 1);
        } else if (num - prevNum !== 1) {
          rangeWithDots.push('...');
        }
      }
      rangeWithDots.push(num);
      prevNum = num;
    }

    const handleJump = (e: React.FormEvent) => {
      e.preventDefault();
      const p = parseInt(jumpLookupPageInput, 10);
      if (!isNaN(p) && p >= 1 && p <= totalLookupPages) {
        setLookupPage(p);
      } else {
        setJumpLookupPageInput(String(lookupPage));
      }
    };

    return (
      <div className={`px-4 py-2.5 bg-gray-50 border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600 ${
        position === 'top' ? 'border-b rounded-t-lg' : 'border-t rounded-b-lg'
      }`}>
        <div className="flex items-center gap-2 flex-wrap">
          <span>
            Mostrando <strong className="text-gray-900 font-mono">{filteredMatches.length === 0 ? 0 : startLookupIndex + 1}</strong>–<strong className="text-gray-900 font-mono">{endLookupIndex}</strong> de <strong className="text-[#3483FA] font-mono">{filteredMatches.length.toLocaleString('pt-BR')}</strong> IDs
          </span>
          <span className="text-gray-300 hidden sm:inline">|</span>
          <span className="text-gray-500">
            Pág. <strong className="text-gray-800 font-mono">{lookupPage}</strong> de <strong className="text-gray-800 font-mono">{totalLookupPages}</strong>
          </span>
        </div>

        <div className="flex items-center gap-1 flex-wrap justify-center">
          <button
            type="button"
            onClick={() => { setLookupPage(1); setJumpLookupPageInput('1'); }}
            disabled={lookupPage === 1}
            className="p-2 sm:p-1.5 min-h-[38px] min-w-[38px] sm:min-h-[28px] sm:min-w-[28px] flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs font-bold"
            title="Primeira página"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              const nextP = Math.max(1, lookupPage - 1);
              setLookupPage(nextP);
              setJumpLookupPageInput(String(nextP));
            }}
            disabled={lookupPage === 1}
            className="p-2 sm:p-1.5 min-h-[38px] min-w-[38px] sm:min-h-[28px] sm:min-w-[28px] flex items-center justify-center rounded-lg border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs font-bold"
            title="Página anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="hidden sm:flex items-center gap-1">
            {rangeWithDots.map((p, idx) => {
              if (p === '...') {
                return <span key={`ellipsis-lookup-${position}-${idx}`} className="px-1 text-gray-400 font-mono select-none">...</span>;
              }
              const isCurrent = p === lookupPage;
              return (
                <button
                  key={`page-lookup-${position}-${p}`}
                  type="button"
                  onClick={() => { setLookupPage(Number(p)); setJumpLookupPageInput(String(p)); }}
                  className={`min-w-[28px] h-7 px-1.5 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
                    isCurrent
                      ? 'bg-[#3483FA] text-white shadow-sm'
                      : 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-100'
                  }`}
                >
                  {p}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => {
              const nextP = Math.min(totalLookupPages, lookupPage + 1);
              setLookupPage(nextP);
              setJumpLookupPageInput(String(nextP));
            }}
            disabled={lookupPage >= totalLookupPages}
            className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs font-bold"
            title="Próxima página"
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => { setLookupPage(totalLookupPages); setJumpLookupPageInput(String(totalLookupPages)); }}
            disabled={lookupPage >= totalLookupPages}
            className="p-1.5 rounded border border-gray-300 bg-white text-gray-700 hover:bg-gray-100 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer transition-colors shadow-2xs font-bold"
            title="Última página"
          >
            <ChevronsRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500">Por pág:</span>
            <select
              value={lookupPageSize}
              onChange={(e) => {
                setLookupPageSize(Number(e.target.value));
                setLookupPage(1);
                setJumpLookupPageInput('1');
              }}
              className="px-2 py-1 bg-white border border-gray-300 rounded text-xs font-bold text-gray-700 outline-none focus:border-[#3483FA] cursor-pointer"
            >
              <option value={50}>50</option>
              <option value={100}>100</option>
              <option value={250}>250</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>

          <form onSubmit={handleJump} className="flex items-center gap-1">
            <span className="text-[11px] text-gray-500">Ir:</span>
            <input
              type="number"
              min={1}
              max={totalLookupPages}
              value={jumpLookupPageInput}
              onChange={(e) => setJumpLookupPageInput(e.target.value)}
              onBlur={handleJump}
              className="w-12 px-1 py-1 bg-white border border-gray-300 rounded text-xs font-mono font-bold text-center text-gray-800 outline-none focus:border-[#3483FA]"
            />
          </form>
        </div>
      </div>
    );
  };

  const [copiedWithMovimento, setCopiedWithMovimento] = useState(false);

  const handleCopyResultsWithMovimento = () => {
    if (filteredMatches.length === 0) return;
    const header = ['ID_PACOTE', 'ULTIMO_MOVIMENTO', 'LOCAL_VAGA', 'DATA_HORA', 'ROTA', 'PLACA', 'RESPONSAVEL', 'GRUPO', 'SAIDA', 'MOTIVO'].join('\t');
    const rows = filteredMatches.map((m) => {
      const mov = m.ultimoMovimento;
      const statusTitle = mov ? mov.titulo : 'NÃO ENCONTRADO';
      const localVaga = mov?.vaga ? `VAGA ${mov.vaga}` : (mov?.localizacao || '');
      const dataHora = mov?.dataHora || '';
      const rota = mov?.rota || m.row?.concat || m.row?.rawFields?.['Rota'] || '';
      const placa = mov?.placa || m.row?.rawFields?.['Placa'] || '';
      const resp = mov?.responsavel || m.row?.rawFields?.['Bipado por'] || '';
      const grupo = m.row?.group || mov?.titulo || '';
      const saida = cycleOnly(m.row?.saida || mov?.saida);
      const motivo = m.row?.motivo || mov?.motivo || '';

      return [m.searchTerm, statusTitle, localVaga, dataHora, rota, placa, resp, grupo, saida, motivo].join('\t');
    });

    navigator.clipboard.writeText([header, ...rows].join('\n'));
    setCopiedWithMovimento(true);
    setTimeout(() => setCopiedWithMovimento(false), 2000);
  };

  const handleCopyResultsText = () => {
    if (filteredMatches.length === 0) return;
    const header = ['ID', 'GRUPO', 'SAÍDA', 'MOTIVO', 'ULTIMO_MOVIMENTO'].join('\t');
    const rows = filteredMatches.map((m) => {
      if (m.found && m.row) {
        return [
          m.searchTerm,
          m.row.group,
          cycleOnly(m.row.saida),
          m.row.motivo || '',
          m.ultimoMovimento ? `${m.ultimoMovimento.titulo} (${m.ultimoMovimento.dataHora})` : ''
        ].join('\t');
      }
      return [m.searchTerm, 'NÃO ENCONTRADO', '', '', ''].join('\t');
    });

    navigator.clipboard.writeText([header, ...rows].join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopySingleRowDetail = (match: LookupMatch, idx: number) => {
    const mov = match.ultimoMovimento;
    const groupText = match.found && match.row ? match.row.group : (mov?.titulo || 'NÃO ENCONTRADO');
    const saidaText = match.found && match.row ? cycleOnly(match.row.saida) : '';
    const motivoText = match.found && match.row ? (match.row.motivo || '') : '';
    const ultimoMovText = mov ? `${mov.titulo} - ${mov.localizacao} (${mov.dataHora})` : 'NÃO ENCONTRADO';
    const header = ['ID', 'ULTIMO_MOVIMENTO', 'GRUPO', 'SAÍDA', 'MOTIVO'].join('\t');
    const row = [match.searchTerm, ultimoMovText, groupText, saidaText, motivoText].join('\t');

    navigator.clipboard.writeText(`${header}\n${row}`);
    setCopiedDetailIdx(idx);
    setTimeout(() => setCopiedDetailIdx(null), 2000);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      const rawLines = content.split(/\r?\n/);
      const validLines = rawLines.filter((l) => l.trim() !== '');

      if (validLines.length <= 1) {
        setInputText('');
        return;
      }

      // Ignore index 0 (A1 header), process index 1 onwards (A2, A3...)
      const extractedIds: string[] = [];
      for (let i = 1; i < validLines.length; i++) {
        const line = validLines[i].trim();
        if (!line) continue;

        // Get value from Column A (first column before delimiter)
        const firstCol = line.split(/[,;\t]/)[0]?.trim().replace(/^["']|["']$/g, '');
        if (firstCol) {
          extractedIds.push(firstCol);
        }
      }

      setInputText(extractedIds.join('\n'));
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  return (
    <div className="space-y-4">
      {/* Top Search Input Box */}
      <div className="bg-white border border-gray-200 rounded-2xl shadow-sm flex flex-col overflow-hidden">
        {/* Beautiful Header */}
        <div className="bg-gray-50/80 border-b border-gray-100 px-5 py-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 shadow-sm border border-blue-200">
              <Search className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-gray-900 uppercase tracking-widest flex items-center gap-2">
                <span>Consulta de Pacotes</span>
                <span className="bg-amber-100 text-amber-900 px-2 py-0.5 rounded text-[10px] font-black uppercase border border-amber-300">
                  Rastreador de Último Movimento
                </span>
              </h2>
              <p className="text-xs text-gray-500 mt-0.5">
                Localiza o último movimento do pacote entre Refugo, Listas de Coleta, Vagas de Docas e Base CSV.
              </p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowGruposModal(true)}
              className="inline-flex items-center gap-2 px-3 py-1.5 bg-purple-50 border border-purple-200 hover:bg-purple-100 hover:border-purple-300 text-purple-700 rounded-lg text-xs font-bold transition-all shadow-sm cursor-pointer"
            >
              <ListPlus className="w-4 h-4 text-purple-600" />
              <span className="hidden sm:inline">Importar Grupo</span>
            </button>
            <label className="cursor-pointer inline-flex items-center gap-2 px-3 py-1.5 bg-white border border-gray-200 hover:bg-gray-50 hover:border-gray-300 text-gray-700 rounded-lg text-xs font-bold transition-all shadow-sm">
              <Upload className="w-4 h-4 text-blue-600" />
              <span>Adicionar CSV (opcional)</span>
              <input type="file" accept=".csv,.txt,.tsv" onChange={handleFileUpload} className="hidden" />
            </label>

            {rows.length > 0 && (
              <span className="hidden sm:inline-block text-[11px] font-mono text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md border border-gray-200 font-bold">
                {rows.length} base
              </span>
            )}
          </div>
        </div>

        {/* Clean Textarea Section */}
        <div className="p-5">
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden focus-within:ring-4 focus-within:ring-blue-500/15 focus-within:border-blue-500 transition-all">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Cole os IDs aqui (separados por linha, vírgula, tabulação ou espaço)...&#10;&#10;Ex:&#10;48190992568&#10;48239018160"
              rows={5}
              className="w-full bg-transparent border-0 focus:ring-0 outline-none p-5 text-gray-900 font-mono text-sm leading-relaxed placeholder:text-gray-400 resize-y min-h-[120px]"
            />
            
            <div className="bg-gray-50/50 border-t border-gray-100 px-5 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                {inputText.trim() !== "" ? (
                  <span className="bg-blue-50 text-blue-800 border border-blue-200 px-2.5 py-1 rounded-md text-[11px] font-mono font-bold flex items-center gap-1.5 shadow-sm">
                    <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
                    {isSearchingLists
                      ? 'Cruzando movimentos (Refugo, Listas e Vagas)...'
                      : `${matches.length} ${matches.length === 1 ? "ID detectado" : "IDs detectados"}`}
                  </span>
                ) : (
                  <span className="text-xs font-mono text-gray-400 font-medium">Nenhum ID informado</span>
                )}
              </div>

              {inputText && (
                <button
                  onClick={() => setInputText("")}
                  className="text-gray-500 hover:text-red-600 hover:bg-red-50 px-3 py-1.5 rounded-lg text-xs font-bold transition-colors flex items-center gap-1.5"
                  title="Limpar campo de busca"
                >
                  <X className="w-4 h-4" />
                  Limpar
                </button>
              )}
            </div>
          </div>
          
          {listSearchError && (
            <div className="mt-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-xs font-medium text-red-800">
              <AlertCircle className="h-5 w-5 shrink-0 text-red-600" />
              <p>{listSearchError}</p>
            </div>
          )}
        </div>
      </div>

      {/* Results Header / Filters & Export Controls */}
      {matches.length > 0 && (
        <div className="space-y-2">
          {/* Barra de Filtros Rápidos por Último Movimento */}
          <div className="bg-white p-2.5 rounded-xl border border-gray-200 shadow-sm flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mr-1">Filtrar Último Movimento:</span>
              
              <button
                type="button"
                onClick={() => setMovimentoFilter('todos')}
                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  movimentoFilter === 'todos'
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                Todos ({countStats.total})
              </button>

              <button
                type="button"
                onClick={() => setMovimentoFilter('vaga')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  movimentoFilter === 'vaga'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100'
                }`}
              >
                <MapPin className="w-3.5 h-3.5" />
                Vaga / Docas ({countStats.vaga})
              </button>

              <button
                type="button"
                onClick={() => setMovimentoFilter('refugo')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  movimentoFilter === 'refugo'
                    ? 'bg-rose-600 text-white shadow-sm'
                    : 'bg-rose-50 text-rose-800 border border-rose-200 hover:bg-rose-100'
                }`}
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Refugo ({countStats.refugo})
              </button>

              <button
                type="button"
                onClick={() => setMovimentoFilter('lista')}
                className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                  movimentoFilter === 'lista'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-blue-50 text-blue-800 border border-blue-200 hover:bg-blue-100'
                }`}
              >
                <Layers className="w-3.5 h-3.5" />
                Lista de Coleta ({countStats.lista})
              </button>

              {countStats.baseCsv > 0 && (
                <button
                  type="button"
                  onClick={() => setMovimentoFilter('base_csv')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    movimentoFilter === 'base_csv'
                      ? 'bg-slate-700 text-white shadow-sm'
                      : 'bg-slate-100 text-slate-800 hover:bg-slate-200'
                  }`}
                >
                  <FileText className="w-3.5 h-3.5" />
                  Base CSV ({countStats.baseCsv})
                </button>
              )}

              {countStats.naoLocalizado > 0 && (
                <button
                  type="button"
                  onClick={() => setMovimentoFilter('nao_localizado')}
                  className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    movimentoFilter === 'nao_localizado'
                      ? 'bg-red-600 text-white shadow-sm'
                      : 'bg-red-50 text-red-800 border border-red-200 hover:bg-red-100'
                  }`}
                >
                  <AlertCircle className="w-3.5 h-3.5" />
                  Não Localizados ({countStats.naoLocalizado})
                </button>
              )}
            </div>

            {/* Saída Filter selector */}
            <div className="flex items-center gap-1.5 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1 text-xs font-mono">
              <Filter className="w-3.5 h-3.5 text-amber-600" />
              <span className="font-bold text-gray-500 uppercase">Saída:</span>
              {availableSaidas.length > 0 ? (
                <select
                  value={saidaFilter}
                  onChange={(e) => setSaidaFilter(e.target.value)}
                  className="bg-transparent text-gray-800 text-xs font-mono focus:outline-none cursor-pointer"
                >
                  <option value="">Todas</option>
                  {availableSaidas.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="text"
                  value={saidaFilter}
                  onChange={(e) => setSaidaFilter(e.target.value)}
                  placeholder="Filtrar saída..."
                  className="bg-transparent text-gray-800 text-xs font-mono focus:outline-none w-24 placeholder:text-gray-400"
                />
              )}
              {saidaFilter && (
                <button
                  onClick={() => setSaidaFilter('')}
                  className="text-gray-400 hover:text-red-600 ml-1"
                  title="Limpar filtro de saída"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {/* Barra de Ações e Exportação */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between bg-white px-3.5 py-2 rounded-xl border border-gray-200 shadow-sm gap-2">
            <div className="text-xs font-bold text-gray-700 uppercase tracking-wider flex flex-wrap items-center gap-2">
              <span>Resultados ({filteredMatches.length} de {matches.length})</span>
              <span className="text-[11px] text-gray-500 font-mono normal-case">
                ({filteredMatches.filter((m) => m.found).length} com movimento registrado)
              </span>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                onClick={handleCopyResultsWithMovimento}
                disabled={filteredMatches.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white font-black rounded-lg text-xs font-mono transition-colors shadow-sm uppercase tracking-wider cursor-pointer"
                title="Copia tabela completa com ID, Último Movimento, Local/Vaga, Horário, Rota e Motivo"
              >
                {copiedWithMovimento ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copiado com Sucesso!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar com Último Movimento</span>
                  </>
                )}
              </button>

              <button
                onClick={handleCopyResultsText}
                disabled={filteredMatches.length === 0}
                className="flex items-center justify-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-40 text-gray-950 font-black rounded-lg text-xs font-mono transition-colors shadow-sm uppercase tracking-wider cursor-pointer"
                title="Copia formato padrão ID + Grupo + Saída + Motivo"
              >
                {copied ? (
                  <>
                    <Check className="w-3.5 h-3.5" />
                    <span>Copiado!</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5" />
                    <span>Copiar Padrão</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Tabela de Resultados com Destaque de Último Movimento */}
      {inputText.trim() !== '' && matches.length === 0 ? (
        <div className="text-center py-8 bg-white border border-gray-200 rounded text-xs text-gray-500 font-mono">
          Nenhum resultado encontrado para os IDs informados.
        </div>
      ) : filteredMatches.length === 0 && matches.length > 0 ? (
        <div className="text-center py-8 bg-white border border-gray-200 rounded text-xs text-gray-500 font-mono">
          Nenhum resultado corresponde aos filtros aplicados.
        </div>
      ) : matches.length > 0 ? (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm flex flex-col">
          {renderLookupPagination('top')}
          <div className="overflow-x-auto app-scroll-x">
            <table className="w-full text-left text-xs font-mono min-w-[760px]">
              <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-200 uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="py-2.5 px-3 text-gray-400 w-10">#</th>
                  <th className="py-2.5 px-3">ID Pesquisado</th>
                  <th className="py-2.5 px-3 text-purple-700">Último Movimento (Mais Recente)</th>
                  <th className="py-2.5 px-3 text-emerald-700">Vaga / Local Atual</th>
                  <th className="py-2.5 px-3 text-amber-700">Grupo / Origem</th>
                  <th className="py-2.5 px-3">Saída</th>
                  <th className="py-2.5 px-3">Motivo</th>
                  <th className="py-2.5 px-3">Rota / Placa</th>
                  <th className="py-2.5 px-3 text-right">Ação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-800 text-[11px]">
                {displayedMatches.map((match, idx) => {
                  const globalIdx = startLookupIndex + idx;
                  const isExpanded = expandedRowIdx === globalIdx;
                  const mov = match.ultimoMovimento;

                  return (
                    <React.Fragment key={`${match.searchTerm}-${globalIdx}`}>
                      <tr
                        className={`transition-colors hover:bg-blue-50/40 ${
                          !match.found ? 'bg-red-50/30' : 'bg-white'
                        }`}
                      >
                        <td className="py-2.5 px-3 text-gray-400 text-[10px]">{globalIdx + 1}</td>

                        <td className="py-2.5 px-3 font-bold text-gray-900 whitespace-nowrap">
                          <div className="flex flex-col">
                            <span className="font-mono text-xs font-bold text-gray-900">{match.searchTerm}</span>
                            {match.movimentos && match.movimentos.length > 1 && (
                              <span className="text-[9px] text-purple-600 font-sans font-bold">
                                {match.movimentos.length} movimentos registrados
                              </span>
                            )}
                          </div>
                        </td>

                        {/* Coluna: Último Movimento */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {mov ? (
                            <div className="flex flex-col gap-0.5">
                              {mov.tipo === 'vaga' && (
                                <span className="inline-flex items-center gap-1.5 bg-emerald-100 text-emerald-900 font-black px-2 py-0.5 rounded text-[11px] border border-emerald-300 w-fit">
                                  <MapPin className="w-3.5 h-3.5 text-emerald-700" />
                                  <span>{mov.vaga ? `VAGA ${mov.vaga}` : mov.titulo}</span>
                                </span>
                              )}
                              {mov.tipo === 'refugo' && (
                                <span className="inline-flex items-center gap-1.5 bg-rose-100 text-rose-900 font-black px-2 py-0.5 rounded text-[11px] border border-rose-300 w-fit">
                                  <RotateCcw className="w-3.5 h-3.5 text-rose-700" />
                                  <span>REFUGO</span>
                                </span>
                              )}
                              {mov.tipo === 'lista' && (
                                <span className="inline-flex items-center gap-1.5 bg-blue-100 text-blue-900 font-black px-2 py-0.5 rounded text-[11px] border border-blue-300 w-fit">
                                  <Layers className="w-3.5 h-3.5 text-blue-700" />
                                  <span>LISTA DE COLETA</span>
                                </span>
                              )}
                              {mov.tipo === 'base_csv' && (
                                <span className="inline-flex items-center gap-1.5 bg-slate-100 text-slate-800 font-bold px-2 py-0.5 rounded text-[11px] border border-slate-300 w-fit">
                                  <FileText className="w-3.5 h-3.5 text-slate-600" />
                                  <span>BASE CSV</span>
                                </span>
                              )}
                              <span className="text-[10px] text-gray-500 font-sans flex items-center gap-1 font-medium">
                                <Clock className="w-2.5 h-2.5 text-gray-400" />
                                {mov.dataHora}
                                {mov.responsavel && (
                                  <span className="text-gray-400">• {mov.responsavel}</span>
                                )}
                              </span>
                            </div>
                          ) : (
                            <span className="inline-flex items-center gap-1 bg-red-50 text-red-700 font-bold px-2 py-0.5 rounded text-[10px] border border-red-200">
                              <AlertCircle className="w-3 h-3 text-red-500" />
                              NÃO LOCALIZADO
                            </span>
                          )}
                        </td>

                        {/* Coluna: Vaga / Local Atual */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {mov?.vaga ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold bg-emerald-50 text-emerald-800 border border-emerald-200 text-xs">
                              <MapPin className="w-3 h-3 text-emerald-600" />
                              Vaga {mov.vaga}
                            </span>
                          ) : mov ? (
                            <span className="text-gray-700 font-sans text-[11px] font-medium">
                              {mov.localizacao}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Coluna: Grupo Encontrado / Origem */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {match.found && match.row ? (
                            <div className="flex flex-col gap-0.5">
                              {match.row.group === 'ERROS' ? (
                                <span className="inline-flex items-center gap-1 bg-red-100 text-red-900 font-black px-2 py-0.5 rounded text-[11px] border border-red-300 w-fit">
                                  <AlertCircle className="w-3 h-3 text-red-600" />
                                  {match.row.group}
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-900 font-black px-2 py-0.5 rounded text-[11px] border border-amber-200 w-fit">
                                  <Layers className="w-3 h-3 text-amber-700" />
                                  <span>{match.row.group}</span>
                                </span>
                              )}
                              {match.row.rawFields?.['Lista de Coleta'] && (
                                <span className="text-[10px] font-sans font-semibold text-blue-700 truncate max-w-[220px]" title={`Lista: ${match.row.rawFields['Lista de Coleta']}`}>
                                  Lista: {match.row.rawFields['Lista de Coleta']}
                                </span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Coluna: Saída */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {match.found && (match.row?.saida || mov?.saida) ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-blue-50 text-blue-800 border border-blue-200">
                              {cycleOnly(match.row?.saida || mov?.saida)}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Coluna: Motivo */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {match.found && (match.row?.motivo || mov?.motivo) ? (
                            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-900 border border-amber-200">
                              {match.row?.motivo || mov?.motivo}
                            </span>
                          ) : (
                            <span className="text-gray-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Coluna: Rota / Placa */}
                        <td className="py-2.5 px-3 whitespace-nowrap">
                          {mov?.rota || match.row?.concat || mov?.placa ? (
                            <div className="flex flex-col text-[10px]">
                              {mov?.rota && (
                                <span className="font-bold text-amber-950 font-mono">Rota: {mov.rota}</span>
                              )}
                              {mov?.placa && (
                                <span className="text-gray-500 font-mono">Placa: {mov.placa}</span>
                              )}
                              {!mov?.rota && match.row?.concat && (
                                <span className="font-bold text-amber-950 font-mono">{match.row.concat}</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-gray-400 font-mono">—</span>
                          )}
                        </td>

                        {/* Coluna: Ações */}
                        <td className="py-2.5 px-3 whitespace-nowrap text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button
                              onClick={() => handleCopySingleRowDetail(match, globalIdx)}
                              className="px-2 py-1 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded border border-gray-300 text-[10px] font-mono font-medium transition-colors"
                              title="Copiar detalhes do ID"
                            >
                              {copiedDetailIdx === globalIdx ? (
                                <span className="text-green-600 font-bold">Copiado</span>
                              ) : (
                                <span>Copiar</span>
                              )}
                            </button>

                            {match.found && (
                              <button
                                onClick={() => setExpandedRowIdx(isExpanded ? null : globalIdx)}
                                className={`p-1 rounded border transition-colors ${
                                  isExpanded
                                    ? 'bg-amber-100 text-amber-900 border-amber-300'
                                    : 'text-gray-400 hover:text-gray-700 bg-gray-50 hover:bg-gray-100 border-gray-200'
                                }`}
                                title="Ver linha do tempo de movimentações"
                              >
                                {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>

                      {/* Expanded Details Row com Linha do Tempo de Movimentações */}
                      {isExpanded && match.found && (
                        <tr className="bg-amber-50/20 border-b border-gray-200">
                          <td colSpan={9} className="p-4">
                            <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm space-y-4">
                              {/* Header dos Detalhes */}
                              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 pb-3">
                                <div className="flex items-center gap-2">
                                  <div className="w-7 h-7 rounded-lg bg-purple-100 text-purple-700 flex items-center justify-center">
                                    <History className="w-4 h-4" />
                                  </div>
                                  <div>
                                    <h4 className="text-xs font-black uppercase text-gray-900 tracking-wide">
                                      Linha do Tempo de Movimentos do Pacote
                                    </h4>
                                    <p className="text-[10px] text-gray-500 font-mono">
                                      ID: <strong>{match.searchTerm}</strong> • Total de registros encontrados: <strong>{match.movimentos?.length || 0}</strong>
                                    </p>
                                  </div>
                                </div>

                                {match.ultimoMovimento && (
                                  <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-950 px-2.5 py-1 rounded-md text-[10px] font-black uppercase">
                                    <Sparkles className="w-3.5 h-3.5 text-amber-600" />
                                    Último Movimento: {match.ultimoMovimento.titulo} ({match.ultimoMovimento.dataHora})
                                  </span>
                                )}
                              </div>

                              {/* Timeline dos Movimentos */}
                              <div className="relative pl-4 space-y-3 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-gray-200">
                                {match.movimentos && match.movimentos.length > 0 ? (
                                  match.movimentos.map((mItem, mIdx) => {
                                    const isLatest = mIdx === 0;
                                    return (
                                      <div key={`${mItem.tipo}-${mIdx}`} className="relative pl-5">
                                        {/* Ponto indicador do timeline */}
                                        <div
                                          className={`absolute -left-2 top-2 w-4 h-4 rounded-full border-2 flex items-center justify-center ${
                                            isLatest
                                              ? 'bg-amber-400 border-amber-600 ring-2 ring-amber-300'
                                              : 'bg-white border-gray-400'
                                          }`}
                                        >
                                          {isLatest && <div className="w-1.5 h-1.5 bg-slate-900 rounded-full" />}
                                        </div>

                                        <div
                                          className={`p-3 rounded-lg border text-xs transition-all ${
                                            isLatest
                                              ? 'bg-amber-50/50 border-amber-200 shadow-2xs'
                                              : 'bg-gray-50/70 border-gray-200'
                                          }`}
                                        >
                                          <div className="flex flex-wrap items-center justify-between gap-2">
                                            <div className="flex items-center gap-2">
                                              <span
                                                className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${
                                                  mItem.tipo === 'vaga'
                                                    ? 'bg-emerald-100 text-emerald-900 border border-emerald-300'
                                                    : mItem.tipo === 'refugo'
                                                    ? 'bg-rose-100 text-rose-900 border border-rose-300'
                                                    : mItem.tipo === 'lista'
                                                    ? 'bg-blue-100 text-blue-900 border border-blue-300'
                                                    : 'bg-slate-100 text-slate-800 border border-slate-300'
                                                }`}
                                              >
                                                {mItem.titulo}
                                              </span>

                                              {isLatest && (
                                                <span className="bg-amber-400 text-slate-950 font-black px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wide">
                                                  Mais Recente
                                                </span>
                                              )}
                                            </div>

                                            <span className="text-[11px] font-mono text-gray-600 font-semibold flex items-center gap-1">
                                              <Clock className="w-3 h-3 text-gray-400" />
                                              {mItem.dataHora}
                                            </span>
                                          </div>

                                          <div className="mt-1.5 text-xs text-gray-800 font-medium">
                                            {mItem.localizacao}
                                          </div>

                                          {mItem.detalhe && (
                                            <div className="mt-0.5 text-[11px] text-gray-600">
                                              {mItem.detalhe}
                                            </div>
                                          )}

                                          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-gray-500 font-sans border-t border-gray-100 pt-1.5">
                                            {mItem.vaga && (
                                              <span>Vaga: <strong className="text-gray-900 font-mono">{mItem.vaga}</strong></span>
                                            )}
                                            {mItem.rota && (
                                              <span>Rota: <strong className="text-gray-900 font-mono">{mItem.rota}</strong></span>
                                            )}
                                            {mItem.placa && (
                                              <span>Placa: <strong className="text-gray-900 font-mono">{mItem.placa}</strong></span>
                                            )}
                                            {mItem.responsavel && (
                                              <span>Responsável: <strong className="text-gray-900">{mItem.responsavel}</strong></span>
                                            )}
                                            {mItem.motivo && (
                                              <span>Motivo: <strong className="text-gray-900">{mItem.motivo}</strong></span>
                                            )}
                                            {mItem.saida && (
                                              <span>Saída: <strong className="text-gray-900">{mItem.saida}</strong></span>
                                            )}
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  })
                                ) : (
                                  <div className="text-xs text-gray-400 italic">Nenhum evento detalhado registrado.</div>
                                )}
                              </div>

                              {/* Resumo de Campos e Atributos */}
                              {match.row && (
                                <div className="pt-2 border-t border-gray-100">
                                  <span className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">
                                    Todos os Atributos Consolidados
                                  </span>
                                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 text-[11px]">
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Saída</span>
                                      <span className="truncate block font-mono font-bold text-blue-700">{cycleOnly(match.row.saida)}</span>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Motivo</span>
                                      <span className="truncate block font-mono font-bold text-amber-800">{match.row.motivo || '—'}</span>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Rota</span>
                                      <span className="truncate block font-mono text-gray-800">{match.row.rawFields?.['Rota'] || match.row.concat || '—'}</span>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Bipado por</span>
                                      <span className="truncate block font-mono text-gray-800">{match.row.rawFields?.['Bipado por'] || match.row.rawFields?.['Responsável'] || '—'}</span>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Data / Horário</span>
                                      <span className="truncate block font-mono text-gray-800">{match.row.rawFields?.['Data / Hora'] || match.row.rawFields?.['Horário do Bip'] || '—'}</span>
                                    </div>
                                    <div className="bg-gray-50 border border-gray-200 rounded p-1.5 shadow-2xs">
                                      <span className="block text-[9px] font-bold text-gray-400 uppercase">Reversão</span>
                                      <span className="truncate block font-mono text-gray-800">{match.row.reversao || '—'}</span>
                                    </div>
                                  </div>
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
          {renderLookupPagination('bottom')}
        </div>
      ) : null}

      {/* MODAL DE IMPORTAÇÃO DE GRUPOS */}
      {showGruposModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <div className="bg-white rounded-2xl p-6 max-w-2xl w-full shadow-2xl border border-gray-100 flex flex-col max-h-[80vh]">
            <div className="flex justify-between items-center mb-4 pb-3 border-b border-gray-100 flex-shrink-0">
              <div>
                <h3 className="text-base font-bold text-[#333333] flex items-center gap-2">
                  <ListPlus className="w-5 h-5 text-purple-600" />
                  Importar Grupo de Lista de Coleta
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">Selecione um grupo para carregar os IDs na consulta.</p>
              </div>
              <button onClick={() => setShowGruposModal(false)} className="text-gray-400 hover:text-black cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="overflow-y-auto pr-1 space-y-4">
              {listas.filter(l => l.tipo === 'grupos' && l.grupos && l.grupos.length > 0).length === 0 ? (
                <div className="p-8 text-center bg-gray-50 rounded-xl border border-dashed border-gray-300">
                  <Layers className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-gray-500 text-sm font-medium">Nenhuma Lista com Grupos encontrada.</p>
                </div>
              ) : (
                listas.filter(l => l.tipo === 'grupos' && l.grupos && l.grupos.length > 0).map(lista => (
                  <div key={lista.id} className="border border-gray-200 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-4 py-2 border-b border-gray-200 flex items-center justify-between">
                      <span className="font-bold text-sm text-gray-800">{lista.nome}</span>
                      <span className="text-xs text-gray-500">{lista.data}</span>
                    </div>
                    <div className="p-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {lista.grupos?.map(grupo => {
                        return (
                          <button
                            key={grupo.id}
                            onClick={async () => {
                              const itensDoGrupo = await getItemsOfGrupo(lista.id, grupo.id);
                              const idsDoGrupo = itensDoGrupo.map(i => i.codigo);
                              if (idsDoGrupo.length > 0) {
                                const currentInput = inputText.trim();
                                const newIds = idsDoGrupo.join('\n');
                                setInputText(currentInput ? `${currentInput}\n${newIds}` : newIds);
                              }
                              setShowGruposModal(false);
                            }}
                            className="flex flex-col items-start gap-1 p-3 rounded-lg border border-purple-100 bg-purple-50 hover:bg-purple-100 hover:border-purple-300 transition-colors text-left group cursor-pointer"
                          >
                            <div className="flex items-center justify-between w-full">
                              <span className="font-bold text-sm text-purple-900 group-hover:text-purple-700">
                                {grupo.nome}
                              </span>
                            </div>
                            <span className="text-[10px] text-purple-600 font-medium">Líder: {grupo.lider}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="mt-4 pt-3 border-t border-gray-100 flex justify-end">
              <button
                onClick={() => setShowGruposModal(false)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold cursor-pointer transition-colors"
              >
                Fechar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
