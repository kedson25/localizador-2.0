import React from 'react';
import { ArrowLeft, Barcode, Boxes, Code2, ListTodo, Search, Truck, Zap } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';

export const OperationNavigation: React.FC = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const isListaDetail = location.pathname.startsWith('/listas/');
  const isRefugo = location.pathname.startsWith('/refugo') || location.pathname.startsWith('/mapa-refugo');

  const quickNav = [
    { label: 'Módulos', path: '/', icon: Boxes, active: location.pathname === '/' },
    { label: 'Listas', path: '/listas', icon: ListTodo, active: location.pathname.startsWith('/listas') },
    { label: 'Buscador', path: '/consulta', icon: Search, active: location.pathname.startsWith('/consulta') },
    { label: 'Refugo', path: '/refugo', icon: Barcode, active: isRefugo },
    { label: 'Docas', path: '/expedicao', icon: Truck, active: location.pathname.startsWith('/expedicao') },
    { label: 'Codes', path: '/codes', icon: Code2, active: location.pathname.startsWith('/codes') },
  ];

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/95 backdrop-blur">
      <div className="mx-auto flex h-13 w-full max-w-7xl items-center justify-between gap-2 px-3 sm:px-6 lg:px-8">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-8 items-center gap-2 bg-[#FFE600] px-2.5 text-xs font-black uppercase text-[#253b80] border border-amber-300 cursor-pointer shrink-0"
            title="Ir para Módulos"
          >
            <Zap className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">Ecooy</span>
          </button>

          {isListaDetail && (
            <button
              type="button"
              onClick={() => navigate('/listas')}
              className="inline-flex h-8 items-center gap-1.5 border border-slate-200 bg-slate-50 px-2.5 text-xs font-bold text-slate-700 transition hover:bg-slate-100 cursor-pointer shrink-0"
              title="Voltar para Listas"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-slate-500" />
              <span>Voltar</span>
            </button>
          )}
        </div>

        <nav className="flex items-center gap-1 overflow-x-auto py-1 app-scroll-x">
          {quickNav.map(item => {
            const Icon = item.icon;
            return (
              <button
                key={item.path}
                type="button"
                onClick={() => navigate(item.path)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 border px-2.5 text-xs font-bold transition cursor-pointer ${
                  item.active
                    ? 'border-slate-900 bg-slate-900 text-white'
                    : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                }`}
              >
                <Icon className="h-3.5 w-3.5" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
