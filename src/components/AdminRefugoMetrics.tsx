import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Barcode,
  Calendar,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Download,
  Layers,
  Search,
  ShieldCheck,
  Target,
  Trash2,
  User as UserIcon,
} from 'lucide-react';
import { RefugoHistoricoMetrica } from '../types';
import { RefugoScan } from './AdminPanel';
import {
  calculateRefugoPermanentSummary,
  listenToRefugoMetricItems,
  RefugoMetricItem,
} from '../lib/refugoMetrics';

interface AdminRefugoMetricsProps {
  historico: RefugoHistoricoMetrica[];
  activeScans: RefugoScan[];
  onDeleteHistorico?: (id: string) => Promise<void>;
  startDate?: string;
  endDate?: string;
}

function inPeriod(dateKey: string | undefined, startDate?: string, endDate?: string): boolean {
  if (!dateKey) return false;
  if (startDate && dateKey < startDate) return false;
  if (endDate && dateKey > endDate) return false;
  return true;
}

function escapeCsv(value: unknown): string {
  const text = String(value ?? '');
  return `"${text.replace(/"/g, '""')}"`;
}

export const AdminRefugoMetrics: React.FC<AdminRefugoMetricsProps> = ({
  historico,
  activeScans,
  onDeleteHistorico,
  startDate,
  endDate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [brancasSearchTerm, setBrancasSearchTerm] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);
  const [showAllBrancas, setShowAllBrancas] = useState(false);
  const [permanentItems, setPermanentItems] = useState<RefugoMetricItem[]>([]);
  const [metricsReady, setMetricsReady] = useState(false);
  const [metricsError, setMetricsError] = useState<string | null>(null);

  useEffect(() => {
    const unsubscribe = listenToRefugoMetricItems(
      items => {
        setPermanentItems(items);
        setMetricsReady(true);
        setMetricsError(null);
      },
      error => {
        setMetricsReady(true);
        setMetricsError(error.message);
      }
    );

    return unsubscribe;
  }, []);

  const permanentSummary = useMemo(
    () => calculateRefugoPermanentSummary(permanentItems, startDate, endDate),
    [permanentItems, startDate, endDate]
  );

  /**
   * Migração suave:
   * - sessões históricas anteriores ao primeiro registro permanente continuam contando;
   * - sessões posteriores deixam de entrar nos totais, evitando dupla contagem com os itens permanentes.
   */
  const firstPermanentTimestamp = useMemo(() => {
    if (permanentItems.length === 0) return null;
    let min = Number.POSITIVE_INFINITY;
    for (const item of permanentItems) {
      if (item.firstSeenTimestamp > 0 && item.firstSeenTimestamp < min) {
        min = item.firstSeenTimestamp;
      }
    }
    return Number.isFinite(min) ? min : null;
  }, [permanentItems]);

  const legacyHistorico = useMemo(() => {
    if (firstPermanentTimestamp === null) return historico;
    return historico.filter(item => Number(item.timestamp || 0) < firstPermanentTimestamp);
  }, [historico, firstPermanentTimestamp]);

  const legacyTotals = useMemo(() => {
    let totalBipados = 0;
    let totalEncontrados = 0;
    let totalBrancas = 0;
    const rotas: Record<string, number> = {};

    for (const item of legacyHistorico) {
      totalBipados += Number(item.totalBipados || 0);
      totalEncontrados += Number(item.totalEncontrados || 0);
      totalBrancas += Number(item.totalBrancas || 0);

      for (const [rota, quantidade] of Object.entries(item.rotasEncontradas || {})) {
        const key = String(rota || 'SEM ROTA').trim() || 'SEM ROTA';
        rotas[key] = (rotas[key] || 0) + Number(quantidade || 0);
      }
    }

    return { totalBipados, totalEncontrados, totalBrancas, rotas };
  }, [legacyHistorico]);

  const activeFallback = useMemo(() => {
    if (permanentItems.length > 0) {
      return { totalBipados: 0, totalEncontrados: 0, totalBrancas: 0, rotas: {} as Record<string, number> };
    }

    let totalEncontrados = 0;
    let totalBrancas = 0;
    const rotas: Record<string, number> = {};

    for (const scan of activeScans) {
      const route = String(scan.rota || '').trim();
      const upper = route.toUpperCase();
      const isBranca = scan.status !== 'found' || !route || upper.includes('SEM ROTA') || upper.includes('BRANCA');
      const hasValidRoute = scan.status === 'found' && !isBranca;

      if (hasValidRoute) {
        totalEncontrados++;
        rotas[route] = (rotas[route] || 0) + 1;
      }
      if (isBranca) totalBrancas++;
    }

    return {
      totalBipados: activeScans.length,
      totalEncontrados,
      totalBrancas,
      rotas,
    };
  }, [activeScans, permanentItems.length]);

  const totals = useMemo(() => {
    const totalBipados = legacyTotals.totalBipados + permanentSummary.totalUniqueBipados + activeFallback.totalBipados;
    const totalEncontrados = legacyTotals.totalEncontrados + permanentSummary.totalRotasEncontradas + activeFallback.totalEncontrados;
    const totalBrancas = legacyTotals.totalBrancas + permanentSummary.totalBrancasEncontradas + activeFallback.totalBrancas;
    const taxaAcerto = totalBipados > 0 ? Math.round((totalEncontrados / totalBipados) * 100) : 0;

    return {
      totalBipados,
      totalEncontrados,
      totalBrancas,
      taxaAcerto,
      permanenteBipados: permanentSummary.totalUniqueBipados,
      permanenteEncontrados: permanentSummary.totalRotasEncontradas,
      permanenteBrancas: permanentSummary.totalBrancasEncontradas,
      legadoBipados: legacyTotals.totalBipados,
      legadoEncontrados: legacyTotals.totalEncontrados,
      legadoBrancas: legacyTotals.totalBrancas,
    };
  }, [legacyTotals, permanentSummary, activeFallback]);

  const rotasAgrupadas = useMemo(() => {
    const map: Record<string, number> = {};

    for (const [rota, quantidade] of Object.entries(legacyTotals.rotas)) {
      map[rota] = (map[rota] || 0) + quantidade;
    }
    for (const [rota, quantidade] of Object.entries(permanentSummary.rotas)) {
      map[rota] = (map[rota] || 0) + quantidade;
    }
    for (const [rota, quantidade] of Object.entries(activeFallback.rotas)) {
      map[rota] = (map[rota] || 0) + quantidade;
    }

    let list = Object.entries(map).map(([rota, total]) => ({ rota, total }));

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(item => item.rota.toLowerCase().includes(q));
    }

    return list.sort((a, b) => b.total - a.total);
  }, [legacyTotals.rotas, permanentSummary.rotas, activeFallback.rotas, searchTerm]);

  const brancasPermanentes = useMemo(() => {
    const q = brancasSearchTerm.trim().toLowerCase();

    return permanentItems
      .filter(item => item.everBranca && inPeriod(item.firstBrancaDate, startDate, endDate))
      .filter(item => {
        if (!q) return true;
        return [
          item.packageId,
          item.normalizedId,
          item.lastRota,
          item.rotaEncontrada,
          item.firstFoundBy,
          item.lastFoundBy,
        ]
          .map(value => String(value || '').toLowerCase())
          .some(value => value.includes(q));
      })
      .sort((a, b) => Number(b.firstBrancaTimestamp || 0) - Number(a.firstBrancaTimestamp || 0));
  }, [permanentItems, brancasSearchTerm, startDate, endDate]);

  const displayedBrancas = showAllBrancas ? brancasPermanentes : brancasPermanentes.slice(0, 50);

  const exportPermanentCSV = () => {
    const relevantItems = permanentItems.filter(item => {
      return (
        inPeriod(item.firstSeenDate, startDate, endDate) ||
        inPeriod(item.firstRouteFoundDate, startDate, endDate) ||
        inPeriod(item.firstBrancaDate, startDate, endDate)
      );
    });

    if (relevantItems.length === 0 && legacyHistorico.length === 0) return;

    const rows = [
      [
        'ID',
        'ID_NORMALIZADO',
        'ROTA_ENCONTRADA',
        'EVER_ROTA_ENCONTRADA',
        'EVER_BRANCA',
        'PRIMEIRO_BIP',
        'PRIMEIRA_ROTA_ENCONTRADA',
        'PRIMEIRA_BRANCA',
        'ULTIMO_BIP',
        'RESPONSAVEL',
        'QTD_APARICOES',
      ].map(escapeCsv).join(','),
      ...relevantItems.map(item => [
        item.packageId,
        item.normalizedId,
        item.rotaEncontrada || '',
        item.everRouteFound ? 'SIM' : 'NAO',
        item.everBranca ? 'SIM' : 'NAO',
        item.firstSeenAt,
        item.firstRouteFoundAt || '',
        item.firstBrancaAt || '',
        item.lastSeenAt,
        item.lastFoundBy || item.firstFoundBy || '',
        item.scanCount,
      ].map(escapeCsv).join(',')),
    ];

    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `metricas_refugo_permanentes_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleDelete = async (id: string) => {
    if (!onDeleteHistorico) return;
    const confirmed = window.confirm('Deseja realmente excluir este registro histórico legado de refugo?');
    if (!confirmed) return;

    setIsDeleting(id);
    try {
      await onDeleteHistorico(id);
    } finally {
      setIsDeleting(null);
    }
  };

  const displayedSessions = showAllSessions ? historico : historico.slice(0, 5);

  return (
    <section className="bg-white rounded-2xl shadow-sm border border-gray-200 p-6 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div className="flex items-start sm:items-center gap-3">
          <div className="p-2.5 bg-blue-50 text-[#3483FA] rounded-xl border border-blue-100">
            <Layers className="w-6 h-6" />
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-black text-gray-900 tracking-tight">
                Métricas do Refugo & Rotas Encontradas
              </h2>
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" />
                Permanente por pacote
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Cada ID encontrado é preservado individualmente e não é apagado ao limpar a mesa do Refugo.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(permanentItems.length > 0 || legacyHistorico.length > 0) && (
            <button
              type="button"
              onClick={exportPermanentCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-xs transition-colors cursor-pointer"
              title="Exportar todos os IDs métricos permanentes do Refugo"
            >
              <Download className="w-4 h-4 text-gray-500" />
              <span>Exportar CSV</span>
            </button>
          )}
        </div>
      </div>

      {metricsError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800">
          Histórico permanente indisponível: {metricsError}. Os dados operacionais atuais continuam visíveis.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-xl border border-cyan-100 bg-cyan-50/40">
          <div className="flex items-center justify-between text-cyan-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Rotas encontradas</span>
            <Target className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-3xl font-black text-cyan-950 tabular-nums">
            {totals.totalEncontrados.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-cyan-800">
            {totals.permanenteEncontrados.toLocaleString('pt-BR')} IDs permanentes
            {totals.legadoEncontrados > 0 && ` + ${totals.legadoEncontrados.toLocaleString('pt-BR')} legado`}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-rose-100 bg-rose-50/40">
          <div className="flex items-center justify-between text-rose-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Brancas encontradas</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-3xl font-black text-rose-950 tabular-nums">
            {totals.totalBrancas.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-rose-800">
            {totals.permanenteBrancas.toLocaleString('pt-BR')} IDs preservados individualmente
            {totals.legadoBrancas > 0 && ` + ${totals.legadoBrancas.toLocaleString('pt-BR')} legado`}
          </p>
        </div>

        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between text-slate-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">IDs bipados</span>
            <Barcode className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-3xl font-black text-slate-900 tabular-nums">
            {totals.totalBipados.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            Novos dados contam IDs únicos para impedir duplicidade por retry ou limpeza.
          </p>
        </div>

        <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/40">
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Taxa de localização</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-black text-emerald-950 tabular-nums">
            {totals.taxaAcerto}%
          </div>
          <p className="mt-1 text-[11px] text-emerald-800">
            Somente rota válida conta como encontrada; Sem Rota/Branca não infla o acerto.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-gray-200 bg-gray-50/50 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <span>Rotas Encontradas no Refugo</span>
              <span className="px-2 py-0.5 text-[11px] font-black bg-cyan-100 text-cyan-800 rounded-md">
                {rotasAgrupadas.length} {rotasAgrupadas.length === 1 ? 'rota' : 'rotas'}
              </span>
            </h3>
            <p className="text-xs text-gray-500">
              Distribuição sem dupla contagem dos IDs que realmente receberam rota válida.
            </p>
          </div>

          <div className="relative min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              placeholder="Buscar rota..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-gray-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#3483FA]"
            />
          </div>
        </div>

        {rotasAgrupadas.length > 0 ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2.5 max-h-60 overflow-y-auto pr-1 app-scroll">
            {rotasAgrupadas.map(item => (
              <div
                key={item.rota}
                className="flex items-center justify-between p-2.5 bg-white border border-gray-200 rounded-lg shadow-2xs hover:border-cyan-300 transition-colors"
              >
                <span className="font-bold text-xs text-gray-800 truncate" title={item.rota}>
                  {item.rota}
                </span>
                <span className="ml-1.5 px-2 py-0.5 text-[11px] font-black bg-cyan-50 text-cyan-700 border border-cyan-200 rounded-md shrink-0 tabular-nums">
                  {item.total}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-gray-500 bg-white rounded-lg border border-dashed border-gray-200">
            Nenhuma rota válida encontrada para o período selecionado.
          </div>
        )}
      </div>

      <div className="rounded-xl border border-rose-200 bg-rose-50/30 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
              <span>Brancas encontradas no Refugo</span>
              <span className="px-2 py-0.5 text-[11px] font-black bg-rose-100 text-rose-800 rounded-md">
                {brancasPermanentes.length.toLocaleString('pt-BR')} IDs
              </span>
            </h3>
            <p className="text-xs text-gray-500">
              Registro individual permanente. Limpar a base ou os bips da mesa não remove estes IDs.
            </p>
          </div>

          <div className="relative min-w-[220px] max-w-sm">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={brancasSearchTerm}
              onChange={e => setBrancasSearchTerm(e.target.value)}
              placeholder="Buscar ID, rota ou responsável..."
              className="w-full pl-8 pr-3 py-1.5 text-xs bg-white border border-rose-200 rounded-lg text-gray-800 placeholder-gray-400 focus:outline-none focus:border-rose-400"
            />
          </div>
        </div>

        {displayedBrancas.length > 0 ? (
          <div className="overflow-x-auto border border-rose-100 rounded-xl bg-white">
            <table className="w-full text-xs text-left text-gray-700">
              <thead className="bg-rose-50/60 font-bold uppercase tracking-wider text-gray-600 border-b border-rose-100 text-[10px]">
                <tr>
                  <th className="py-2.5 px-3">ID</th>
                  <th className="py-2.5 px-3">Primeira identificação</th>
                  <th className="py-2.5 px-3">Última rota</th>
                  <th className="py-2.5 px-3">Responsável</th>
                  <th className="py-2.5 px-3 text-center">Aparições</th>
                  <th className="py-2.5 px-3 text-center">Rota depois?</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedBrancas.map(item => (
                  <tr key={item.id} className="hover:bg-rose-50/30">
                    <td className="py-2.5 px-3 font-mono font-bold text-gray-900 whitespace-nowrap">{item.packageId}</td>
                    <td className="py-2.5 px-3 whitespace-nowrap">{item.firstBrancaAt || item.firstSeenAt}</td>
                    <td className="py-2.5 px-3">{item.lastRota || 'SEM ROTA'}</td>
                    <td className="py-2.5 px-3">{item.lastFoundBy || item.firstFoundBy || 'Operador'}</td>
                    <td className="py-2.5 px-3 text-center font-bold tabular-nums">{item.scanCount}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-[10px] font-bold border ${item.everRouteFound ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'bg-rose-50 border-rose-200 text-rose-700'}`}>
                        {item.everRouteFound ? item.rotaEncontrada || 'Sim' : 'Não'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-6 text-center text-xs text-gray-500 bg-white rounded-lg border border-dashed border-rose-200">
            {metricsReady ? 'Nenhuma branca permanente encontrada para o período.' : 'Carregando histórico permanente...'}
          </div>
        )}

        {brancasPermanentes.length > 50 && (
          <button
            type="button"
            onClick={() => setShowAllBrancas(value => !value)}
            className="text-xs font-bold text-rose-700 hover:underline flex items-center gap-1 cursor-pointer"
          >
            {showAllBrancas ? (
              <>Mostrar somente 50 <ChevronUp className="w-3.5 h-3.5" /></>
            ) : (
              <>Mostrar todas ({brancasPermanentes.length.toLocaleString('pt-BR')}) <ChevronDown className="w-3.5 h-3.5" /></>
            )}
          </button>
        )}
      </div>

      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span>Sessões históricas / legado</span>
            <span className="text-xs font-normal text-gray-500">
              ({historico.length} {historico.length === 1 ? 'registro' : 'registros'})
            </span>
          </h3>

          {historico.length > 5 && (
            <button
              type="button"
              onClick={() => setShowAllSessions(!showAllSessions)}
              className="text-xs font-bold text-[#3483FA] hover:underline flex items-center gap-1 cursor-pointer"
            >
              {showAllSessions ? (
                <>Ver menos <ChevronUp className="w-3.5 h-3.5" /></>
              ) : (
                <>Ver todos ({historico.length}) <ChevronDown className="w-3.5 h-3.5" /></>
              )}
            </button>
          )}
        </div>

        {historico.length > 0 ? (
          <div className="overflow-x-auto border border-gray-200 rounded-xl">
            <table className="w-full text-xs text-left text-gray-700">
              <thead className="bg-gray-50 font-bold uppercase tracking-wider text-gray-600 border-b border-gray-200 text-[11px]">
                <tr>
                  <th className="py-2.5 px-3">Data / Hora</th>
                  <th className="py-2.5 px-3">Responsável</th>
                  <th className="py-2.5 px-3 text-center">Bipados</th>
                  <th className="py-2.5 px-3 text-center text-cyan-800">Encontrados</th>
                  <th className="py-2.5 px-3 text-center text-rose-800">Brancas</th>
                  <th className="py-2.5 px-3">Rotas Principais</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  {onDeleteHistorico && <th className="py-2.5 px-3 text-center">Ações</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 bg-white">
                {displayedSessions.map(item => {
                  const rotasArray = item.rotasEncontradas
                    ? Object.entries(item.rotasEncontradas).map(([rota, total]) => ({ rota, total }))
                    : [];

                  return (
                    <tr key={item.id} className="hover:bg-gray-50/80 transition-colors">
                      <td className="py-3 px-3 font-medium text-gray-800 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{item.dataHora || item.data}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 font-medium text-gray-700 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <UserIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                          <span>{item.responsavel || 'Operador'}</span>
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center font-bold text-gray-900 tabular-nums">{item.totalBipados}</td>
                      <td className="py-3 px-3 text-center font-black text-cyan-700 tabular-nums">{item.totalEncontrados}</td>
                      <td className="py-3 px-3 text-center font-black text-rose-700 tabular-nums">{item.totalBrancas}</td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1 flex-wrap max-w-xs">
                          {rotasArray.slice(0, 3).map(route => (
                            <span
                              key={route.rota}
                              className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-bold border border-gray-200"
                            >
                              {route.rota}: {route.total}
                            </span>
                          ))}
                          {rotasArray.length > 3 && (
                            <span className="text-[10px] text-gray-400 font-bold">+{rotasArray.length - 3}</span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-3 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <ShieldCheck className="w-3 h-3 text-emerald-600" />
                          Preservado
                        </span>
                      </td>
                      {onDeleteHistorico && (
                        <td className="py-3 px-3 text-center">
                          <button
                            type="button"
                            onClick={() => handleDelete(item.id)}
                            disabled={isDeleting === item.id}
                            className="p-1 text-gray-400 hover:text-red-600 transition-colors rounded hover:bg-red-50 cursor-pointer disabled:opacity-40"
                            title="Remover este registro histórico legado"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center bg-gray-50 border border-dashed border-gray-200 rounded-xl space-y-2">
            <p className="text-xs font-bold text-gray-700">Nenhuma sessão histórica salva para o período.</p>
            <p className="text-[11px] text-gray-500 max-w-md mx-auto">
              Os novos bips passam a ser preservados individualmente na coleção permanente, sem depender da limpeza da mesa.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
