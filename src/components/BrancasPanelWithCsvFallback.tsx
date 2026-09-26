import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Trash2 } from 'lucide-react';
import { BrancasPanel } from './BrancasPanel';
import { BrancasCsvFallback } from './BrancasCsvFallback';
import { BrancaRelatorioResponse } from '../lib/brancasApi';
import { User } from '../lib/auth';
import {
  clearBrancasCsvSequence,
  getBrancasCsvHistory,
  getLastBrancasCsvReport,
} from '../lib/brancasCsvFallback';

interface BrancasPanelWithCsvFallbackProps {
  currentUser?: User | null;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

const EMPTY_LOCAL_REPORT: BrancaRelatorioResponse = {
  hasData: false,
  totalBrancas: 0,
  totalRotas: 0,
  totalRoteirizados: 0,
  totalNaoRoteirizados: 0,
  totalRecuperados: 0,
  totalContinuamFalhando: 0,
  roteirizados: 0,
  naoRoteirizados: 0,
  recuperados: 0,
  continuamFalhando: 0,
  taxaRoteirizacao: 0,
  motivos: {},
  statusCounts: {},
  itemsNaoRoteirizados: [],
  itemsRecuperados: [],
  itemsAll: [],
  recentRuns: [],
  statusBanner: 'Carregue as Brancas do dia e a primeira lista de rotas.',
};

export const BrancasPanelWithCsvFallback: React.FC<BrancasPanelWithCsvFallbackProps> = ({
  currentUser,
}) => {
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvReport, setCsvReport] = useState<BrancaRelatorioResponse | null>(() =>
    getLastBrancasCsvReport()
  );
  const [panelKey, setPanelKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!originalFetchRef.current) {
      originalFetchRef.current = window.fetch.bind(window);
    }

    const originalFetch = originalFetchRef.current;

    const activeReport = csvReport || EMPTY_LOCAL_REPORT;

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/api/brancas/relatorio')) {
        return jsonResponse({ ok: true, data: activeReport });
      }

      if (url.includes('/api/brancas/sync')) {
        return jsonResponse({
          ok: true,
          data: {
            ...activeReport,
            ok: true,
            changed: false,
            hasChanges: false,
            isNewRun: false,
            partialSuccess: false,
            statusBanner: activeReport.statusBanner,
            message: 'Modo local ativo. Use “Carregar rotas” para selecionar o próximo CSV.',
          },
        });
      }

      if (url.includes('/api/brancas/historico')) {
        const parsedUrl = new URL(url, window.location.origin);
        const idPacote = parsedUrl.searchParams.get('id') || parsedUrl.searchParams.get('idPacote') || '';
        const movimentacoes = getBrancasCsvHistory(idPacote);
        const last = movimentacoes[movimentacoes.length - 1];
        return jsonResponse({
          ok: true,
          data: {
            idPacote,
            found: movimentacoes.length > 0,
            ultimoResultado: last?.resultado || null,
            ultimoCicloTentativa: last?.cicloTentativa || null,
            movimentacoes,
          },
        });
      }

      return originalFetch(input, init);
    };

    setPanelKey((value) => value + 1);

    return () => {
      window.fetch = originalFetch;
    };
  }, [csvReport]);

  function handleCsvAnalysisReady(data: BrancaRelatorioResponse) {
    setCsvReport(data);
    setFlowMessage(data.message || 'Rotas CSV atualizadas.');
  }

  async function handleResetFlow() {
    const confirmed = window.confirm(
      'Zerar todo o fluxo de Brancas? A próxima análise precisará salvar uma nova ext_brancas como base.'
    );
    if (!confirmed) return;

    setResetting(true);
    setFlowMessage(null);
    try {
      const originalFetch = originalFetchRef.current;
      if (originalFetch) window.fetch = originalFetch;

      clearBrancasCsvSequence();
      setCsvReport(null);
      setPanelKey((value) => value + 1);
      setFlowMessage('Fluxo local zerado. A próxima análise criará uma nova base com a ext_brancas.');
    } catch (err: any) {
      setFlowMessage(err?.message || 'Falha ao zerar o fluxo.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      <section className="grid gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-indigo-50">
            <FileSpreadsheet className="h-4 w-4 text-[#2D3277]" />
          </div>

          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900">
              Análise local de Brancas e Rotas
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {csvReport
                ? 'A base de Brancas está salva neste navegador. Agora carregue somente as próximas listas de rotas.'
                : 'Primeiro carregue as Brancas do dia e uma lista de rotas. Nenhuma API é utilizada.'}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:justify-end">
          <button
            onClick={handleResetFlow}
            disabled={resetting}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {resetting ? 'Zerando...' : 'Zerar fluxo'}
          </button>

          <button
            onClick={() => setCsvModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[#2D3277] text-white text-xs font-semibold hover:bg-[#242963]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {csvReport ? 'Carregar rotas' : 'Carregar arquivos'}
          </button>
        </div>
      </section>

      {flowMessage && (
        <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-600">
          {flowMessage}
        </div>
      )}

      {csvReport && Object.keys(csvReport.roteirizadosPorLista || {}).length > 0 && (
        <section className="rounded-xl border border-emerald-200 bg-emerald-50/70 px-4 py-3">
          <div className="text-xs font-black uppercase tracking-wide text-emerald-900">
            Pacotes roteirizados por lista
          </div>
          <p className="mt-1 text-[11px] text-emerald-800">
            Conferência local: o ID conta quando também aparece no CSV de rotas do ciclo.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.entries(csvReport.roteirizadosPorLista || {}) as Array<[string, number]>)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([lista, total]) => (
                <div key={lista} className="rounded-lg border border-emerald-200 bg-white px-3 py-2 text-xs text-emerald-950 shadow-sm">
                  <span className="font-black">{lista}</span>
                  <span className="ml-2 font-bold tabular-nums">{total.toLocaleString('pt-BR')} roteirizado(s)</span>
                </div>
              ))}
          </div>
        </section>
      )}

      <BrancasPanel
        key={panelKey}
        currentUser={currentUser}
        localMode
        onRequestUpdate={() => setCsvModalOpen(true)}
      />

      <BrancasCsvFallback
        key={`${panelKey}-${csvModalOpen ? 'open' : 'closed'}`}
        open={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onAnalysisReady={handleCsvAnalysisReady}
      />
    </div>
  );
};
