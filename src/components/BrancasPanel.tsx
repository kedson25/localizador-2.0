import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BookOpen,
  CheckCircle2,
  Download,
  RefreshCw,
  Search,
  TrendingUp,
  X,
} from 'lucide-react';

import {
  registrarTentativaBrancas,
  getRelatorioBrancas,
  BrancaRelatorioResponse,
  ItemNaoRoteirizado,
} from '../lib/brancasApi';

import {
  OperationalPatternInsight,
} from '../lib/operationalTranslator';

import { BrancasPacoteTimelineModal } from './BrancasPacoteTimelineModal';
import { User } from '../lib/auth';

interface BrancasPanelProps {
  currentUser?: User | null;
  localMode?: boolean;
  onRequestUpdate?: () => void;
}

type DictionaryEntry = {
  code: string;
  title: string;
  description: string;
  hypothesis?: boolean;
};

const DICTIONARY_ENTRIES: DictionaryEntry[] = [
  {
    code: 'HU_MISMATCH / HU_MISM_*',
    title: 'Divergência de HU',
    description:
      'A HU encontrada não corresponde à associação esperada pelo sistema. Pode envolver gaiola, saca ou contêiner.',
  },
  {
    code: 'ROUTED_IN_OTHER_CYCLE',
    title: 'Outro ciclo',
    description:
      'Existe uma rota associada a outro ciclo. Pode existir vínculo com um ciclo anterior.',
    hypothesis: true,
  },
  {
    code: 'WITHOUT_ROUTING',
    title: 'Sem rota',
    description:
      'O pacote não recebeu uma rota válida nesta tentativa.',
  },
  {
    code: 'PENDING_ROUTING',
    title: 'Aguardando Routh',
    description:
      'A roteirização ainda estava aguardando processamento.',
  },
  {
    code: 'DAYS_WITHOUT_CYCLE / NO_CYCLE',
    title: 'Sem ciclo',
    description:
      'Não havia um ciclo válido disponível para aquela condição de despacho.',
  },
  {
    code: 'NO_CHEAPEST',
    title: 'Regra logística',
    description:
      'Condição relacionada à opção logística de menor custo.',
    hypothesis: true,
  },
  {
    code: 'DISPATCHED_CPM',
    title: 'Já avançou',
    description:
      'O pacote já havia avançado para uma etapa de despacho.',
  },
];

function friendlyReason(value?: string): string {
  if (!value) return 'Outros';

  const text = value.toUpperCase();

  if (
    text.includes('DAYS_WITHOUT_CYCLE') ||
    text.includes('NO_CYCLE') ||
    text.includes('SEM CICLO')
  ) {
    return 'Sem ciclo';
  }

  if (
    text.includes('ROUTED_IN_OTHER_CYCLE') ||
    text.includes('OUTRO CICLO')
  ) {
    return 'Outro ciclo';
  }

  if (
    text.includes('PENDING_ROUTING') ||
    text.includes('AGUARDANDO')
  ) {
    return 'Aguardando';
  }

  if (
    text.includes('WITHOUT_ROUTING') ||
    text === 'SEM ROTA' ||
    text.includes('SEM ROTA')
  ) {
    return 'Sem rota';
  }

  if (
    text.includes('NO_CHEAPEST') ||
    text.includes('CHEAPER') ||
    text.includes('REGRA LOG')
  ) {
    return 'Regra logística';
  }

  if (
    text.includes('HU_MISMATCH') ||
    text.includes('HU_MISM') ||
    text.includes('DIVERGÊNCIA') ||
    text.includes('DIVERGENCIA')
  ) {
    return 'Divergência HU';
  }

  if (
    text.includes('DISPATCHED_CPM') ||
    text.includes('DESPACHADO')
  ) {
    return 'Já avançou';
  }

  return value;
}

