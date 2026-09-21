import React, { useState, useMemo } from 'react';
import { 
  ShieldCheck, 
  Target, 
  AlertCircle, 
  Barcode, 
  Search, 
  Download, 
  Trash2, 
  Layers, 
  CheckCircle2, 
  Calendar, 
  Clock, 
  User as UserIcon,
  ChevronDown,
  ChevronUp,
  Filter
} from 'lucide-react';
import { RefugoHistoricoMetrica } from '../types';
import { RefugoScan } from './AdminPanel';
import { RefugoDashboardChart } from './RefugoDashboardChart';

interface AdminRefugoMetricsProps {
  historico: RefugoHistoricoMetrica[];
  activeScans: RefugoScan[];
  onDeleteHistorico?: (id: string) => Promise<void>;
  startDate?: string;
  endDate?: string;
}

export const AdminRefugoMetrics: React.FC<AdminRefugoMetricsProps> = ({
  historico,
  activeScans,
  onDeleteHistorico,
  startDate,
  endDate,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [rotaFilter, setRotaFilter] = useState('');
  const [isDeleting, setIsDeleting] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  // Totais combinados
  const totals = useMemo(() => {
    let historicoEncontrados = 0;
    let historicoBrancas = 0;
    let historicoBipados = 0;

    for (const m of historico) {
      historicoEncontrados += m.totalEncontrados || 0;
      historicoBrancas += m.totalBrancas || 0;
      historicoBipados += m.totalBipados || 0;
    }

    let ativosEncontrados = 0;
    let ativosBrancas = 0;
    for (const s of activeScans) {
      if (s.status === 'found') {
        ativosEncontrados++;
      } else {
        ativosBrancas++;
      }
    }

    const totalEncontrados = historicoEncontrados + ativosEncontrados;
    const totalBrancas = historicoBrancas + ativosBrancas;
    const totalBipados = historicoBipados + activeScans.length;
    const taxaAcerto = totalBipados > 0 ? Math.round((totalEncontrados / totalBipados) * 100) : 0;

    return {
      totalEncontrados,
      totalBrancas,
      totalBipados,
      taxaAcerto,
      historicoEncontrados,
      historicoBrancas,
      ativosEncontrados,
      ativosBrancas,
      activeCount: activeScans.length,
      historicoCount: historico.length
    };
  }, [historico, activeScans]);

  // Agrupamento de rotas encontradas
  const rotasAgrupadas = useMemo(() => {
    const map: Record<string, number> = {};

    // Do histórico permanente
    for (const m of historico) {
      if (m.rotasEncontradas) {
        for (const [rota, qtd] of Object.entries(m.rotasEncontradas)) {
          const r = (rota || 'SEM ROTA').trim();
          map[r] = (map[r] || 0) + (typeof qtd === 'number' ? qtd : 0);
        }
      }
    }

    // Dos scans ativos da mesa
    for (const s of activeScans) {
      if (s.status === 'found') {
        const r = (s.rota || 'SEM ROTA').trim();
        map[r] = (map[r] || 0) + 1;
      }
    }

    let list = Object.entries(map).map(([rota, total]) => ({
      rota,
      total
    }));

    if (searchTerm.trim()) {
      const q = searchTerm.toLowerCase();
      list = list.filter(item => item.rota.toLowerCase().includes(q));
    }

    return list.sort((a, b) => b.total - a.total);
  }, [historico, activeScans, searchTerm]);

  // Exportar histórico de refugo em CSV
  const exportHistoricoCSV = () => {
    if (historico.length === 0 && activeScans.length === 0) return;

    let csvContent = 'DATA,HORA,RESPONSAVEL,STATUS,TOTAL_BIPADOS,ENCONTRADOS,BRANCAS_SEM_ROTA,ROTAS_DETALHE\n';

    for (const m of historico) {
      const rotasStr = m.rotasEncontradas 
        ? Object.entries(m.rotasEncontradas).map(([r, c]) => `${r}:${c}`).join(' | ') 
        : '';
      const [d, h] = (m.dataHora || '').split(', ');
      csvContent += `"${m.data || d || ''}","${h || ''}","${m.responsavel || ''}","SALVO_HISTORICO",${m.totalBipados || 0},${m.totalEncontrados || 0},${m.totalBrancas || 0},"${rotasStr}"\n`;
    }

    if (activeScans.length > 0) {
      const ativosRotas: Record<string, number> = {};
      let enc = 0;
      let br = 0;
      for (const s of activeScans) {
        if (s.status === 'found') {
          enc++;
          const r = (s.rota || 'SEM ROTA').trim();
          ativosRotas[r] = (ativosRotas[r] || 0) + 1;
        } else {
          br++;
        }
      }
      const rotasStr = Object.entries(ativosRotas).map(([r, c]) => `${r}:${c}`).join(' | ');
      csvContent += `"${new Date().toISOString().slice(0, 10)}","${new Date().toLocaleTimeString('pt-BR')}","Mesa Ativa","EM_ANDAMENTO",${activeScans.length},${enc},${br},"${rotasStr}"\n`;
    }

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `metricas_refugo_permanente_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleDelete = async (id: string) => {
    if (!onDeleteHistorico) return;
    const confirm = window.confirm('Deseja realmente excluir este registro histórico de refugo?');
    if (!confirm) return;

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
      {/* HEADER DA SEÇÃO */}
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
                Dados Preservados
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-0.5">
              Histórico consolidado que permanece salvo mesmo após a limpeza da mesa de refugo
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(historico.length > 0 || activeScans.length > 0) && (
            <button
              type="button"
              onClick={exportHistoricoCSV}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-gray-200 bg-gray-50 hover:bg-gray-100 text-gray-700 font-bold text-xs transition-colors cursor-pointer"
              title="Exportar métricas de refugo em arquivo CSV"
            >
              <Download className="w-4 h-4 text-gray-500" />
              <span>Exportar CSV</span>
            </button>
          )}
        </div>
      </div>

      {/* CARDS DE RESUMO DO REFUGO */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* ENCONTRADOS */}
        <div className="p-4 rounded-xl border border-cyan-100 bg-cyan-50/40">
          <div className="flex items-center justify-between text-cyan-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Quantidade Encontrada</span>
            <Target className="w-4 h-4 text-cyan-600" />
          </div>
          <div className="text-3xl font-black text-cyan-950 tabular-nums">
            {totals.totalEncontrados.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-cyan-800">
            {totals.historicoEncontrados.toLocaleString('pt-BR')} do histórico salvo
            {totals.ativosEncontrados > 0 && ` + ${totals.ativosEncontrados} na mesa`}
          </p>
        </div>

        {/* ROTAS BRANCAS / SEM ROTA */}
        <div className="p-4 rounded-xl border border-rose-100 bg-rose-50/40">
          <div className="flex items-center justify-between text-rose-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Brancas / Sem Rota</span>
            <AlertCircle className="w-4 h-4 text-rose-600" />
          </div>
          <div className="text-3xl font-black text-rose-950 tabular-nums">
            {totals.totalBrancas.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-rose-800">
            {totals.historicoBrancas.toLocaleString('pt-BR')} do histórico salvo
            {totals.ativosBrancas > 0 && ` + ${totals.ativosBrancas} na mesa`}
          </p>
        </div>

        {/* TOTAL BIPADOS */}
        <div className="p-4 rounded-xl border border-slate-200 bg-slate-50">
          <div className="flex items-center justify-between text-slate-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Total Bipados</span>
            <Barcode className="w-4 h-4 text-slate-600" />
          </div>
          <div className="text-3xl font-black text-slate-900 tabular-nums">
            {totals.totalBipados.toLocaleString('pt-BR')}
          </div>
          <p className="mt-1 text-[11px] text-slate-500">
            {totals.historicoCount} sessões arquivadas no período
          </p>
        </div>

        {/* TAXA DE EFICÁCIA */}
        <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/40">
          <div className="flex items-center justify-between text-emerald-700 mb-2">
            <span className="text-[11px] font-black uppercase tracking-wider">Taxa de Localização</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-3xl font-black text-emerald-950 tabular-nums">
            {totals.taxaAcerto}%
          </div>
          <p className="mt-1 text-[11px] text-emerald-800">
            Pacotes localizados com rota atribuída
          </p>
        </div>
      </div>

      {/* DASHBOARD GRÁFICO COMPARATIVO AO LONGO DO TEMPO (RECHARTS) */}
      <RefugoDashboardChart
        historico={historico}
        activeScans={activeScans}
        startDate={startDate}
        endDate={endDate}
      />

      {/* ROTAS ENCONTRADAS NO REFUGO */}
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
              Distribuição e contagem de pacotes encontrados por cada rota
            </p>
          </div>

          <div className="relative min-w-[200px] max-w-xs">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
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
            Nenhuma rota encontrada para o período selecionado ou termo de busca.
          </div>
        )}
      </div>

      {/* TABELA DE SESSÕES HISTÓRICAS SALVAS */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-black text-gray-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-500" />
            <span>Sessões do Refugo Salvas Permanentemente</span>
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
                    ? Object.entries(item.rotasEncontradas).map(([r, q]) => ({ rota: r, total: q }))
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
                      <td className="py-3 px-3 text-center font-bold text-gray-900 tabular-nums">
                        {item.totalBipados}
                      </td>
                      <td className="py-3 px-3 text-center font-black text-cyan-700 tabular-nums">
                        {item.totalEncontrados}
                      </td>
                      <td className="py-3 px-3 text-center font-black text-rose-700 tabular-nums">
                        {item.totalBrancas}
                      </td>
                      <td className="py-3 px-3">
                        <div className="flex items-center gap-1 flex-wrap max-w-xs">
                          {rotasArray.slice(0, 3).map(r => (
                            <span
                              key={r.rota}
                              className="px-1.5 py-0.5 bg-gray-100 text-gray-700 rounded text-[10px] font-bold border border-gray-200"
                            >
                              {r.rota}: {r.total}
                            </span>
                          ))}
                          {rotasArray.length > 3 && (
                            <span className="text-[10px] text-gray-400 font-bold">
                              +{rotasArray.length - 3}
                            </span>
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
                            title="Remover este registro histórico"
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
            <p className="text-xs font-bold text-gray-700">
              Nenhuma sessão de refugo salva ainda para o período selecionado.
            </p>
            <p className="text-[11px] text-gray-500 max-w-md mx-auto">
              Ao bipar pacotes na aba Refugo e finalizar ou limpar a base, os dados de quantidades encontradas, brancas e rotas são salvos e exibidos automaticamente aqui.
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
