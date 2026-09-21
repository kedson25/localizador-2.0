import React, { useEffect, useState } from 'react';
import { X, Clock, CheckCircle2, AlertTriangle, Sparkles, RefreshCw, Layers, Calendar, ArrowDown, HelpCircle, Tag } from 'lucide-react';
import { getHistoricoPacote, PacoteHistoricoResponse } from '../lib/brancasApi';
import { translateRoutingPattern } from '../lib/operationalTranslator';

interface BrancasPacoteTimelineModalProps {
  idPacote: string | null;
  onClose: () => void;
}

export const BrancasPacoteTimelineModal: React.FC<BrancasPacoteTimelineModalProps> = ({
  idPacote,
  onClose,
}) => {
  const [loading, setLoading] = useState(true);
  const [historico, setHistorico] = useState<PacoteHistoricoResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!idPacote) return;

    let mounted = true;
    setLoading(true);
    setError(null);

    getHistoricoPacote(idPacote)
      .then(data => {
        if (mounted) {
          setHistorico(data);
          setLoading(false);
        }
      })
      .catch(err => {
        if (mounted) {
          setError(err.message || 'Erro ao consultar histórico.');
          setLoading(false);
        }
      });

    return () => {
      mounted = false;
    };
  }, [idPacote]);

  if (!idPacote) return null;

  const renderBadgeTransicao = (transicao?: string, resultado?: string) => {
    switch (transicao) {
      case 'RECUPERADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
            <Sparkles className="w-3 h-3 text-emerald-600" />
            RECUPERADO
          </span>
        );
      case 'CONTINUA_NAO_ROTEIRIZADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-300">
            <Clock className="w-3 h-3 text-amber-600" />
            CONTINUA SEM ROTA
          </span>
        );
      case 'MOTIVO_ALTERADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-purple-100 text-purple-800 border border-purple-300">
            <RefreshCw className="w-3 h-3 text-purple-600" />
            MOTIVO ALTERADO
          </span>
        );
      case 'VOLTOU_A_FALHAR':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-rose-100 text-rose-800 border border-rose-300">
            <AlertTriangle className="w-3 h-3 text-rose-600" />
            VOLTOU A FALHAR
          </span>
        );
      case 'NOVO_NAO_ROTEIRIZADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 text-slate-800 border border-slate-300">
            1ª VEZ SEM ROTA
          </span>
        );
      case 'ROTEIRIZADO':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 text-blue-800 border border-blue-300">
            <CheckCircle2 className="w-3 h-3 text-blue-600" />
            ROTEIRIZADO
          </span>
        );
      default:
        return (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${
            resultado === 'ROTEIRIZADO' ? 'bg-blue-100 text-blue-800' : 'bg-red-100 text-red-800'
          }`}>
            {resultado || 'N/A'}
          </span>
        );
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex justify-end animate-in fade-in duration-200">
      <div 
        className="w-full max-w-lg bg-white min-h-screen shadow-2xl flex flex-col border-l border-slate-200 animate-in slide-in-from-right duration-300"
        role="dialog"
        aria-modal="true"
      >
        {/* Header Drawer */}
        <div className="px-6 py-5 bg-slate-900 text-white flex items-center justify-between border-b border-slate-800 shrink-0">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-wider text-amber-400 font-bold">
                Linha do Tempo
              </span>
              <span className="text-[10px] bg-slate-800 text-slate-300 px-2 py-0.5 rounded font-mono">
                Memória Firebase
              </span>
            </div>
            <h3 className="text-lg font-bold font-mono tracking-tight text-white mt-1">
              Pacote {idPacote}
            </h3>
          </div>
          <button
            onClick={onClose}
            className="w-9 h-9 rounded-lg bg-slate-800 text-slate-400 hover:text-white hover:bg-slate-700 flex items-center justify-center transition-colors cursor-pointer"
            title="Fechar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Body */}
        <div className="flex-1 p-6 overflow-y-auto space-y-6">
          {loading ? (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
              <RefreshCw className="w-7 h-7 text-[#2D3277] animate-spin" />
              <p className="text-sm font-medium">Buscando histórico do pacote...</p>
            </div>
          ) : error ? (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
              <div>
                <p className="text-xs font-bold">Erro ao carregar dados</p>
                <p className="text-xs mt-1">{error}</p>
              </div>
            </div>
          ) : !historico || historico.movimentacoes.length === 0 ? (
            <div className="text-center py-16 text-slate-500 space-y-2">
              <Clock className="w-10 h-10 mx-auto text-slate-300 stroke-1" />
              <p className="text-sm font-semibold text-slate-700">Primeira observação registrada</p>
              <p className="text-xs text-slate-500 max-w-xs mx-auto">
                Este pacote foi capturado no snapshot operacional atual e seu histórico continuará sendo monitorado automaticamente.
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Status Atual do Pacote */}
              <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl">
                <div className="text-xs text-slate-500 font-medium mb-1">Último Estado Gravado</div>
                <div className="flex items-center justify-between">
                  <span className={`text-base font-bold ${
                    historico.ultimoResultado === 'ROTEIRIZADO' ? 'text-emerald-700' : 'text-rose-700'
                  }`}>
                    {historico.ultimoResultado === 'ROTEIRIZADO' ? 'ROTEIRIZADO (Em Rota)' : 'NÃO ROTEIRIZADO (Sem Rota)'}
                  </span>
                  {historico.ultimoCicloTentativa && (
                    <span className="text-xs font-mono font-bold px-2.5 py-1 bg-white border border-slate-200 rounded-md text-slate-700">
                      Ciclo {historico.ultimoCicloTentativa}
                    </span>
                  )}
                </div>
              </div>

              {/* Linha do Tempo Sequencial */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-500 mb-4 flex items-center gap-2">
                  <Layers className="w-3.5 h-3.5 text-slate-400" />
                  Evolução Cronológica ({historico.movimentacoes.length} eventos)
                </h4>

                <div className="relative pl-6 space-y-6 before:absolute before:left-2.5 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-200">
                  {historico.movimentacoes.map((mov, idx) => {
                    const isLast = idx === historico.movimentacoes.length - 1;
                    const dateObj = new Date(mov.dataRegistro || mov.timestamp);
                    const formattedDate = dateObj.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
                    const formattedTime = dateObj.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

                    const isRoteirizado = mov.resultado === 'ROTEIRIZADO';
                    const translation = translateRoutingPattern(undefined, mov.motivo, undefined, mov.status);

                    return (
                      <div key={mov.id || idx} className="relative group">
                        {/* Ponto na linha vertical */}
                        <div className={`absolute -left-6 top-1 w-5 h-5 rounded-full border-2 bg-white flex items-center justify-center transition-all ${
                          isRoteirizado
                            ? 'border-emerald-500 text-emerald-600 shadow-xs'
                            : mov.transicao === 'MOTIVO_ALTERADO'
                            ? 'border-purple-500 text-purple-600'
                            : 'border-rose-400 text-rose-500'
                        }`}>
                          <div className={`w-2 h-2 rounded-full ${
                            isRoteirizado ? 'bg-emerald-500' : mov.transicao === 'MOTIVO_ALTERADO' ? 'bg-purple-500' : 'bg-rose-400'
                          }`} />
                        </div>

                        {/* Card do Passo */}
                        <div className={`p-4 rounded-xl border transition-all ${
                          isLast ? 'bg-blue-50/40 border-blue-200 ring-1 ring-blue-100' : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}>
                          {/* Cabeçalho do evento */}
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-mono font-bold px-2 py-0.5 bg-slate-900 text-white rounded">
                                {mov.cicloTentativa || 'N/D'}
                              </span>
                              <span className="text-xs font-mono text-slate-500 flex items-center gap-1">
                                <Clock className="w-3 h-3 text-slate-400" />
                                {formattedTime}
                              </span>
                            </div>
                            <div>{renderBadgeTransicao(mov.transicao, mov.resultado)}</div>
                          </div>

                          {/* Data detalhada */}
                          <div className="text-[11px] text-slate-400 mb-2 flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formattedDate}
                          </div>

                          {/* Tradução Operacional */}
                          <div className="space-y-2 pt-2 border-t border-slate-100">
                            <div>
                              <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-bold text-slate-900">{translation.titulo}</span>
                                <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  translation.badgeTipo === 'FATO'
                                    ? 'bg-blue-100 text-blue-800'
                                    : translation.badgeTipo === 'PADRAO'
                                    ? 'bg-emerald-100 text-emerald-800'
                                    : 'bg-amber-100 text-amber-800'
                                }`}>
                                  [{translation.badgeTipo}]
                                </span>
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed">
                                {translation.explicacao}
                              </p>
                            </div>

                            {/* Motivo e status técnico original */}
                            <div className="text-[11px] text-slate-500 bg-slate-50 p-2 rounded-lg border border-slate-100">
                              <div><span className="font-semibold text-slate-700">Código original:</span> {mov.motivo || 'NÃO INFORMADO'}</div>
                              {mov.status && <div><span className="font-semibold text-slate-700">Status:</span> {mov.status}</div>}
                            </div>
                          </div>
                        </div>

                        {/* Conector indicador de fluxo */}
                        {!isLast && (
                          <div className="flex justify-center py-1">
                            <ArrowDown className="w-3.5 h-3.5 text-slate-300" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 flex justify-end shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 text-white rounded-xl text-xs font-semibold hover:bg-slate-800 transition-colors cursor-pointer"
          >
            Fechar Linha do Tempo
          </button>
        </div>
      </div>
    </div>
  );
};