function getReasonLabel(item: ItemNaoRoteirizado): string {
  return friendlyReason(
    item.tituloOperacional ||
      item.statusTraduzido ||
      item.motivoMacro ||
      item.categoriaLabel ||
      item.categoria
  );
}

function getTransitionLabel(value?: string): string {
  switch (value) {
    case 'RECUPERADO':
      return 'Roteirizou e recuperou';

    case 'CONTINUA_NAO_ROTEIRIZADO':
      return 'Sem mudança (Persistente)';

    case 'MOTIVO_ALTERADO':
      return 'Mudou motivo';

    case 'VOLTOU_A_FALHAR':
      return 'Voltou a falhar';

    case 'NOVO_NAO_ROTEIRIZADO':
      return '1ª vez sem rota';

    default:
      return 'Sem rota';
  }
}

function getTransitionStyle(value?: string): string {
  switch (value) {
    case 'RECUPERADO':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200';

    case 'CONTINUA_NAO_ROTEIRIZADO':
      return 'bg-amber-50 text-amber-700 border-amber-200';

    case 'MOTIVO_ALTERADO':
      return 'bg-purple-50 text-purple-700 border-purple-200';

    case 'VOLTOU_A_FALHAR':
      return 'bg-rose-50 text-rose-700 border-rose-200';

    default:
      return 'bg-slate-50 text-slate-700 border-slate-200';
  }
}

function formatPercent(value: number): string {
  return `${Number(value || 0).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })}%`;
}

