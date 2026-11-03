import React, { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, PauseCircle, Server, RefreshCw } from 'lucide-react';
import { getDynamicQrByCode, recordQrScan, getLocalCache, DynamicQr } from '../lib/dynamicQr';

export const DynamicQrRedirect: React.FC = () => {
  const { code: routeCode } = useParams<{ code?: string }>();
  const [searchParams] = useSearchParams();
  const queryCode = searchParams.get('qr') || searchParams.get('r') || searchParams.get('code');
  const code = (routeCode || queryCode || '').trim();

  const [loading, setLoading] = useState(true);
  const [qrData, setQrData] = useState<DynamicQr | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!code) {
      setError('Código do QR Code não informado.');
      setLoading(false);
      return;
    }

    const cleanCode = code.toLowerCase();

    // 1. Tenta redirecionamento imediato síncrono via cache local (0ms de espera!)
    const local = getLocalCache();
    const immediate = local.find(
      i => i.code.toLowerCase() === cleanCode || i.id === cleanCode || i.id === `qr-${cleanCode}`
    );
    if (immediate && immediate.status !== 'paused' && immediate.targetUrl) {
      recordQrScan(immediate.id);
      window.location.replace(immediate.targetUrl);
      return;
    }

    let isCancelled = false;

    // 2. Consulta no servidor/Firestore e redireciona IMEDIATAMENTE (sem countdown, sem espera)
    async function resolveRedirect() {
      try {
        const item = await getDynamicQrByCode(cleanCode);
        if (isCancelled) return;

        if (!item) {
          setError(`QR Code "${code}" não foi encontrado ou foi removido.`);
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

        // Registra o scan e redireciona IMEDIATAMENTE!
        recordQrScan(item.id);
        window.location.replace(item.targetUrl);
      } catch (err: any) {
        if (isCancelled) return;
        console.error('Erro no servidor de redirecionamento:', err);
        setError('Ocorreu um erro ao carregar o destino deste QR Code.');
        setLoading(false);
      }
    }

    resolveRedirect();

    return () => {
      isCancelled = true;
    };
  }, [code]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-slate-950 px-4 text-slate-100">
      {/* Brand Header */}
      <div className="mb-6 flex items-center gap-2.5">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFE600] text-slate-950 font-black shadow-lg">
          <Server className="h-5 w-5" />
        </div>
        <div className="text-2xl font-black tracking-tight text-white">ecooy &bull; server</div>
      </div>

      <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-900/95 p-6 shadow-2xl backdrop-blur sm:p-8">
        {loading ? (
          <div className="flex flex-col items-center py-6 text-center">
            <div className="relative mb-4 flex h-12 w-12 items-center justify-center">
              <RefreshCw className="h-6 w-6 text-[#FFE600] animate-spin" />
            </div>
            <h2 className="text-base font-bold text-white">Conectando ao destino...</h2>
            <p className="mt-1 text-xs text-slate-400">Redirecionamento automático e instantâneo</p>
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
              {qrData?.status === 'paused' ? 'QR Code Temporariamente Pausado' : 'Não foi possível conectar'}
            </h2>
            <p className="mt-2 text-xs text-slate-300 leading-relaxed">{error}</p>
            {qrData?.title && (
              <div className="mt-4 rounded-lg bg-slate-950 p-3 text-left w-full border border-slate-800">
                <div className="text-[10px] uppercase font-bold text-slate-500">QR Code</div>
                <div className="text-xs font-semibold text-white truncate">{qrData.title}</div>
              </div>
            )}
            <a
              href="/"
              className="mt-6 inline-flex items-center gap-2 rounded-xl bg-slate-800 px-4 py-2.5 text-xs font-bold text-white transition hover:bg-slate-700 border border-slate-700 cursor-pointer"
            >
              Ir para o Sistema
            </a>
          </div>
        ) : null}
      </div>
    </div>
  );
};
