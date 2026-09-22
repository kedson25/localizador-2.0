import React, { useLayoutEffect, useRef, useState } from 'react';
import { FileSpreadsheet, Trash2, Wifi, WifiOff } from 'lucide-react';
import { BrancasPanel } from './BrancasPanel';
import { BrancasCsvFallback } from './BrancasCsvFallback';
import { BrancaRelatorioResponse } from '../lib/brancasApi';
import { User } from '../lib/auth';
import { resetBrancasFlow } from '../lib/brancasFlowApi';
import {
  clearBrancasCsvSequence,
  getBrancasCsvHistory,
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

export const BrancasPanelWithCsvFallback: React.FC<BrancasPanelWithCsvFallbackProps> = ({
  currentUser,
}) => {
  const originalFetchRef = useRef<typeof window.fetch | null>(null);
  const [csvModalOpen, setCsvModalOpen] = useState(false);
  const [csvReport, setCsvReport] = useState<BrancaRelatorioResponse | null>(null);
  const [panelKey, setPanelKey] = useState(0);
  const [resetting, setResetting] = useState(false);
  const [flowMessage, setFlowMessage] = useState<string | null>(null);

  useLayoutEffect(() => {
    if (!originalFetchRef.current) {
      originalFetchRef.current = window.fetch.bind(window);
    }

    const originalFetch = originalFetchRef.current;

    if (!csvReport) {
      window.fetch = originalFetch;
      return;
    }

    window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url;

      if (url.includes('/api/brancas/relatorio')) {
        return jsonResponse({ ok: true, data: csvReport });
      }

      if (url.includes('/api/brancas/sync')) {
        return jsonResponse({
          ok: true,
          data: {
            ...csvReport,
            ok: true,
            changed: false,
            hasChanges: false,
            isNewRun: false,
            partialSuccess: false,
            statusBanner: csvReport.statusBanner,
            message: 'Modo CSV ativo. Use “Atualizar CSV” para carregar a nova ext_rotas.',
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

  function handleReturnToApi() {
    const originalFetch = originalFetchRef.current;
    if (originalFetch) window.fetch = originalFetch;
    setCsvReport(null);
    setPanelKey((value) => value + 1);
    setFlowMessage(null);
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
      await resetBrancasFlow();
      setPanelKey((value) => value + 1);
      setFlowMessage('Fluxo zerado. A próxima análise criará uma nova base com a ext_brancas.');
    } catch (err: any) {
      setFlowMessage(err?.message || 'Falha ao zerar o fluxo.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="space-y-3">
      <section
        className={`border rounded-xl px-4 py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
          csvReport ? 'bg-amber-50 border-amber-200' : 'bg-white border-slate-200'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div
            className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
              csvReport ? 'bg-amber-100' : 'bg-slate-100'
            }`}
          >
            {csvReport ? (
              <WifiOff className="w-4 h-4 text-amber-700" />
            ) : (
              <Wifi className="w-4 h-4 text-emerald-600" />
            )}
          </div>

          <div className="min-w-0">
            <div className="text-xs font-bold text-slate-900">
              {csvReport ? 'Fonte: base CSV + Rotas' : 'Fonte: API / Google Sheets'}
            </div>
            <div className="text-[11px] text-slate-500 mt-0.5">
              {csvReport
                ? 'Brancas estão salvas como base local. Atualize somente a ext_rotas.'
                : 'A primeira atualização salva ext_brancas como base; depois só ext_rotas muda.'}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            onClick={handleResetFlow}
            disabled={resetting}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 bg-white text-red-700 text-xs font-semibold hover:bg-red-50 disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {resetting ? 'Zerando...' : 'Zerar fluxo'}
          </button>

          {csvReport && (
            <button
              onClick={handleReturnToApi}
              className="px-3 py-2 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-800 hover:bg-amber-50"
            >
              Voltar para API
            </button>
          )}

          <button
            onClick={() => setCsvModalOpen(true)}
            className="inline-flex items-center justify-center gap-2 px-3.5 py-2 rounded-lg bg-[#2D3277] text-white text-xs font-semibold hover:bg-[#242963]"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            {csvReport ? 'Atualizar CSV' : 'Usar CSV'}
          </button>
        </div>
      </section>

      {flowMessage && (
        <div className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs text-slate-600">
          {flowMessage}
        </div>
      )}

      <BrancasPanel key={panelKey} currentUser={currentUser} />

      <BrancasCsvFallback
        open={csvModalOpen}
        onClose={() => setCsvModalOpen(false)}
        onAnalysisReady={handleCsvAnalysisReady}
      />
    </div>
  );
};