export const BrancasPanel: React.FC<BrancasPanelProps> = ({
  localMode = false,
  onRequestUpdate,
}) => {
  const [loadingRelatorio, setLoadingRelatorio] = useState(true);

  const [relatorio, setRelatorio] =
    useState<BrancaRelatorioResponse | null>(null);

  const [isUpdating, setIsUpdating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [statusNotification, setStatusNotification] =
    useState<string | null>(null);

  const [lastCheckTimeFormatted, setLastCheckTimeFormatted] =
    useState('--:--');

  const [selectedPacoteId, setSelectedPacoteId] =
    useState<string | null>(null);

  const [showDictionaryModal, setShowDictionaryModal] =
    useState(false);

  const [searchTerm, setSearchTerm] = useState('');
  const [filterCiclo, setFilterCiclo] = useState('todos');
  const [filterReason, setFilterReason] = useState('todos');
  const [filterState, setFilterState] = useState('todos');

  const [currentPage, setCurrentPage] = useState(1);

  const pageSize = 20;

  async function carregarRelatorio(
    snapshotId?: string,
    autoCheck = true
  ) {
    setErrorMsg(null);

    try {
      const data = await getRelatorioBrancas(
        snapshotId,
        autoCheck
      );

      setRelatorio(data);

      setLastCheckTimeFormatted(
        new Date().toLocaleTimeString('pt-BR', {
          hour: '2-digit',
          minute: '2-digit',
        })
      );

      if (data.statusBanner) {
        setStatusNotification(data.statusBanner);
      }
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          'Falha ao carregar análise de etiquetas brancas.'
      );
    } finally {
      setLoadingRelatorio(false);
    }
  }

  useEffect(() => {
    carregarRelatorio(undefined, true);

    if (localMode) return;

    const interval = window.setInterval(() => {
      carregarRelatorio(undefined, true);
    }, 60_000);

    return () => {
      window.clearInterval(interval);
    };
  }, [localMode]);

  async function handleManualUpdate() {
    if (localMode) {
      onRequestUpdate?.();
      return;
    }

    setIsUpdating(true);
    setErrorMsg(null);

    try {
      const result = await registrarTentativaBrancas(
        undefined,
        true
      );

      if (result.statusBanner) {
        setStatusNotification(result.statusBanner);
      } else if (result.changed || result.hasChanges) {
        setStatusNotification(
          'Nova extração processada automaticamente.'
        );
      } else {
        setStatusNotification('Nenhuma alteração encontrada.');
      }

      await carregarRelatorio(
        result.snapshotId || result.runId,
        false
      );
    } catch (err: any) {
      setErrorMsg(
        err?.message ||
          'Falha ao verificar as planilhas.'
      );
    } finally {
      setIsUpdating(false);
    }
  }

  const metrics = useMemo(() => {
    if (!relatorio || !relatorio.hasData) {
      return {
        totalBrancas: 0,
        totalRotas: 0,
        roteirizados: 0,
        naoRoteirizados: 0,
        recuperados: 0,
        continuamFalhando: 0,
        taxaRoteirizacao: 0,

        items: [] as ItemNaoRoteirizado[],

        padroes: [] as OperationalPatternInsight[],

        extBrancasCount: 0,
        extRotasCount: 0,

        motivoAlteradoCount: 0,
        novosNaoRoteirizadosCount: 0,

        lastComparisonTimeFormatted: '--:--',
      };
    }

    let comparisonTime = '--:--';

    if (relatorio.lastComparisonTime) {
      const date = new Date(relatorio.lastComparisonTime);

      if (!Number.isNaN(date.getTime())) {
        comparisonTime = date.toLocaleTimeString(
          'pt-BR',
          {
            hour: '2-digit',
            minute: '2-digit',
          }
        );
      }
    }

    return {
      totalBrancas:
        relatorio.totalBrancas || 0,

      totalRotas:
        relatorio.totalRotas ||
        relatorio.extRotasCount ||
        0,

      roteirizados:
        relatorio.totalRoteirizados ||
        relatorio.roteirizados ||
        0,

      naoRoteirizados:
        relatorio.totalNaoRoteirizados ||
        relatorio.naoRoteirizados ||
        0,

      recuperados:
        relatorio.totalRecuperados ||
        relatorio.recuperados ||
        0,

      continuamFalhando:
        relatorio.totalContinuamFalhando ||
        relatorio.continuamFalhando ||
        0,

      taxaRoteirizacao:
        Number(relatorio.taxaRoteirizacao || 0),

      items:
        relatorio.itemsAll && relatorio.itemsAll.length > 0
          ? relatorio.itemsAll
          : [
              ...(relatorio.itemsNaoRoteirizados || []),
              ...(relatorio.itemsRecuperados || []),
            ],

      padroes:
        relatorio.padroesDetectados || [],

      extBrancasCount:
        relatorio.extBrancasCount ||
        relatorio.totalBrancas ||
        0,

      extRotasCount:
        relatorio.extRotasCount ||
        relatorio.totalRotas ||
        0,

      motivoAlteradoCount:
        relatorio.motivoAlteradoCount || 0,

      novosNaoRoteirizadosCount:
        relatorio.novosNaoRoteirizadosCount || 0,

      lastComparisonTimeFormatted:
        comparisonTime,
    };
  }, [relatorio]);

  const reasonRanking = useMemo(() => {
    const map = new Map<string, number>();

    metrics.items.forEach((item) => {
      const reason = getReasonLabel(item);

      map.set(
        reason,
        (map.get(reason) || 0) + 1
      );
    });

    const total =
      metrics.naoRoteirizados ||
      metrics.items.length;

    return Array.from(map.entries())
      .map(([name, count]) => ({
        name,
        count,
        pct:
          total > 0
            ? Number(
                ((count / total) * 100).toFixed(1)
              )
            : 0,
      }))
      .sort((a, b) => b.count - a.count);
  }, [
    metrics.items,
    metrics.naoRoteirizados,
  ]);

  const uniqueCycles = useMemo(() => {
    return Array.from(
      new Set(
        metrics.items
          .map((item) => item.cicloOrigem)
          .filter(Boolean)
      )
    ).sort();
  }, [metrics.items]);

  const uniqueReasons = useMemo(() => {
    return Array.from(
      new Set(
        metrics.items.map((item) =>
          getReasonLabel(item)
        )
      )
    ).sort();
  }, [metrics.items]);

  const uniqueStates = useMemo(() => {
    return Array.from(
      new Set(
        metrics.items
          .map((item) => item.transicao)
          .filter(Boolean)
      )
    ).sort();
  }, [metrics.items]);

  const filteredItems = useMemo(() => {
    const term = searchTerm
      .trim()
      .toLowerCase();

    return metrics.items.filter((item) => {
      if (term) {
        const searchable = [
          item.idPacote,
          item.base,
          item.cicloOrigem,
          getReasonLabel(item),
          item.statusTraduzido,
          item.motivoMacro,
        ]
          .map((value) =>
            String(value || '').toLowerCase()
          )
          .join(' ');

        if (!searchable.includes(term)) {
          return false;
        }
      }

      if (
        filterCiclo !== 'todos' &&
        item.cicloOrigem !== filterCiclo
      ) {
        return false;
      }

      if (
        filterReason !== 'todos' &&
        getReasonLabel(item) !== filterReason
      ) {
        return false;
      }

      if (
        filterState !== 'todos' &&
        item.transicao !== filterState
      ) {
        return false;
      }

      return true;
    });
  }, [
    metrics.items,
    searchTerm,
    filterCiclo,
    filterReason,
    filterState,
  ]);

  const totalPages = Math.max(
    1,
    Math.ceil(filteredItems.length / pageSize)
  );

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  const paginatedItems = useMemo(() => {
    const start =
      (currentPage - 1) * pageSize;

    return filteredItems.slice(
      start,
      start + pageSize
    );
  }, [
    filteredItems,
    currentPage,
    pageSize,
  ]);

  function handleReasonClick(reason: string) {
    setFilterReason((current) =>
      current === reason ? 'todos' : reason
    );

    setCurrentPage(1);
  }

  function handleExportCsv() {
    if (!filteredItems.length) return;

    const headers = [
      'ID_PACOTE',
      'DATA',
      'BASE',
      'CICLO',
      'MOTIVO',
      'MOTIVO_MACRO',
      'STATUS',
      'TRANSICAO',
      'TENTATIVAS',
    ];

    const rows = filteredItems.map((item) => [
      `"${item.idPacote}"`,
      `"${item.dataBranca || ''}"`,
      `"${item.base || ''}"`,
      `"${item.cicloOrigem || ''}"`,
      `"${getReasonLabel(item)}"`,
      `"${item.motivoMacro || ''}"`,
      `"${item.statusTraduzido || ''}"`,
      `"${item.transicao || ''}"`,
      `"${item.tentativasCount || 1}"`,
    ]);

    const csv =
      '\uFEFF' +
      [
        headers.join(','),
        ...rows.map((row) =>
          row.join(',')
        ),
      ].join('\n');

    const blob = new Blob([csv], {
      type: 'text/csv;charset=utf-8',
    });

    const url =
      URL.createObjectURL(blob);

    const link =
      document.createElement('a');

    link.href = url;

    link.download =
      `brancas_${new Date()
        .toISOString()
        .slice(0, 10)}.csv`;

    document.body.appendChild(link);

    link.click();

    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  }

  const cards = [
    {
      label: 'BRANCAS',
      value: metrics.totalBrancas,
      valueClass: 'text-slate-900',
    },
    {
      label: 'ROTEIRIZADOS',
      value: metrics.roteirizados,
      valueClass: 'text-emerald-600',
    },
    {
      label: 'SEM ROTA',
      value: metrics.naoRoteirizados,
      valueClass: 'text-rose-600',
    },
    {
      label: 'RECUPERADOS',
      value: metrics.recuperados,
      valueClass: 'text-blue-600',
    },
    {
      label: 'TAXA',
      value: formatPercent(
        metrics.taxaRoteirizacao
      ),
      valueClass: 'text-[#2D3277]',
    },
  ];

  const changeItems = [
    metrics.recuperados > 0
      ? {
          stateKey: 'RECUPERADO',
          label: 'Roteirizou e recuperou',
          value: metrics.recuperados,
          className:
            'text-emerald-700 bg-emerald-50 border-emerald-200 hover:bg-emerald-100 cursor-pointer',
        }
      : null,

    metrics.continuamFalhando > 0
      ? {
          stateKey: 'CONTINUA_NAO_ROTEIRIZADO',
          label: 'Sem mudança na rota',
          value:
            metrics.continuamFalhando,
          className:
            'text-rose-700 bg-rose-50 border-rose-200 hover:bg-rose-100 cursor-pointer',
        }
      : null,

    metrics.motivoAlteradoCount > 0
      ? {
          stateKey: 'MOTIVO_ALTERADO',
          label: 'Mudou motivo',
          value:
            metrics.motivoAlteradoCount,
          className:
            'text-purple-700 bg-purple-50 border-purple-200 hover:bg-purple-100 cursor-pointer',
        }
      : null,

    metrics.novosNaoRoteirizadosCount > 0
      ? {
          stateKey: 'NOVO_NAO_ROTEIRIZADO',
          label: '1ª vez sem rota',
          value:
            metrics.novosNaoRoteirizadosCount,
          className:
            'text-slate-700 bg-slate-50 border-slate-200 hover:bg-slate-100 cursor-pointer',
        }
      : null,
  ].filter(Boolean) as Array<{
    stateKey: string;
    label: string;
    value: number;
    className: string;
  }>;

  return (
    <div className="space-y-4 pb-10">
      {/* STATUS AUTOMÁTICO */}
      <section className="bg-white border border-slate-200 rounded-xl px-4 py-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs">
            <div className="flex items-center gap-2 font-semibold text-slate-800">
              <span className="w-2 h-2 rounded-full bg-emerald-500" />
              {localMode ? 'Processamento local' : 'Automático'}
            </div>

            <div className="text-slate-500">
              Brancas{' '}
              <strong className="text-slate-900">
                {metrics.extBrancasCount}
              </strong>
            </div>

            <div className="text-slate-500">
              Rotas{' '}
              <strong className="text-slate-900">
                {metrics.extRotasCount}
              </strong>
            </div>

            <div className="text-slate-500">
              Atualizado{' '}
              <strong className="text-slate-700">
                {metrics.lastComparisonTimeFormatted}
              </strong>
            </div>

            <div className="text-slate-400">
              Verificado {lastCheckTimeFormatted}
            </div>
          </div>

          <button
            onClick={handleManualUpdate}
            disabled={
              isUpdating || loadingRelatorio
            }
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[#2D3277] text-white text-xs font-semibold hover:bg-[#242963] disabled:opacity-50"
          >
            <RefreshCw
              className={`w-3.5 h-3.5 ${
                isUpdating
                  ? 'animate-spin'
                  : ''
              }`}
            />

            {isUpdating
              ? 'Verificando...'
              : localMode
                ? 'Carregar rotas'
                : 'Atualizar'}
          </button>
        </div>

        {statusNotification && (
          <div className="mt-2 text-xs text-slate-500">
            {statusNotification}
          </div>
        )}

        {errorMsg && (
          <div className="mt-3 flex items-center gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0" />
            {errorMsg}
          </div>
        )}
      </section>

      {/* MÉTRICAS */}
      <section className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-white border border-slate-200 rounded-xl px-4 py-4"
          >
            <div className="text-[10px] font-bold tracking-wider text-slate-400">
              {card.label}
            </div>

            <div
              className={`mt-1 text-2xl sm:text-3xl font-bold tabular-nums ${card.valueClass}`}
            >
              {card.value}
            </div>
          </div>
        ))}
      </section>

      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Relatórios diários</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Base inicial: {relatorio?.baseDate || 'aguardando primeira carga'} {relatorio?.baseCycle ? `• ${relatorio.baseCycle}` : ''}
            </p>
          </div>
          {relatorio?.attemptDate && (
            <span className="text-xs font-semibold px-2.5 py-1 rounded-md bg-indigo-50 text-[#2D3277]">
              Atual: {relatorio.attemptDate} • {relatorio.attemptCycle || 'sem ciclo'}
            </span>
          )}
        </div>

        {(relatorio?.recentRuns || []).length === 0 ? (
          <p className="text-xs text-slate-500 py-3">Carregue a base inicial para criar o primeiro relatório.</p>
        ) : (
          <div className="divide-y divide-slate-100">
            {relatorio!.recentRuns.map((run) => (
              <button
                key={run.runId}
                onClick={() => carregarRelatorio(run.snapshotId || run.runId, false)}
                className="w-full grid grid-cols-[1fr_auto] sm:grid-cols-5 gap-2 text-left py-3 hover:bg-slate-50 rounded-lg px-2"
              >
                <span className="text-xs font-semibold text-slate-800">{run.attemptDate || run.createdAt?.slice(0, 10) || 'Sem data'} • {run.attemptCycle || run.ciclosDetectados?.[0] || 'Base inicial'}</span>
                <span className="text-xs text-slate-500 sm:text-center">{run.totalBrancas} base</span>
                <span className="text-xs text-emerald-700 sm:text-center">{run.roteirizados} roteirizados</span>
                <span className="text-xs text-amber-700 sm:text-center">{run.naoRoteirizados} pendentes</span>
                <span className="text-xs font-semibold text-[#2D3277] sm:text-right">{run.recuperados || 0} recuperados</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* MOTIVOS */}
      <section className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-bold text-slate-900">
            Por que não seguiram?
          </h2>

          <button
            onClick={() =>
              setShowDictionaryModal(true)
            }
            className="inline-flex items-center gap-1.5 text-xs font-medium text-[#2D3277] hover:bg-slate-50 px-2.5 py-1.5 rounded-lg"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Entender motivos
          </button>
        </div>

        {reasonRanking.length === 0 ? (
          <div className="py-8 flex flex-col items-center text-center">
            <CheckCircle2 className="w-7 h-7 text-emerald-500 mb-2" />

            <div className="text-sm font-semibold text-slate-800">
              Nenhum pacote sem rota
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {reasonRanking.map((item) => {
              const selected =
                filterReason === item.name;

              return (
                <button
                  key={item.name}
                  onClick={() =>
                    handleReasonClick(
                      item.name
                    )
                  }
                  className={`w-full text-left rounded-lg p-2.5 transition-colors ${
                    selected
                      ? 'bg-indigo-50'
                      : 'hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center justify-between gap-3 mb-1.5">
                    <span className="text-xs font-semibold text-slate-800">
                      {item.name}
                    </span>

                    <div className="flex items-center gap-3 tabular-nums">
                      <span className="text-xs font-bold text-slate-900">
                        {item.count}
                      </span>

                      <span className="text-[11px] text-slate-400 min-w-[44px] text-right">
                        {item.pct}%
                      </span>
                    </div>
                  </div>

                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[#2D3277] rounded-full"
                      style={{
                        width: `${Math.max(
                          2,
                          item.pct
                        )}%`,
                      }}
                    />
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ALTERAÇÕES */}
      {changeItems.length > 0 && (
        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-bold text-slate-900">
              Mudou desde a última análise
            </h2>
            {filterState !== 'todos' && (
              <button
                onClick={() => setFilterState('todos')}
                className="text-xs text-[#2D3277] hover:underline font-medium"
              >
                Limpar filtro de estado ({getTransitionLabel(filterState)})
              </button>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            {changeItems.map((item) => {
              const isSelected = filterState === item.stateKey;
              return (
                <button
                  key={item.label}
                  onClick={() => {
                    setFilterState((curr) => (curr === item.stateKey ? 'todos' : item.stateKey));
                    setCurrentPage(1);
                  }}
                  className={`inline-flex items-center gap-3 px-3 py-2 rounded-lg border transition-all ${
                    item.className
                  } ${
                    isSelected ? 'ring-2 ring-indigo-500 ring-offset-1 font-bold shadow-sm' : ''
                  }`}
                  title={`Clique para filtrar por ${item.label}`}
                >
                  <strong className="text-base tabular-nums">
                    {item.value}
                  </strong>

                  <span className="text-xs font-medium">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}

      {/* TABELA */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="p-4 border-b border-slate-200">
          <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">
                Pacotes sem rota
              </h2>

              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                {filteredItems.length}
              </span>
            </div>

            <button
              onClick={handleExportCsv}
              disabled={
                filteredItems.length === 0
              }
              className="inline-flex items-center justify-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-40"
            >
              <Download className="w-3.5 h-3.5" />
              CSV
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />

              <input
                value={searchTerm}
                onChange={(event) => {
                  setSearchTerm(
                    event.target.value
                  );
                  setCurrentPage(1);
                }}
                placeholder="Buscar ID..."
                className="w-full h-9 pl-9 pr-3 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none focus:bg-white focus:ring-2 focus:ring-indigo-100 focus:border-indigo-300"
              />
            </div>

            <select
              value={filterCiclo}
              onChange={(event) => {
                setFilterCiclo(
                  event.target.value
                );
                setCurrentPage(1);
              }}
              className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
            >
              <option value="todos">
                Todos ciclos
              </option>

              {uniqueCycles.map((cycle) => (
                <option
                  key={cycle}
                  value={cycle}
                >
                  {cycle}
                </option>
              ))}
            </select>

            <select
              value={filterReason}
              onChange={(event) => {
                setFilterReason(
                  event.target.value
                );
                setCurrentPage(1);
              }}
              className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
            >
              <option value="todos">
                Todas causas
              </option>

              {uniqueReasons.map((reason) => (
                <option
                  key={reason}
                  value={reason}
                >
                  {reason}
                </option>
              ))}
            </select>

            <select
              value={filterState}
              onChange={(event) => {
                setFilterState(
                  event.target.value
                );
                setCurrentPage(1);
              }}
              className="h-9 px-3 bg-slate-50 border border-slate-200 rounded-lg text-xs outline-none"
            >
              <option value="todos">
                Todos estados
              </option>

              {uniqueStates.map((state) => (
                <option
                  key={state}
                  value={state}
                >
                  {getTransitionLabel(
                    state
                  )}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400">
                  ID
                </th>

                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400">
                  CICLO
                </th>

                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400">
                  MOTIVO
                </th>

                <th className="text-left px-4 py-3 text-[10px] font-bold text-slate-400">
                  ESTADO
                </th>

                <th className="text-center px-4 py-3 text-[10px] font-bold text-slate-400">
                  TENTATIVAS
                </th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-100">
              {loadingRelatorio ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-12 text-center text-xs text-slate-500"
                  >
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-[#2D3277]" />
                    Carregando...
                  </td>
                </tr>
              ) : paginatedItems.length ===
                0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-12 text-center text-xs text-slate-400"
                  >
                    Nenhum pacote encontrado
                  </td>
                </tr>
              ) : (
                paginatedItems.map(
                  (item) => (
                    <tr
                      key={item.idPacote}
                      onClick={() =>
                        setSelectedPacoteId(
                          item.idPacote
                        )
                      }
                      className="hover:bg-slate-50 cursor-pointer"
                    >
                      <td className="px-4 py-3">
                        <span className="font-mono text-xs font-bold text-[#2D3277]">
                          {item.idPacote}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <span className="text-xs font-semibold text-slate-700">
                          {item.transicao === 'RECUPERADO' && item.cicloDestino && item.cicloDestino !== item.cicloOrigem
                            ? `${item.cicloOrigem || 'AM1'} ➔ ${item.cicloDestino}`
                            : item.cicloOrigem || '—'}
                        </span>
                      </td>

                      <td className="px-4 py-3">
                        <div className="flex flex-col">
                          <span className="text-xs font-semibold text-slate-900">
                            {getReasonLabel(item)}
                          </span>
                          {item.transicao === 'MOTIVO_ALTERADO' && item.motivoAnterior && (
                            <span className="text-[10px] text-purple-700 font-medium mt-0.5">
                              De: {friendlyReason(item.motivoAnterior)} ➔ {getReasonLabel(item)}
                            </span>
                          )}
                          {item.statusTraduzido && item.statusTraduzido !== getReasonLabel(item) && (
                            <span className="text-[10px] text-slate-500 line-clamp-1">
                              {item.statusTraduzido}
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex px-2 py-1 rounded-md border text-[10px] font-semibold ${getTransitionStyle(
                            item.transicao
                          )}`}
                        >
                          {getTransitionLabel(
                            item.transicao
                          )}
                        </span>
                      </td>

                      <td className="px-4 py-3 text-center">
                        <span className="text-xs font-bold tabular-nums text-slate-700">
                          {item.tentativasCount ||
                            1}
                        </span>
                      </td>
                    </tr>
                  )
                )
              )}
            </tbody>
          </table>
        </div>

        {filteredItems.length >
          pageSize && (
          <div className="px-4 py-3 border-t border-slate-200 flex items-center justify-between">
            <span className="text-xs text-slate-400">
              {Math.min(
                (currentPage - 1) *
                  pageSize +
                  1,
                filteredItems.length
              )}
              –
              {Math.min(
                currentPage * pageSize,
                filteredItems.length
              )}{' '}
              de {filteredItems.length}
            </span>

            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.max(
                      1,
                      page - 1
                    )
                  )
                }
                disabled={
                  currentPage === 1
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
              >
                Anterior
              </button>

              <span className="text-xs text-slate-500">
                {currentPage}/
                {totalPages}
              </span>

              <button
                onClick={() =>
                  setCurrentPage((page) =>
                    Math.min(
                      totalPages,
                      page + 1
                    )
                  )
                }
                disabled={
                  currentPage ===
                  totalPages
                }
                className="px-3 py-1.5 rounded-lg border border-slate-200 text-xs disabled:opacity-30"
              >
                Próxima
              </button>
            </div>
          </div>
        )}
      </section>

      {/* DICIONÁRIO */}
      {showDictionaryModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
          <div className="w-full max-w-xl bg-white rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h3 className="text-sm font-bold text-slate-900">
                  Entender motivos
                </h3>

                <p className="text-xs text-slate-400 mt-0.5">
                  Tradução simples dos códigos
                </p>
              </div>

              <button
                onClick={() =>
                  setShowDictionaryModal(
                    false
                  )
                }
                className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[65vh] overflow-y-auto divide-y divide-slate-100">
              {DICTIONARY_ENTRIES.map(
                (entry) => (
                  <div
                    key={entry.code}
                    className="px-5 py-4"
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-sm font-semibold text-slate-900">
                        {entry.title}
                      </span>

                      {entry.hypothesis && (
                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-amber-50 border border-amber-200 text-amber-700">
                          HIPÓTESE
                        </span>
                      )}
                    </div>

                    <p className="text-xs text-slate-600">
                      {entry.description}
                    </p>

                    <div className="mt-2 text-[10px] font-mono text-slate-400">
                      {entry.code}
                    </div>
                  </div>
                )
              )}
            </div>
          </div>
        </div>
      )}

      {/* TIMELINE */}
      <BrancasPacoteTimelineModal
        idPacote={selectedPacoteId}
        onClose={() =>
          setSelectedPacoteId(null)
        }
      />
    </div>
  );
};
