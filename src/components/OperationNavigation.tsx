import React from 'react';
import { ArrowLeft, Boxes } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export const OperationNavigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isListaDetail = location.pathname.startsWith('/listas/');

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
          title="Módulos"
          aria-label="Ir para Módulos"
        >
          <Boxes className="h-4 w-4 text-[#3483FA]" />
          <span>Módulos</span>
        </button>

        {isListaDetail && (
          <button
            type="button"
            onClick={() => navigate('/listas')}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
            title="Voltar para Listas"
          >
            <ArrowLeft className="h-4 w-4 text-slate-500" />
            <span className="hidden sm:inline">Listas</span>
          </button>
        )}

        <div className="ml-auto hidden min-w-0 items-center text-xs font-bold text-slate-400 md:flex">
          <span className="max-w-[360px] truncate">{location.pathname}</span>
        </div>
      </div>
    </div>
  );
};
