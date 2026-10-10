import React, { useState, useEffect, useMemo, useCallback } from 'react';
import Papa from 'papaparse';
import {
  Layers,
  ArrowUpDown,
  Search,
  Download,
  Filter,
  CheckCircle2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  RefreshCw,
  Package,
  Truck,
  ArrowRight,
  Star,
  Check,
  X
} from 'lucide-react';
import { RefugoRow, ColetaLista, ColetaItem } from '../types';
import {
  listenToRefugo,
  listenToRefugoScansIncremental,
  listenToListas,
  RefugoScan,
  RefugoScanChange,
} from '../lib/firebase';
import {
  calcularMapaRefugoEstatisticas,
  carregarItensDeListas,
  RotaMapaInfo,
} from '../lib/coletaRefugoMatcher';
import { PageSkeleton } from './PageSkeleton';
import type { User } from '../lib/auth';

interface MapaRefugoProps {
  currentUser?: User | null;
  onNavigateToRefugo?: () => void;
}

type ModoVisualizacao = 'refugo' | 'passou' | 'comparativo';
type StatusFilter = 'todas' | 'pendentes' | 'concluidas' | 'bpp';

export const MapaRefugo: React.FC<MapaRefugoProps> = ({ currentUser, onNavigateToRefugo }) => {
  const [refugoRows, setRefugoRows] = useState<RefugoRow[]>([]);
  const [refugoScans, setRefugoScans] = useState<RefugoScan[]>([]);
  const [coletaListas, setColetaListas] = useState<ColetaLista[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingItensColeta, setLoadingItensColeta] = useState(false);

  // Modo de visualização requisitado pelo usuário: alternar entre Refugo e Quanto Passou
  const [modo, setModo] = useState<ModoVisualizacao>('comparativo');
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('todas');
  const [rotaExpandida, setRotaExpandida] = useState<string | null>(null);

  // Parse CSV da base de refugo
  const parseCSV = useCallback((text: string): RefugoRow[] => {
    const result = Papa.parse<string[]>(text, { skipEmptyLines: true });
    if (result.errors.some(error => error.type === 'Quotes')) {
      return [];
    }

    const headerRow = result.data.find(values => {
      const id = String(values[0] || '').trim().toUpperCase();
      return ['ID', 'UNIT_ID', 'CODIGO', 'CÓDIGO', 'PACOTE', 'TRACKING', 'ENVIO'].includes(id);
    });

    let valorRealIndex = -1;
    let valorUsdIndex = -1;
    let rotaOtimizadaIndex = -1;
    let rotaUnitIndex = 1;
    let idIndex = 0;

    if (headerRow) {
      headerRow.forEach((col, idx) => {
        const c = String(col).trim().toUpperCase()
          .normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        if (c.includes('VALOR REAL')) valorRealIndex = idx;
        if (c.includes('VALOR USD')) valorUsdIndex = idx;
        if (c === 'ROTA OTIMIZADA' || c === 'ROTA_OTIMIZADA') rotaOtimizadaIndex = idx;
        if (['ID', 'UNIT_ID', 'CODIGO', 'PACOTE', 'TRACKING', 'ENVIO'].includes(c)) idIndex = idx;
        if (['UNIT', 'ROUTE_NAME', 'ROTA_ORIGINAL', 'ROTA', 'ROUTE'].includes(c)) rotaUnitIndex = idx;
      });
    } else {
      valorRealIndex = 5;
      valorUsdIndex = 6;
    }

    return result.data.flatMap(values => {
      const id = String(values[idIndex] || '').trim().toUpperCase();
      if (!id || ['ID', 'UNIT_ID', 'CODIGO', 'CÓDIGO', 'PACOTE', 'TRACKING', 'ENVIO'].includes(id)) return [];

      let isHighPriority = false;
      [valorRealIndex, valorUsdIndex].forEach(idx => {
        if (idx >= 0 && values[idx]) {
          const valStr = values[idx].replace(/\./g, '').replace(',', '.').trim();
          const val = parseFloat(valStr);
          if (!isNaN(val) && val > 1000) {
            isHighPriority = true;
          }
        }
      });

      return [{
        id,
        rota: String(values[rotaOtimizadaIndex] || values[rotaUnitIndex] || 'Sem Rota').trim(),
        isHighPriority,
        rawFields: Object.fromEntries(values.map((value, index) => [String(index), value]))
      }];
    });
  }, []);

  // Inscrição aos dados em tempo real
  useEffect(() => {
    let mounted = true;

    const unsubRefugo = listenToRefugo((data) => {
      if (!mounted) return;
      if (data?.rawText) {
        try {
          const parsed = parseCSV(data.rawText);
          setRefugoRows(parsed);
        } catch (_) {
          setRefugoRows([]);
        }
      } else {
        setRefugoRows([]);
      }
      setLoading(false);
    });

    const unsubScans = listenToRefugoScansIncremental(
      (changes: RefugoScanChange[], isInitial: boolean, initialScans?: RefugoScan[]) => {
        if (!mounted) return;
        if (isInitial && initialScans) {
          setRefugoScans(initialScans);
          return;
        }
        if (changes && changes.length > 0) {
          setRefugoScans(prev => {
            const map = new Map<string, RefugoScan>(prev.map(s => [s.id, s]));
            changes.forEach(c => {
              if (c.type === 'removed') {
                map.delete(c.scan.id);
              } else {
                map.set(c.scan.id, c.scan);
              }
            });
            return Array.from(map.values());
          });
        }
      },
      () => {}
    );

    const unsubListas = listenToListas((listas) => {
      if (!mounted) return;
      setColetaListas(listas);

      // Carregar os itens das listas mais recentes em segundo plano
      setLoadingItensColeta(true);
      carregarItensDeListas(listas.slice(0, 15))
        .catch(err => console.warn('Erro ao carregar itens de coleta:', err))
        .finally(() => {
          if (mounted) setLoadingItensColeta(false);
        });
    });

    return () => {
      mounted = false;
      unsubRefugo();
      unsubScans();
      unsubListas();
    };
  }, [parseCSV]);

  // Cálculo consolidado do Mapa e Coleta
  const mapaCalculo = useMemo(() => {
    return calcularMapaRefugoEstatisticas(refugoRows, refugoScans, coletaListas);
  }, [refugoRows, refugoScans, coletaListas]);

  // Filtragem e busca
  const rotasFiltradas = useMemo(() => {
    const term = searchTerm.trim().toUpperCase();

    return mapaCalculo.rotas.filter(item => {
      // Filtro de texto por nome da rota ou pacote dentro da rota
      const matchRota = !term || item.rota.toUpperCase().includes(term) ||
        item.itensRefugo.some(it => it.id.toUpperCase().includes(term));

      if (!matchRota) return false;

      // Filtro de status
      if (statusFilter === 'pendentes') {
        return item.saldoPendente > 0;
      }
      if (statusFilter === 'concluidas') {
        return item.saldoPendente === 0 && item.refugoTotal > 0;
      }
      if (statusFilter === 'bpp') {
        return item.bppCount > 0;
      }

      return true;
    });
  }, [mapaCalculo.rotas, searchTerm, statusFilter]);

  // Exportar mapa em CSV
  const exportarCSV = () => {
    if (rotasFiltradas.length === 0) return;

    const headers = ['ROTA', 'TOTAL REFUGO', 'BIPADOS REFUGO', 'ENCONTRADOS COLETA', 'QUANTO PASSOU', 'SALDO PENDENTE', 'PROGRESSO %', 'BPP'];
    const rows = rotasFiltradas.map(r => [
      `"${r.rota}"`,
      r.refugoTotal,
      r.refugoBipados,
      r.coletaEncontrados,
      r.quantoPassouTotal,
      r.saldoPendente,
      `${r.progressoPercentual}%`,
      r.bppCount,
    ].join(','));

    const csvContent = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mapa_refugo_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return <PageSkeleton variant="detail" className="mx-auto max-w-7xl pb-12" />;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 pb-12 animate-in fade-in duration-300">
      {/* Cabeçalho do Mapa com Métricas Principais */}
      <div className="border border-slate-300 bg-white p-4 sm:p-6 shadow-sm">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex h-9 w-9 items-center justify-center bg-blue-600 text-white">
                <Layers className="h-5 w-5" />
              </span>
              <div>
                <h1 className="text-lg sm:text-xl font-black uppercase tracking-wide text-slate-900">
                  Mapa Refugo & Coleta
                </h1>
                <p className="text-xs text-slate-500 font-medium">
                  Acompanhamento de volumes por rota, faltantes e pacotes processados
                </p>
              </div>
            </div>
          </div>

          {/* Seletor de Modo Requisitado: alternar entre Refugo e Quanto Passou */}
          <div className="flex flex-wrap items-center gap-1.5 border border-slate-300 bg-slate-100 p-1">
            <button
              type="button"
              onClick={() => setModo('refugo')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase transition-colors cursor-pointer ${
                modo === 'refugo'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Package className="h-3.5 w-3.5" />
              <span>Refugo ({mapaCalculo.totalRefugo})</span>
            </button>

            <button
              type="button"
              onClick={() => setModo('passou')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase transition-colors cursor-pointer ${
                modo === 'passou'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200'
              }`}
            >
              <Truck className="h-3.5 w-3.5" />
              <span>Quanto Passou ({mapaCalculo.totalQuantoPassou})</span>
            </button>

            <button
              type="button"
              onClick={() => setModo('comparativo')}
              className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-black uppercase transition-colors cursor-pointer ${
                modo === 'comparativo'
                  ? 'bg-slate-900 text-white shadow-xs'
                  : 'text-slate-700 hover:bg-slate-200'
              }`}
            >
              <ArrowUpDown className="h-3.5 w-3.5" />
              <span>Comparativo</span>
            </button>
          </div>
        </div>

        {/* Grade de Estatísticas Consolidadas */}
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {/* Total Refugo */}
          <div className="border border-blue-200 bg-blue-50/70 p-3.5">
            <div className="flex items-center justify-between text-blue-900">
              <span className="text-[11px] font-bold uppercase tracking-wider">Total Refugo</span>
              <Package className="h-4 w-4 text-blue-600" />
            </div>
            <div className="mt-1 font-mono text-2xl font-black text-blue-950">
              {mapaCalculo.totalRefugo}
            </div>
            <div className="mt-0.5 text-[10px] text-blue-800 font-medium">
              {mapaCalculo.rotas.length} rotas identificadas
            </div>
          </div>

          {/* Quanto Passou */}
          <div className="border border-emerald-200 bg-emerald-50/70 p-3.5">
            <div className="flex items-center justify-between text-emerald-900">
              <span className="text-[11px] font-bold uppercase tracking-wider">Quanto Passou</span>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </div>
            <div className="mt-1 font-mono text-2xl font-black text-emerald-950">
              {mapaCalculo.totalQuantoPassou}
            </div>
            <div className="mt-0.5 text-[10px] text-emerald-800 font-medium">
              {mapaCalculo.progressoGeralPercentual}% do volume total
            </div>
          </div>

          {/* Quantidade Encontrada de Rota em Coleta */}
          <div className="border border-indigo-200 bg-indigo-50/70 p-3.5">
            <div className="flex items-center justify-between text-indigo-900">
              <span className="text-[11px] font-bold uppercase tracking-wider">Rota em Coleta</span>
              <Truck className="h-4 w-4 text-indigo-600" />
            </div>
            <div className="mt-1 font-mono text-2xl font-black text-indigo-950">
              {mapaCalculo.totalRotasEmColeta}
            </div>
            <div className="mt-0.5 text-[10px] text-indigo-800 font-medium">
              {mapaCalculo.totalPacotesRefugoEmColeta} pacotes da base localizados
            </div>
          </div>

          {/* Sem Rota / Brancas */}
          <div className="border border-amber-200 bg-amber-50/70 p-3.5">
            <div className="flex items-center justify-between text-amber-900">
              <span className="text-[11px] font-bold uppercase tracking-wider">Sem Rota (Brancas)</span>
              <AlertCircle className="h-4 w-4 text-amber-600" />
            </div>
            <div className="mt-1 font-mono text-2xl font-black text-amber-950">
              {mapaCalculo.totalSemRotaRefugo}
            </div>
            <div className="mt-0.5 text-[10px] text-amber-800 font-medium">
              {mapaCalculo.totalSemRotaPassou} lidos / bipados
            </div>
          </div>
        </div>

        {/* Barra de Progresso Geral */}
        <div className="mt-4 pt-3 border-t border-slate-200">
          <div className="flex items-center justify-between text-xs font-bold text-slate-700 mb-1.5">
            <span>Progresso Geral do Mapa (Passou vs Refugo)</span>
            <span className="font-mono">{mapaCalculo.totalQuantoPassou} de {mapaCalculo.totalRefugo} ({mapaCalculo.progressoGeralPercentual}%)</span>
          </div>
          <div className="h-3 w-full bg-slate-200 overflow-hidden">
            <div
              className={`h-full transition-all duration-500 ${
                mapaCalculo.progressoGeralPercentual === 100
                  ? 'bg-emerald-600'
                  : mapaCalculo.progressoGeralPercentual > 50
                  ? 'bg-blue-600'
                  : 'bg-amber-500'
              }`}
              style={{ width: `${mapaCalculo.progressoGeralPercentual}%` }}
            />
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between border border-slate-300 bg-white p-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Buscar rota ou ID de pacote..."
            className="w-full pl-9 pr-3 py-1.5 border border-slate-300 text-xs font-medium focus:border-blue-600 focus:outline-none"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Filtros Rápidos */}
          <div className="flex items-center border border-slate-300 bg-slate-50 text-xs">
            <button
              type="button"
              onClick={() => setStatusFilter('todas')}
              className={`px-2.5 py-1 font-bold transition-colors ${
                statusFilter === 'todas' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Todas ({mapaCalculo.rotas.length})
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('pendentes')}
              className={`px-2.5 py-1 font-bold transition-colors ${
                statusFilter === 'pendentes' ? 'bg-amber-600 text-white' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Pendentes
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('concluidas')}
              className={`px-2.5 py-1 font-bold transition-colors ${
                statusFilter === 'concluidas' ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              Concluídas
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('bpp')}
              className={`px-2.5 py-1 font-bold transition-colors ${
                statusFilter === 'bpp' ? 'bg-yellow-500 text-yellow-950' : 'text-slate-600 hover:bg-slate-200'
              }`}
            >
              BPP
            </button>
          </div>

          <button
            type="button"
            onClick={exportarCSV}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-slate-300 bg-white hover:bg-slate-50 text-xs font-bold text-slate-700 shadow-2xs"
            title="Exportar dados do mapa em planilha CSV"
          >
            <Download className="h-3.5 w-3.5 text-slate-600" />
            <span>Exportar CSV</span>
          </button>

          {onNavigateToRefugo && (
            <button
              type="button"
              onClick={onNavigateToRefugo}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-xs font-bold text-white shadow-2xs"
            >
              <span>Voltar ao Refugo</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Lista de Rotas do Mapa com Visão de Acordo com o Modo Selecionado */}
      {rotasFiltradas.length === 0 ? (
        <div className="border border-dashed border-slate-300 bg-white p-12 text-center">
          <Layers className="mx-auto h-12 w-12 text-slate-300" />
          <h3 className="mt-3 text-base font-bold text-slate-800">Nenhuma rota encontrada</h3>
          <p className="mt-1 text-xs text-slate-500">
            {refugoRows.length === 0
              ? 'Carregue a base CSV no Controle de Refugo para alimentar o Mapa de Rotas.'
              : 'Nenhum resultado com o filtro selecionado.'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {rotasFiltradas.map((r) => {
            const isExpanded = rotaExpandida === r.rota;
            const isSemRota = r.rota === 'SEM ROTA';
            const isTotalmentePassou = r.saldoPendente === 0 && r.refugoTotal > 0;

            return (
              <div
                key={r.rota}
                className={`border transition-all bg-white ${
                  isTotalmentePassou
                    ? 'border-emerald-300 shadow-2xs'
                    : isSemRota
                    ? 'border-amber-300'
                    : 'border-slate-300'
                }`}
              >
                {/* Linha Principal da Rota */}
                <div
                  onClick={() => setRotaExpandida(isExpanded ? null : r.rota)}
                  className="flex flex-col sm:flex-row sm:items-center justify-between p-3.5 sm:p-4 gap-3 cursor-pointer hover:bg-slate-50 select-none"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span
                      className={`flex h-8 w-8 shrink-0 items-center justify-center font-mono text-xs font-black ${
                        isTotalmentePassou
                          ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                          : isSemRota
                          ? 'bg-amber-100 text-amber-800 border border-amber-300'
                          : 'bg-blue-100 text-blue-800 border border-blue-300'
                      }`}
                    >
                      {isTotalmentePassou ? <Check className="h-4 w-4" /> : <Truck className="h-4 w-4" />}
                    </span>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-sm sm:text-base font-black text-slate-900 tracking-wide">
                          {r.rota}
                        </span>
                        {r.bppCount > 0 && (
                          <span className="flex items-center gap-1 bg-yellow-200 border border-yellow-400 text-yellow-900 text-[10px] font-black px-1.5 py-0.5">
                            <Star className="h-3 w-3 fill-yellow-500 text-yellow-700" />
                            {r.bppCount} BPP
                          </span>
                        )}
                        {isTotalmentePassou && (
                          <span className="bg-emerald-100 border border-emerald-300 text-emerald-800 text-[10px] font-black px-1.5 py-0.5">
                            100% CONCLUÍDA
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-medium">
                        {r.itensRefugo.length} pacotes mapeados nesta rota
                      </div>
                    </div>
                  </div>

                  {/* Números da Rota de acordo com o Modo Selecionado */}
                  <div className="flex items-center gap-3 sm:gap-6 justify-between sm:justify-end">
                    {/* Modo Refugo: foco no que foi lançado de refugo */}
                    {(modo === 'refugo' || modo === 'comparativo') && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Refugo</div>
                        <div className="font-mono text-sm sm:text-base font-black text-blue-900">
                          {r.refugoTotal}
                        </div>
                      </div>
                    )}

                    {/* Modo Quanto Passou: foco no que já passou */}
                    {(modo === 'passou' || modo === 'comparativo') && (
                      <div className="text-right">
                        <div className="text-[10px] uppercase font-bold text-slate-500">Passou</div>
                        <div className="font-mono text-sm sm:text-base font-black text-emerald-800">
                          {r.quantoPassouTotal}
                        </div>
                      </div>
                    )}

                    {/* Detalhamento de Coleta */}
                    <div className="text-right hidden md:block">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Em Coleta</div>
                      <div className="font-mono text-sm sm:text-base font-black text-indigo-800">
                        {r.coletaEncontrados}
                      </div>
                    </div>

                    {/* Saldo Pendente */}
                    <div className="text-right">
                      <div className="text-[10px] uppercase font-bold text-slate-500">Pendente</div>
                      <div className={`font-mono text-sm sm:text-base font-black ${r.saldoPendente > 0 ? 'text-amber-700' : 'text-slate-400'}`}>
                        {r.saldoPendente}
                      </div>
                    </div>

                    {/* Barra de Atingimento */}
                    <div className="w-20 sm:w-28 text-right">
                      <div className="text-[10px] font-mono font-bold text-slate-600 mb-0.5">
                        {r.progressoPercentual}%
                      </div>
                      <div className="h-2 w-full bg-slate-200 overflow-hidden">
                        <div
                          className={`h-full ${r.progressoPercentual === 100 ? 'bg-emerald-600' : 'bg-blue-600'}`}
                          style={{ width: `${r.progressoPercentual}%` }}
                        />
                      </div>
                    </div>

                    <button
                      type="button"
                      className="text-slate-400 hover:text-slate-700 p-1"
                      aria-label="Expandir rota"
                    >
                      {isExpanded ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
                    </button>
                  </div>
                </div>

                {/* Área Expansível com os Pacotes da Rota */}
                {isExpanded && (
                  <div className="border-t border-slate-200 bg-slate-50 p-4 space-y-3">
                    <div className="flex items-center justify-between flex-wrap gap-2 text-xs font-bold text-slate-700">
                      <span>Pacotes da Rota {r.rota} ({r.itensRefugo.length})</span>
                      <div className="flex items-center gap-3 text-[11px]">
                        <span className="flex items-center gap-1 text-emerald-700">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Passou: {r.quantoPassouTotal}
                        </span>
                        <span className="flex items-center gap-1 text-amber-700">
                          <Clock className="h-3.5 w-3.5" /> Pendente: {r.saldoPendente}
                        </span>
                      </div>
                    </div>

                    {r.itensRefugo.length > 0 ? (
                      <div className="max-h-64 overflow-y-auto divide-y divide-slate-200 border border-slate-200 bg-white">
                        {r.itensRefugo.map((pkg) => (
                          <div
                            key={pkg.id}
                            className={`flex items-center justify-between p-2.5 text-xs ${
                              pkg.passouGeral ? 'bg-emerald-50/50' : 'bg-white'
                            }`}
                          >
                            <div className="flex items-center gap-2">
                              {pkg.passouGeral ? (
                                <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0" />
                              ) : (
                                <Clock className="h-4 w-4 text-slate-400 shrink-0" />
                              )}
                              <span className="font-mono font-bold text-slate-900">{pkg.id}</span>
                              {pkg.isHighPriority && (
                                <span className="bg-yellow-200 border border-yellow-400 text-yellow-900 text-[9px] font-black px-1">
                                  BPP
                                </span>
                              )}
                            </div>

                            <div className="flex items-center gap-2">
                              {pkg.passouNoRefugo && (
                                <span className="bg-blue-100 text-blue-800 text-[10px] font-bold px-1.5 py-0.5 border border-blue-200">
                                  Refugo
                                </span>
                              )}
                              {pkg.passouNaColeta && (
                                <span className="bg-indigo-100 text-indigo-800 text-[10px] font-bold px-1.5 py-0.5 border border-indigo-200">
                                  Coleta
                                </span>
                              )}
                              {!pkg.passouGeral && (
                                <span className="bg-slate-100 text-slate-600 text-[10px] font-bold px-1.5 py-0.5 border border-slate-200">
                                  Pendente
                                </span>
                              )}
                              {pkg.encontradoPor && (
                                <span className="text-[10px] text-slate-500">
                                  por: <strong>{pkg.encontradoPor}</strong>
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-slate-500 italic">Nenhum pacote detalhado para esta rota.</p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
