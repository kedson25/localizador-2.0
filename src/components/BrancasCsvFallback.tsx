import React, { useState } from 'react';
import { FileSpreadsheet, UploadCloud, X } from 'lucide-react';
import { BrancaRelatorioResponse } from '../lib/brancasApi';
import { analisarBrancasPorCsv } from '../lib/brancasCsvFallback';

interface BrancasCsvFallbackProps {
  open: boolean;
  onClose: () => void;
  onAnalysisReady: (data: BrancaRelatorioResponse) => void;
}

export const BrancasCsvFallback: React.FC<BrancasCsvFallbackProps> = ({
  open,
  onClose,
  onAnalysisReady,
}) => {
  const [brancasFile, setBrancasFile] = useState<File | null>(null);
  const [rotasFile, setRotasFile] = useState<File | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!open) return null;

  async function handleAnalyze() {
    if (!brancasFile || !rotasFile) {
      setError('Selecione os dois arquivos: Brancas e Rotas.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const [brancasText, rotasText] = await Promise.all([
        brancasFile.text(),
        rotasFile.text(),
      ]);

      const data = analisarBrancasPorCsv(brancasText, rotasText, {
        brancas: brancasFile.name,
        rotas: rotasFile.name,
      });

      onAnalysisReady(data);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao analisar os CSVs.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/50 flex items-center justify-center p-4">
      <div className="w-full max-w-lg bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <div>
            <h3 className="text-sm font-bold text-slate-900">Modo fallback por CSV</h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Use dois arquivos quando a API ou o Google Sheets não estiver disponível.
            </p>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <label className="block">
            <span className="text-xs font-bold text-slate-700">1. CSV de Brancas</span>
            <div className="mt-2 border border-dashed border-slate-300 rounded-xl p-4 hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {brancasFile?.name || 'Selecione ext_brancas.csv'}
                  </div>
                  <div className="text-[11px] text-slate-400">Pacotes que serão analisados</div>
                </div>
              </div>
              <input
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                onChange={(event) => setBrancasFile(event.target.files?.[0] || null)}
                className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-amber-800 hover:file:bg-amber-100"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-700">2. CSV de Rotas</span>
            <div className="mt-2 border border-dashed border-slate-300 rounded-xl p-4 hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="w-5 h-5 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-semibold text-slate-800 truncate">
                    {rotasFile?.name || 'Selecione ext_rotas.csv'}
                  </div>
                  <div className="text-[11px] text-slate-400">IDs que receberam rota</div>
                </div>
              </div>
              <input
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                onChange={(event) => setRotasFile(event.target.files?.[0] || null)}
                className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-emerald-800 hover:file:bg-emerald-100"
              />
            </div>
          </label>

          {error && (
            <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-[11px] text-slate-500">
            A análise acontece no navegador. Esse modo não depende do Google Sheets e não grava nada no Firestore.
          </div>
        </div>

        <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3.5 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>

          <button
            onClick={handleAnalyze}
            disabled={!brancasFile || !rotasFile || processing}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg bg-[#2D3277] text-white text-xs font-semibold hover:bg-[#242963] disabled:opacity-50"
          >
            <UploadCloud className="w-3.5 h-3.5" />
            {processing ? 'Analisando...' : 'Analisar CSVs'}
          </button>
        </div>
      </div>
    </div>
  );
};
