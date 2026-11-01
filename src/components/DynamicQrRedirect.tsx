import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { ExternalLink, AlertTriangle, ArrowRight, PauseCircle, QrCode } from 'lucide-react';
import { getDynamicQrByCode, recordQrScan, DynamicQr } from '../lib/dynamicQr';

export const DynamicQrRedirect: React.FC = () => {
  const { code: routeCode } = useParams<{ code?: string }>();
  const [searchParams] = useSearchParams();
  const queryCode = searchParams.get('qr') || searchParams.get('r') || searchParams.get('code');
  const code = (routeCode || queryCode || '').trim();

  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState<DynamicQr | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [countdown, setCountdown] = useState(2);

  useEffect(() => {
    if (!code) {
      setError('Código de QR Code não informado.');
      setLoading(false);
      return;
    }

    let isCancelled = false;

    async function resolveRedirect() {
      try {
        const item = await getDynamicQrByCode(code);
        if (isCancelled) return;

        if (!item) {
          setError(`QR Code "${code}" não foi encontrado no sistema ou foi removido.`);
          setLoading(false);
          return;
        }

        setQrData(item);

        if (item.status === 'paused') {
          setError('Este QR Code foi temporariamente pausado pela equipe.');
          setLoading(false);
          return;
        }

        if (!item.targetUrl) {
          setError('Nenhum link de destino foi configurado para este QR Code.');
          setLoading(false);
          return;
        }

        // Registra o scan em segundo plano
        recordQrScan(item.id);

        // Inicia contagem regressiva suave e redireciona
        setLoading(false);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Erro ao processar redirecionamento:', err);
        setError('Ocorreu um erro ao localizar o destino deste QR Code.');
        setLoading(false);
      }
    }

    resolveRedirect();

    return () => {
      isCancelled = true;
    };
  }, [code]);

  useEffect(() => {
    if (!qrData || qrData.status === 'paused' || !qrData.targetUrl || error) return;

    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(timer);
          window.location.replace(qrData.targetUrl);
          return 0;
        }
        return prev - 1;
      });
    }, 800);

    return () => clearInterval(timer);
  }, [qrData, error]);

  const handleImmediateRedirect = () => {
    if (qrData?.targetUrl) {
      window.location.replace(qrData.targetUrl);
    }
  };

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-900 px-4 text-slate-100">
      {/* Brand Header */}
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFE600] text-slate-950 font-black shadow-lg">
          <QrCode className="h-6 w-6" />
        </div>
        <div className="text-2xl font-black tracking-tight text-white">ecooy</div>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-slate-700 bg-slate-800/95 p-6 shadow-2xl backdrop-blur sm:p-8">
        {loading ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="relative mb-4 flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-slate-700 border-t-[#FFE600] animate-spin" />
              <QrCode className="h-6 w-6 text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-white">Localizando destino...</h2>
            <p className="mt-1 text-xs text-slate-400">Consultando o link atualizado do QR Code</p>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center py-4 text-center">
            {qrData?.status === 'paused' ? (
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-amber-500/20 text-amber-400">
                <PauseCircle className="h-7 w-7" />
              </div>
            ) : (
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/20 text-red-400">
                <AlertTriangle className="h-7 w-7" />
              </div>
            )}
            <h2 className="text-base font-extrabold text-white">
              {qrData?.status === 'paused' ? 'QR Code Temporariamente Pausado' : 'Não foi possível redirecionar'}
            </h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">{error}</p>
            {qrData?.title && (
              <div className="mt-4 rounded-lg bg-slate-900/80 p-3 text-left w-full border border-slate-700">
                <div className="text-[10px] uppercase font-bold text-slate-500">Item</div>
                <div className="text-xs font-semibold text-white truncate">{qrData.title}</div>
              </div>
            )}
            <a
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-700 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-600"
            >
              Ir para o Sistema
            </a>
          </div>
        ) : qrData ? (
          <div className="flex flex-col items-center py-2 text-center">
            <div className="relative mb-4 flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 rounded-full border-4 border-slate-700 border-t-emerald-400 animate-spin" />
              <ExternalLink className="h-6 w-6 text-emerald-400" />
            </div>

            <div className="inline-block rounded-full bg-emerald-500/20 px-3 py-1 text-[11px] font-bold text-emerald-300 border border-emerald-500/30 mb-3">
              Redirecionando em {countdown}s...
            </div>

            <h2 className="text-lg font-black text-white">{qrData.title}</h2>
            {qrData.description && (
              <p className="mt-1 text-xs text-slate-300 line-clamp-2">{qrData.description}</p>
            )}

            <div className="mt-5 w-full rounded-xl bg-slate-900/90 border border-slate-700/80 p-3 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
                Destino Atual
              </span>
              <p className="truncate text-xs font-mono text-emerald-300" title={qrData.targetUrl}>
                {qrData.targetUrl}
              </p>
            </div>

            <button
              type="button"
              onClick={handleImmediateRedirect}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-[#FFE600] px-4 py-3 text-xs font-black uppercase tracking-wider text-slate-950 transition hover:bg-yellow-400 active:scale-[0.99] shadow-lg"
            >
              <span>Acessar Agora</span>
              <ArrowRight className="h-4 w-4" />
            </button>
            <p className="mt-2 text-[11px] text-slate-500">
              Se a página não abrir em instantes, clique no botão acima.
            </p>
          </div>
        ) : null}
      </div>

      <div className="mt-6 text-center text-[11px] text-slate-500">
        QR Code Dinâmico ecooy &bull; Destino atualizável a qualquer momento
      </div>
    </div>
  );
};
