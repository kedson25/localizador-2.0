import React, { useState, useMemo } from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend
} from 'recharts';
import { 
  TrendingUp, 
  BarChart3, 
  Layers, 
  Calendar, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  HelpCircle,
  Percent
} from 'lucide-react';
import { RefugoHistoricoMetrica } from '../types';
import { RefugoScan } from './AdminPanel';

interface RefugoDashboardChartProps {
  historico: RefugoHistoricoMetrica[];
  activeScans: RefugoScan[];
  startDate?: string;
  endDate?: string;
}

type ChartType = 'area' | 'bar' | 'percent';
type GroupBy = 'day' | 'session';

interface TimelinePoint {
  key: string;
  label: string;
  fullDate: string;
  timestamp: number;
  rotasEncontradas: number;
  pecasBrancas: number;
  total: number;
  taxaEncontradas: number;
  taxaBrancas: number;
  origemLabel: string;
}

export const RefugoDashboardChart: React.FC<RefugoDashboardChartProps> = ({
  historico,
  activeScans,
}) => {
  const [chartType, setChartType] = useState<ChartType>('area');
  const [groupBy, setGroupBy] = useState<GroupBy>('day');

  // Processa dados da linha do tempo
  const timelineData: TimelinePoint[] = useMemo(() => {
    // Se não há dados nem no histórico nem ativos
    if (historico.length === 0 && activeScans.length === 0) {
      return [];
    }

    if (groupBy === 'day') {
      const daysMap = new Map<string, {
        rotasEncontradas: number;
        pecasBrancas: number;
        total: number;
        timestamp: number;
        dataFormatted: string;
      }>();

      // Processa histórico persistido
      for (const item of historico) {
        let dateKey = item.data;
        if (!dateKey && item.timestamp) {
          const d = new Date(item.timestamp);
          dateKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        }
        if (!dateKey) dateKey = 'Outros';

        const existing = daysMap.get(dateKey) || {
          rotasEncontradas: 0,
          pecasBrancas: 0,
          total: 0,
          timestamp: item.timestamp || 0,
          dataFormatted: item.dataHora?.split(',')[0] || dateKey
        };

        existing.rotasEncontradas += item.totalEncontrados || 0;
        existing.pecasBrancas += item.totalBrancas || 0;
        existing.total += item.totalBipados || ((item.totalEncontrados || 0) + (item.totalBrancas || 0));
        if (item.timestamp && item.timestamp > existing.timestamp) {
          existing.timestamp = item.timestamp;
        }

        daysMap.set(dateKey, existing);
      }

      // Processa scans ativos da mesa (se houver)
      if (activeScans.length > 0) {
        const todayIso = new Date().toISOString().slice(0, 10);
        const existing = daysMap.get(todayIso) || {
          rotasEncontradas: 0,
          pecasBrancas: 0,
          total: 0,
          timestamp: Date.now(),
          dataFormatted: new Date().toLocaleDateString('pt-BR')
        };

        for (const scan of activeScans) {
          if (scan.status === 'found') {
            existing.rotasEncontradas++;
          } else {
            existing.pecasBrancas++;
          }
          existing.total++;
        }

        daysMap.set(todayIso, existing);
      }

      // Ordenar por data cronológica
      const sortedKeys = Array.from(daysMap.keys()).sort((a, b) => {
        if (a === 'Outros') return 1;
        if (b === 'Outros') return -1;
        return a.localeCompare(b);
      });

      return sortedKeys.map(dateKey => {
        const d = daysMap.get(dateKey)!;
        const total = d.total || (d.rotasEncontradas + d.pecasBrancas);
        const taxaEncontradas = total > 0 ? Math.round((d.rotasEncontradas / total) * 100) : 0;
        const taxaBrancas = total > 0 ? Math.round((d.pecasBrancas / total) * 100) : 0;

        let label = dateKey;
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) {
          const parts = dateKey.split('-');
          label = `${parts[2]}/${parts[1]}`;
        }

        return {
          key: dateKey,
          label,
          fullDate: d.dataFormatted || dateKey,
          timestamp: d.timestamp,
          rotasEncontradas: d.rotasEncontradas,
          pecasBrancas: d.pecasBrancas,
          total,
          taxaEncontradas,
          taxaBrancas,
          origemLabel: 'Consolidado Diário'
        };
      });
    }

    // Modo 'session' (cada registro individual do histórico ordenado por timestamp)
    const points: TimelinePoint[] = historico.map(item => {
      const total = item.totalBipados || ((item.totalEncontrados || 0) + (item.totalBrancas || 0));
      const taxaEncontradas = total > 0 ? Math.round(((item.totalEncontrados || 0) / total) * 100) : 0;
      const taxaBrancas = total > 0 ? Math.round(((item.totalBrancas || 0) / total) * 100) : 0;

      let label = item.dataHora ? item.dataHora.replace(/:\d{2}$/, '') : (item.data || 'Sessão');
      if (label.length > 14) {
        label = label.slice(0, 14);
      }

      return {
        key: item.id || `sess_${item.timestamp}`,
        label,
        fullDate: item.dataHora || item.data || 'Sessão salva',
        timestamp: item.timestamp || 0,
        rotasEncontradas: item.totalEncontrados || 0,
        pecasBrancas: item.totalBrancas || 0,
        total,
        taxaEncontradas,
        taxaBrancas,
        origemLabel: item.responsavel ? `Resp: ${item.responsavel}` : 'Salvo Histórico'
      };
    });

    // Se houver scans ativos na mesa, adiciona ponto final "Mesa Ativa"
    if (activeScans.length > 0) {
      let ativosEnc = 0;
      let ativosBr = 0;
      for (const s of activeScans) {
        if (s.status === 'found') ativosEnc++;
        else ativosBr++;
      }
      const total = activeScans.length;
      points.push({
        key: 'mesa_ativa',
        label: 'Mesa Atual',
        fullDate: `Mesa Ativa (${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })})`,
        timestamp: Date.now(),
        rotasEncontradas: ativosEnc,
        pecasBrancas: ativosBr,
        total,
        taxaEncontradas: total > 0 ? Math.round((ativosEnc / total) * 100) : 0,
        taxaBrancas: total > 0 ? Math.round((ativosBr / total) * 100) : 0,
        origemLabel: 'Sessão em Andamento'
      });
    }

    return points.sort((a, b) => a.timestamp - b.timestamp);
  }, [historico, activeScans, groupBy]);

  // Estatísticas calculadas da timeline
  const summary = useMemo(() => {
    let sumEncontradas = 0;
    let sumBrancas = 0;
    let peakPoint: TimelinePoint | null = null;

    for (const p of timelineData) {
      sumEncontradas += p.rotasEncontradas;
      sumBrancas += p.pecasBrancas;
      if (!peakPoint || p.total > peakPoint.total) {
        peakPoint = p;
      }
    }

    const total = sumEncontradas + sumBrancas;
    const taxaGeralBrancas = total > 0 ? Math.round((sumBrancas / total) * 100) : 0;
    const ratio = sumBrancas > 0 ? (sumEncontradas / sumBrancas).toFixed(1) : (sumEncontradas > 0 ? '∞' : '0');

    return {
      sumEncontradas,
      sumBrancas,
      total,
      taxaGeralBrancas,
      ratio,
      peakPoint
    };
  }, [timelineData]);

  // Custom Tooltip component
  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const dataPoint: TimelinePoint | undefined = payload[0]?.payload;
      if (!dataPoint) return null;

      return (
        <div className="bg-slate-900 text-white rounded-xl shadow-xl p-3.5 border border-slate-800 text-xs min-w-[210px] animate-in fade-in zoom-in-95 duration-150">
          <div className="border-b border-slate-800 pb-2 mb-2.5">
            <span className="font-bold text-slate-100 block">{dataPoint.fullDate}</span>
            <span className="text-[10px] text-slate-400 font-medium">{dataPoint.origemLabel}</span>
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-cyan-300 font-semibold">
                <span className="w-2.5 h-2.5 rounded-sm bg-cyan-500 inline-block" />
                Rotas Encontradas:
              </span>
              <span className="font-black text-white tabular-nums">
                {dataPoint.rotasEncontradas.toLocaleString('pt-BR')} ({dataPoint.taxaEncontradas}%)
              </span>
            </div>

            <div className="flex items-center justify-between gap-4">
              <span className="flex items-center gap-1.5 text-rose-300 font-semibold">
                <span className="w-2.5 h-2.5 rounded-sm bg-rose-500 inline-block" />
                Peças Brancas:
              </span>
              <span className="font-black text-white tabular-nums">
                {dataPoint.pecasBrancas.toLocaleString('pt-BR')} ({dataPoint.taxaBrancas}%)
              </span>
            </div>

            <div className="pt-2 mt-2 border-t border-slate-800/80 flex items-center justify-between text-[11px] font-bold text-slate-300">
              <span>Volume Total:</span>
              <span className="text-amber-300 font-black tabular-nums">{dataPoint.total.toLocaleString('pt-BR')} pacotes</span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-5 sm:p-6 space-y-6">
      {/* HEADER DO DASHBOARD VISUAL */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 border-b border-gray-100 pb-5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <div className="p-2 bg-gradient-to-br from-cyan-500 to-blue-600 text-white rounded-xl shadow-xs">
              <TrendingUp className="w-5 h-5" />
            </div>
            <h3 className="text-base sm:text-lg font-black text-gray-900 tracking-tight">
              Evolução: Rotas Encontradas vs. Peças Brancas
            </h3>
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 border border-slate-200">
              {timelineData.length} {groupBy === 'day' ? 'dias' : 'sessões'}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Análise temporal comparativa do refugo salvo ao longo do tempo (Rotas identificadas x Pacotes sem rota)
          </p>
        </div>

        {/* CONTROLES DO GRÁFICO */}
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 self-start lg:self-center">
          {/* SELETOR DE AGRUPAMENTO (DIA vs SESSÃO) */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-bold text-gray-600">
            <button
              type="button"
              onClick={() => setGroupBy('day')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                groupBy === 'day'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'hover:text-gray-900 text-gray-500'
              }`}
              title="Agrupar contagens consolidadas por dia"
            >
              <Calendar className="w-3.5 h-3.5" />
              <span>Por Dia</span>
            </button>
            <button
              type="button"
              onClick={() => setGroupBy('session')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                groupBy === 'session'
                  ? 'bg-white text-gray-900 shadow-xs'
                  : 'hover:text-gray-900 text-gray-500'
              }`}
              title="Visualizar cada rodada de refugo individualmente"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Por Sessão</span>
            </button>
          </div>

          {/* SELETOR DE TIPO DE GRÁFICO */}
          <div className="flex items-center bg-gray-100 p-1 rounded-xl border border-gray-200 text-xs font-bold text-gray-600">
            <button
              type="button"
              onClick={() => setChartType('area')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                chartType === 'area'
                  ? 'bg-white text-[#3483FA] shadow-xs'
                  : 'hover:text-gray-900 text-gray-500'
              }`}
              title="Gráfico de Área Contínua"
            >
              <Layers className="w-3.5 h-3.5" />
              <span>Área</span>
            </button>
            <button
              type="button"
              onClick={() => setChartType('bar')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                chartType === 'bar'
                  ? 'bg-white text-[#3483FA] shadow-xs'
                  : 'hover:text-gray-900 text-gray-500'
              }`}
              title="Gráfico de Barras Comparativas"
            >
              <BarChart3 className="w-3.5 h-3.5" />
              <span>Barras</span>
            </button>
            <button
              type="button"
              onClick={() => setChartType('percent')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all cursor-pointer ${
                chartType === 'percent'
                  ? 'bg-white text-[#3483FA] shadow-xs'
                  : 'hover:text-gray-900 text-gray-500'
              }`}
              title="Gráfico de Proporção Percentual (100%)"
            >
              <Percent className="w-3.5 h-3.5" />
              <span>Proporção %</span>
            </button>
          </div>
        </div>
      </div>

      {/* MINI INDICADORES ANALÍTICOS TEMPORAIS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-cyan-50/60 border border-cyan-100 rounded-xl">
          <span className="text-[10px] font-black uppercase text-cyan-800 tracking-wider block">
            Rotas Encontradas
          </span>
          <div className="text-xl sm:text-2xl font-black text-cyan-950 mt-0.5 tabular-nums">
            {summary.sumEncontradas.toLocaleString('pt-BR')}
          </div>
          <span className="text-[10px] text-cyan-700 font-medium">Pacotes identificados</span>
        </div>

        <div className="p-3 bg-rose-50/60 border border-rose-100 rounded-xl">
          <span className="text-[10px] font-black uppercase text-rose-800 tracking-wider block">
            Peças Brancas
          </span>
          <div className="text-xl sm:text-2xl font-black text-rose-950 mt-0.5 tabular-nums">
            {summary.sumBrancas.toLocaleString('pt-BR')}
          </div>
          <span className="text-[10px] text-rose-700 font-medium">Sem rota / Lista branca</span>
        </div>

        <div className="p-3 bg-slate-50 border border-slate-200 rounded-xl">
          <span className="text-[10px] font-black uppercase text-slate-700 tracking-wider block">
            Taxa de Brancas
          </span>
          <div className="text-xl sm:text-2xl font-black text-slate-900 mt-0.5 tabular-nums">
            {summary.taxaGeralBrancas}%
          </div>
          <span className="text-[10px] text-slate-500 font-medium">do total de refugo</span>
        </div>

        <div className="p-3 bg-emerald-50/60 border border-emerald-100 rounded-xl">
          <span className="text-[10px] font-black uppercase text-emerald-800 tracking-wider block">
            Proporção Localizada
          </span>
          <div className="text-xl sm:text-2xl font-black text-emerald-950 mt-0.5 tabular-nums">
            {summary.ratio}x
          </div>
          <span className="text-[10px] text-emerald-700 font-medium">Encontradas p/ cada Branca</span>
        </div>
      </div>

      {/* ÁREA DO GRÁFICO RECHARTS */}
      <div className="w-full h-72 sm:h-80 pt-2">
        {timelineData.length > 0 ? (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === 'area' ? (
              <AreaChart data={timelineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorEncontradas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.75} />
                    <stop offset="95%" stopColor="#06b6d4" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="colorBrancas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.75} />
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ paddingBottom: 12, fontSize: 11, fontWeight: 700 }}
                  formatter={(value) => (
                    <span className="text-gray-700">
                      {value === 'rotasEncontradas' ? 'Rotas Encontradas' : 'Peças Brancas'}
                    </span>
                  )}
                />
                <Area
                  type="monotone"
                  dataKey="rotasEncontradas"
                  name="rotasEncontradas"
                  stroke="#0891b2"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorEncontradas)"
                />
                <Area
                  type="monotone"
                  dataKey="pecasBrancas"
                  name="pecasBrancas"
                  stroke="#e11d48"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorBrancas)"
                />
              </AreaChart>
            ) : chartType === 'bar' ? (
              <BarChart data={timelineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ paddingBottom: 12, fontSize: 11, fontWeight: 700 }}
                  formatter={(value) => (
                    <span className="text-gray-700">
                      {value === 'rotasEncontradas' ? 'Rotas Encontradas' : 'Peças Brancas'}
                    </span>
                  )}
                />
                <Bar
                  dataKey="rotasEncontradas"
                  name="rotasEncontradas"
                  fill="#06b6d4"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
                <Bar
                  dataKey="pecasBrancas"
                  name="pecasBrancas"
                  fill="#f43f5e"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={40}
                />
              </BarChart>
            ) : (
              <BarChart data={timelineData} margin={{ top: 10, right: 10, left: -15, bottom: 0 }} stackOffset="expand">
                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                <XAxis
                  dataKey="label"
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={{ stroke: '#e2e8f0' }}
                />
                <YAxis
                  stroke="#94a3b8"
                  fontSize={11}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(val) => `${Math.round(val * 100)}%`}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend
                  verticalAlign="top"
                  align="right"
                  iconType="circle"
                  wrapperStyle={{ paddingBottom: 12, fontSize: 11, fontWeight: 700 }}
                  formatter={(value) => (
                    <span className="text-gray-700">
                      {value === 'rotasEncontradas' ? 'Rotas Encontradas (%)' : 'Peças Brancas (%)'}
                    </span>
                  )}
                />
                <Bar
                  dataKey="rotasEncontradas"
                  name="rotasEncontradas"
                  stackId="a"
                  fill="#06b6d4"
                  maxBarSize={44}
                />
                <Bar
                  dataKey="pecasBrancas"
                  name="pecasBrancas"
                  stackId="a"
                  fill="#f43f5e"
                  radius={[4, 4, 0, 0]}
                  maxBarSize={44}
                />
              </BarChart>
            )}
          </ResponsiveContainer>
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center border-2 border-dashed border-gray-200 rounded-xl bg-gray-50/50 p-6 text-center">
            <BarChart3 className="w-10 h-10 text-gray-300 mb-2" />
            <h4 className="text-xs font-bold text-gray-700">Sem dados cronológicos de refugo</h4>
            <p className="text-[11px] text-gray-400 mt-1 max-w-sm">
              Conforme as leituras de pacotes na aba Refugo forem realizadas e salvas, o gráfico apresentará o comparativo temporal entre rotas encontradas e peças brancas.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
