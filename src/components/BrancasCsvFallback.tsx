import React, { useState } from 'react';
import {
  CheckCircle2,
  FileSpreadsheet,
  RefreshCcw,
  UploadCloud,
  X,
} from 'lucide-react';
import { BrancaRelatorioResponse } from '../lib/brancasApi';
import {
  analisarBrancasPorCsv,
  hasBrancasCsvBase,
} from '../lib/brancasCsvFallback';

interface BrancasCsvFallbackProps {
  open: boolean;
  onClose: () => void;
  onAnalysisReady: (data: BrancaRelatorioResponse) => void;
}

function formatFileSize(file: File | null): string {
  if (!file) return '';

  if (file.size < 1024) return `${file.size} B`;
  if (file.size < 1024 * 1024) return `${(file.size / 1024).toFixed(1)} KB`;
  return `${(file.size / (1024 * 1024)).toFixed(1)} MB`;
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
  const [baseSaved, setBaseSaved] = useState(() => hasBrancasCsvBase());

  if (!open) return null;

  const replacingBase = baseSaved && Boolean(brancasFile);

  async function handleAnalyze() {
    if (!baseSaved && !brancasFile) {
      setError('Selecione o CSV de Brancas para criar a base manual.');
      return;
    }

    if (!rotasFile) {
      setError('Selecione o CSV de Rotas para fazer a comparação.');
      return;
    }

    setProcessing(true);
    setError(null);

    try {
      const [brancasText, rotasText] = await Promise.all([
        brancasFile ? brancasFile.text() : Promise.resolve(undefined),
        rotasFile.text(),
      ]);

      const data = analisarBrancasPorCsv(brancasText, rotasText, {
        brancas: brancasFile?.name,
        rotas: rotasFile.name,
      });

      setBaseSaved(true);
      setBrancasFile(null);
      setRotasFile(null);
      onAnalysisReady(data);
      onClose();
    } catch (err: any) {
      setError(err?.message || 'Falha ao analisar os CSVs selecionados.');
    } finally {
      setProcessing(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4">
      <div className="w-full max-w-lg overflow-hidden rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div className="min-w-0 pr-3">
            <h3 className="text-sm font-bold text-slate-900">
              Carregar CSV manual — Brancas
            </h3>
            <p className="mt-0.5 text-xs text-slate-500">
              Selecione os arquivos do computador. A análise é feita localmente no navegador.
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-slate-100"
            aria-label="Fechar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          {baseSaved && (
            <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
              <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
              <div className="min-w-0">
                <div className="text-xs font-bold text-emerald-800">
                  Base de Brancas já carregada
                </div>
                <div className="mt-0.5 text-[11px] text-emerald-700">
                  Para continuar, carregue só Rotas. Para trocar a base, escolha um novo CSV de Brancas abaixo.
                </div>
              </div>
            </div>
          )}

          <label className="block">
            <span className="flex items-center justify-between gap-3 text-xs font-bold text-slate-700">
              <span>
                {baseSaved
                  ? 'Brancas — opcional para substituir a base'
                  : '1. Brancas — obrigatório na primeira carga'}
              </span>
              {replacingBase && (
                <span className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2 py-1 text-[10px] font-bold text-amber-800">
                  <RefreshCcw className="h-3 w-3" />
                  Nova base
                </span>
              )}
            </span>

            <div className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-amber-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {brancasFile?.name ||
                      (baseSaved
                        ? 'Manter base atual ou selecionar outro CSV'
                        : 'Selecione o CSV de Brancas')}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {brancasFile
                      ? `${formatFileSize(brancasFile)} • este arquivo será usado como base`
                      : baseSaved
                        ? 'Se nenhum arquivo for escolhido, a base salva será mantida'
                        : 'Aceita CSV exportado do Excel, Google Sheets ou arquivo TXT delimitado'}
                  </div>
                </div>
              </div>

              <input
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                onChange={(event) => {
                  setBrancasFile(event.target.files?.[0] || null);
                  setError(null);
                }}
                className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-amber-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-amber-800 hover:file:bg-amber-100"
              />
            </div>
          </label>

          <label className="block">
            <span className="text-xs font-bold text-slate-700">
              {baseSaved ? 'Rotas — selecione a nova lista' : '2. Rotas — obrigatório'}
            </span>

            <div className="mt-2 rounded-xl border border-dashed border-slate-300 p-4 hover:bg-slate-50">
              <div className="flex items-center gap-3">
                <FileSpreadsheet className="h-5 w-5 shrink-0 text-emerald-500" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-slate-800">
                    {rotasFile?.name || 'Selecione o CSV de Rotas'}
                  </div>
                  <div className="mt-0.5 text-[11px] text-slate-400">
                    {rotasFile
                      ? `${formatFileSize(rotasFile)} • será comparado com a base de Brancas`
                      : 'Pode conter ID do pacote, shipment ID, ciclo e rota'}
                  </div>
                </div>
              </div>

              <input
                type="file"
                accept=".csv,text/csv,.txt,text/plain"
                onChange={(event) => {
                  setRotasFile(event.target.files?.[0] || null);
                  setError(null);
                }}
                className="mt-3 block w-full text-xs text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-emerald-800 hover:file:bg-emerald-100"
              />
            </div>
          </label>

          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
              {error}
            </div>
          )}

          <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] text-slate-500">
            O importador reconhece vírgula, ponto e vírgula, tabulação, BOM, arquivos com <strong>sep=;</strong> e campos entre aspas. IDs duplicados são consolidados automaticamente.
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 px-3.5 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
          >
            Cancelar
          </button>

          <button
            type="button"
            onClick={handleAnalyze}
            disabled={(!baseSaved && !brancasFile) || !rotasFile || processing}
            className="inline-flex items-center gap-2 rounded-lg bg-[#2D3277] px-3.5 py-2 text-xs font-semibold text-white hover:bg-[#242963] disabled:opacity-50"
          >
            <UploadCloud className="h-3.5 w-3.5" />
            {processing
              ? 'Analisando...'
              : replacingBase
                ? 'Substituir base e analisar'
                : baseSaved
                  ? 'Analisar Rotas'
                  : 'Carregar e analisar'}
          </button>
        </div>
      </div>
    </div>
  );
};
