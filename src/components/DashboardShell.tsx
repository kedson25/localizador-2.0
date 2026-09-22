import React, { useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Bell,
  Boxes,
  ChevronDown,
  CircleHelp,
  Home,
  PackageOpen,
  Search,
  Settings,
  UserCircle2,
  Zap,
} from 'lucide-react';
import type { User } from '../lib/auth';

interface DashboardShellProps {
  currentUser?: User | null;
  title?: string;
  subtitle?: string;
  children: React.ReactNode;
}

type QuickLink = {
  label: string;
  path: string;
  keywords: string;
  adminOnly?: boolean;
};

const QUICK_LINKS: QuickLink[] = [
  { label: 'Módulos', path: '/', keywords: 'modulos inicio ferramentas' },
  { label: 'Listas de Coleta', path: '/listas', keywords: 'lista coleta backlog' },
  { label: 'Buscar IDs', path: '/consulta', keywords: 'buscar ids consulta rota pacote' },
  { label: 'Remover IDs', path: '/remover', keywords: 'remover ids baixa filtro' },
  { label: 'Reporte WhatsApp', path: '/reporte', keywords: 'reporte whatsapp relatorio' },
  { label: 'Análise de Brancas', path: '/brancas', keywords: 'brancas auditoria rota' },
  { label: 'Configurações', path: '/configuracoes', keywords: 'configuracoes preferencias' },
  { label: 'Relatórios', path: '/admin', keywords: 'relatorios admin metricas', adminOnly: true },
];

export const DashboardShell: React.FC<DashboardShellProps> = ({
  currentUser,
  title,
  subtitle,
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);

  const isAdminArea = location.pathname.startsWith('/admin');
  const isSettings = location.pathname.startsWith('/configuracoes');
  const isModulesArea = !isAdminArea && !isSettings;

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return QUICK_LINKS.filter(item => {
      if (item.adminOnly && !currentUser?.isAdmin) return false;
      return `${item.label} ${item.keywords}`.toLowerCase().includes(term);
    }).slice(0, 6);
  }, [search, currentUser?.isAdmin]);

  const logout = async () => {
    const auth = await import('../lib/auth');
    auth.logoutUser();
    window.location.href = '/login';
  };

  const navClass = (active: boolean) =>
    `relative flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm transition ${
      active
        ? 'bg-[#fff5bd] font-extrabold text-slate-900'
        : 'font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900'
    }`;

  const openResult = (path: string) => {
    setSearch('');
    setSearchFocused(false);
    navigate(path);
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col border-r border-slate-200 bg-white lg:flex">
        <button
          type="button"
          onClick={() => navigate('/')}
          className="flex h-[72px] items-center gap-3 bg-[#FFE600] px-7 text-left"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#253b80] text-white shadow-sm">
            <Zap className="h-5 w-5" />
          </span>
          <span className="text-[22px] font-black tracking-[-0.04em] text-[#253b80]">ecooy</span>
        </button>

        <nav className="flex-1 px-4 py-7">
          <div className="space-y-2">
            <button type="button" onClick={() => navigate('/')} className={navClass(location.pathname === '/')}>
              {location.pathname === '/' && <span className="absolute -left-4 h-9 w-1 rounded-r bg-[#FFE600]" />}
              <Home className="h-5 w-5" />
              Início
            </button>

            <button type="button" onClick={() => navigate('/')} className={navClass(isModulesArea)}>
              {isModulesArea && <span className="absolute -left-4 h-9 w-1 rounded-r bg-[#FFE600]" />}
              <Boxes className="h-5 w-5" />
              Módulos
            </button>

            {currentUser?.isAdmin && (
              <button type="button" onClick={() => navigate('/admin')} className={navClass(isAdminArea)}>
                {isAdminArea && <span className="absolute -left-4 h-9 w-1 rounded-r bg-[#FFE600]" />}
                <BarChart3 className="h-5 w-5" />
                Relatórios
              </button>
            )}

            <button type="button" onClick={() => navigate('/configuracoes')} className={navClass(isSettings)}>
              {isSettings && <span className="absolute -left-4 h-9 w-1 rounded-r bg-[#FFE600]" />}
              <Settings className="h-5 w-5" />
              Configurações
            </button>

            <button
              type="button"
              onClick={() => window.alert('Ajuda: escolha um módulo ou utilize a busca no topo.')}
              className={navClass(false)}
            >
              <CircleHelp className="h-5 w-5" />
              Ajuda
            </button>
          </div>
        </nav>

        <div className="mx-6 mb-7 border-t border-slate-200 pt-6">
          <div className="flex gap-3 text-slate-500">
            <PackageOpen className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="text-xs font-medium leading-4">
              Operação simples,<br />
              rápida e precisa.
              <div className="mt-3 h-0.5 w-10 bg-[#FFE600]" />
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:pl-[238px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur sm:px-6 lg:px-8">
          <div className="relative max-w-[650px] flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar módulos, ferramentas ou ajuda..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 pl-12 pr-4 text-sm text-slate-800 outline-none transition focus:border-[#3483FA] focus:bg-white focus:ring-2 focus:ring-blue-100"
            />

            {searchFocused && search.trim() && (
              <div className="absolute left-0 right-0 top-[50px] z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                {results.length > 0 ? results.map(item => (
                  <button
                    key={item.path}
                    type="button"
                    onMouseDown={() => openResult(item.path)}
                    className="flex w-full items-center justify-between border-b border-slate-100 px-4 py-3 text-left text-sm font-semibold text-slate-700 last:border-b-0 hover:bg-slate-50"
                  >
                    <span>{item.label}</span>
                    <span className="text-xs text-[#1769ff]">Abrir</span>
                  </button>
                )) : (
                  <div className="px-4 py-3 text-sm text-slate-500">Nenhuma ferramenta encontrada.</div>
                )}
              </div>
            )}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-4">
            <button type="button" className="relative hidden h-10 w-10 items-center justify-center rounded-full text-slate-700 hover:bg-slate-100 sm:flex">
              <Bell className="h-5 w-5" />
              <span className="absolute right-2 top-1.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-red-500" />
            </button>
            <div className="hidden items-center gap-3 rounded-lg bg-slate-100 px-3 py-2 sm:flex">
              <UserCircle2 className="h-7 w-7 text-slate-600" />
              <span className="max-w-[150px] truncate text-sm font-bold text-slate-800">
                {currentUser?.username || 'Usuário'}
              </span>
              <ChevronDown className="h-4 w-4 text-slate-500" />
            </div>
            <button type="button" onClick={logout} className="px-2 py-2 text-xs font-black uppercase text-red-600 hover:text-red-700">
              Sair
            </button>
          </div>
        </header>

        <main className="mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7">
          {(title || subtitle) && (
            <div className="mb-5">
              {title && <h1 className="text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">{title}</h1>}
              {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
};
