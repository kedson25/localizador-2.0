import React from 'react';
import { ArrowLeft, ArrowRight, Boxes } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export const OperationNavigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const handleBack = () => {
    const historyIndex = Number(window.history.state?.idx ?? 0);
    if (historyIndex > 0) {
      navigate(-1);
      return;
    }

    if (location.pathname.startsWith('/listas/')) {
      navigate('/listas');
      return;
    }

    navigate('/');
  };

  const handleForward = () => {
    navigate(1);
  };

  return (
    <div className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 shadow-sm backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-3 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={handleBack}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
          title="Voltar"
          aria-label="Voltar"
        >
          <ArrowLeft className="h-4 w-4 text-[#3483FA]" />
          <span className="hidden sm:inline">Voltar</span>
        </button>

        <button
          type="button"
          onClick={() => navigate('/')}
          className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#FFE600] px-3 text-xs font-black text-[#253b80] transition hover:brightness-95 active:scale-[0.98]"
          title="Ir para Módulos"
        >
          <Boxes className="h-4 w-4" />
          <span>Módulos</span>
        </button>

        <button
          type="button"
          onClick={handleForward}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:bg-slate-50 active:scale-[0.98]"
          title="Avançar"
          aria-label="Avançar"
        >
          <span className="hidden sm:inline">Avançar</span>
          <ArrowRight className="h-4 w-4 text-[#3483FA]" />
        </button>

        <div className="ml-auto hidden min-w-0 items-center text-xs font-bold text-slate-400 md:flex">
          <span className="max-w-[360px] truncate">{location.pathname}</span>
        </div>
      </div>
    </div>
  );
};
