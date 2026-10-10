import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Boxes,
  ChevronDown,
  CircleHelp,
  LogOut,
  PackageOpen,
  Search,
  Settings,
  UserCheck,
  UserCircle2,
  X,
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
  { label: 'Módulos', path: '/', keywords: 'modulos ferramentas' },
  { label: 'Listas de Coleta', path: '/listas', keywords: 'lista coleta backlog' },
  { label: 'Buscar IDs', path: '/consulta', keywords: 'buscar ids consulta rota pacote' },
  { label: 'Controle Refugo', path: '/refugo', keywords: 'refugo conferir csv pacotes' },
  { label: 'Baixas', path: '/baixas', keywords: 'baixas entregue em rota' },
  { label: 'Correlação de IDs', path: '/correlacao', keywords: 'correlacao conciliar ids fos returns devolucao' },
  { label: 'Remover IDs', path: '/remover', keywords: 'remover ids baixa filtro' },
  { label: 'Reporte WhatsApp', path: '/reporte', keywords: 'reporte whatsapp relatorio' },
  { label: 'Análise de Brancas', path: '/brancas', keywords: 'brancas auditoria rota' },
  { label: 'Controle de Docas', path: '/expedicao', keywords: 'expedicao doca amais faltante despacho auditoria' },
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
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;

    const handlePointerDown = (event: MouseEvent | TouchEvent) => {
      if (userMenuRef.current && !userMenuRef.current.contains(event.target as Node)) {
        setUserMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setUserMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('touchstart', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('touchstart', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [userMenuOpen]);

  const isAdminArea = location.pathname.startsWith('/admin');
  const isSettings = location.pathname.startsWith('/configuracoes');
  const isModulesArea = location.pathname === '/';
  const isExpedicao = location.pathname.startsWith('/expedicao');

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return QUICK_LINKS.filter(item => {
      if (item.adminOnly && !currentUser?.isAdmin) return false;
      const group = item.path.split('/')[1];
      if (group && !['admin', 'configuracoes'].includes(group) && !currentUser?.isAdmin && !currentUser?.allowedGroups?.includes(group)) return false;
      return `${item.label} ${item.keywords}`.toLowerCase().includes(term);
    }).slice(0, 6);
  }, [search, currentUser?.isAdmin, currentUser?.allowedGroups]);

  const logout = async () => {
    const auth = await import('../lib/auth');
    auth.logoutUser();
    window.location.href = '/login';
  };

  const navClass = (active: boolean) =>
    `ecooy-nav-link relative flex w-full items-center justify-center px-3 py-3 text-sm transition ${
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
    <div className="ecooy-shell min-h-screen">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[82px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="relative flex h-[72px] items-center justify-center bg-[#FFE600] px-3">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#253b80] text-white shadow-sm transition hover:opacity-90 cursor-pointer"
            title="Ecooy - Módulos"
            aria-label="Ecooy - Módulos"
          >
            <Zap className="h-5 w-5" />
          </button>
        </div>

        <nav className="flex-1 px-3 py-7 space-y-2">
          <button
            type="button"
            onClick={() => navigate('/')}
            className={navClass(isModulesArea)}
            title="Módulos"
            aria-label="Módulos"
          >
            {isModulesArea && <span className="absolute -left-3 h-9 w-1 rounded-r bg-[#FFE600]" />}
            <Boxes className="h-5 w-5 shrink-0" />
          </button>

          {currentUser?.isAdmin && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className={navClass(isAdminArea)}
              title="Relatórios"
              aria-label="Relatórios"
            >
              {isAdminArea && <span className="absolute -left-3 h-9 w-1 rounded-r bg-[#FFE600]" />}
              <BarChart3 className="h-5 w-5 shrink-0" />
            </button>
          )}

          <button
            type="button"
            onClick={() => navigate('/configuracoes')}
            className={navClass(isSettings)}
            title="Configurações"
            aria-label="Configurações"
          >
            {isSettings && <span className="absolute -left-3 h-9 w-1 rounded-r bg-[#FFE600]" />}
            <Settings className="h-5 w-5 shrink-0" />
          </button>

          <button
            type="button"
            onClick={() => window.alert('Ajuda: escolha um módulo ou utilize a busca no topo.')}
            className={navClass(false)}
            title="Ajuda"
            aria-label="Ajuda"
          >
            <CircleHelp className="h-5 w-5 shrink-0" />
          </button>
        </nav>

        <div className="mx-3 mb-7 border-t border-slate-200 pt-6">
          <div className="flex justify-center text-slate-400" title="Operação simples, rápida e precisa">
            <PackageOpen className="h-6 w-6" />
          </div>
        </div>
      </aside>

      <div className="w-full flex-1 transition-[padding] duration-200 lg:pl-[82px]">
        <header className="sticky top-0 z-20 flex h-[72px] items-center gap-3 border-b border-slate-200 bg-white/95 px-4 shadow-sm backdrop-blur sm:px-6 lg:px-8">
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              type="button"
              onClick={() => navigate('/')}
              className="ecooy-action px-3 text-sm text-slate-700"
              aria-label="Ir para Módulos"
              title="Módulos"
            >
              <Boxes className="h-4 w-4 text-[#1769ff]" />
              <span className="hidden sm:inline">Módulos</span>
            </button>
          </div>

          <div className="relative max-w-[650px] flex-1">
            <Search className="absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              type="search"
              value={search}
              onFocus={() => setSearchFocused(true)}
              onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar módulos, ferramentas ou ajuda..."
              className="ecooy-control h-11 w-full pl-12 pr-4 text-sm focus:border-blue-500"
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

          <div ref={userMenuRef} className="relative ml-auto flex items-center gap-2">
            <button
              type="button"
              onClick={() => setUserMenuOpen(prev => !prev)}
              className="flex items-center gap-2.5 border border-slate-200 bg-slate-50 px-3 py-2 text-left font-bold text-slate-800 transition hover:border-slate-300 hover:bg-slate-100 focus:outline-none"
              aria-label="Menu do usuário e configurações"
              aria-expanded={userMenuOpen}
            >
              <UserCircle2 className="h-6 w-6 text-slate-600 sm:h-7 sm:w-7" />
              <div className="flex flex-col text-left leading-none">
                <span className="max-w-[120px] truncate text-xs font-bold text-slate-900 sm:max-w-[160px] sm:text-sm">
                  {currentUser?.username || 'Usuário'}
                </span>
                <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {currentUser?.isAdmin ? 'Administrador' : 'Operador'}
                </span>
              </div>
              <ChevronDown className={`h-4 w-4 text-slate-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Popup / Menu suspenso direto no perfil */}
            {userMenuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40 bg-black/10 backdrop-blur-[1px]"
                  onClick={() => setUserMenuOpen(false)}
                  aria-hidden="true"
                />
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1.5 w-72 origin-top-right border border-slate-300 bg-white shadow-xl animate-in fade-in zoom-in-95 duration-100 sm:w-80"
                >
                  {/* Cabeçalho com dados da conta */}
                  <div className="border-b border-slate-200 bg-slate-50 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center bg-slate-900 text-amber-300">
                        <UserCircle2 className="h-7 w-7" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-black text-slate-900">{currentUser?.username || 'Usuário'}</p>
                        <p className="mt-0.5 inline-block border border-slate-200 bg-white px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-600">
                          {currentUser?.isAdmin ? 'Administrador' : 'Operador'}
                        </p>
                        {currentUser?.email && (
                          <p className="mt-1 truncate text-xs text-slate-500">{currentUser.email}</p>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Ações e Navegação */}
                  <div className="p-2 space-y-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/configuracoes');
                      }}
                      className="flex w-full items-center gap-3 border border-transparent px-3 py-2.5 text-left text-xs sm:text-sm font-bold text-slate-700 transition hover:border-slate-200 hover:bg-slate-50"
                    >
                      <Settings className="h-4 w-4 text-slate-500" />
                      <div className="flex-1">
                        <div>Configurações</div>
                        <div className="text-[11px] font-normal text-slate-400">Preferências do sistema</div>
                      </div>
                    </button>

                    {currentUser?.isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/admin');
                        }}
                        className="flex w-full items-center gap-3 border border-transparent px-3 py-2.5 text-left text-xs sm:text-sm font-bold text-slate-700 transition hover:border-slate-200 hover:bg-slate-50"
                      >
                        <BarChart3 className="h-4 w-4 text-slate-500" />
                        <div className="flex-1">
                          <div>Painel Administrativo</div>
                          <div className="text-[11px] font-normal text-slate-400">Auditoria e controle</div>
                        </div>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/');
                      }}
                      className="flex w-full items-center gap-3 border border-transparent px-3 py-2.5 text-left text-xs sm:text-sm font-bold text-slate-700 transition hover:border-slate-200 hover:bg-slate-50"
                    >
                      <Boxes className="h-4 w-4 text-[#1769ff]" />
                      <div className="flex-1">
                        <div>Todos os Módulos</div>
                        <div className="text-[11px] font-normal text-slate-400">Central de ferramentas</div>
                      </div>
                    </button>
                  </div>

                  {/* Sair do Sistema */}
                  <div className="border-t border-slate-200 bg-slate-50 p-2">
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center justify-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs sm:text-sm font-bold text-red-700 transition hover:bg-red-100 hover:text-red-800"
                    >
                      <LogOut className="h-4 w-4" />
                      <span>Sair do Sistema</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </header>

        <main className={isExpedicao
          ? 'w-full max-w-none px-3 py-4 sm:px-4 lg:px-5 xl:px-6'
          : 'mx-auto w-full max-w-[1280px] px-4 py-5 sm:px-6 lg:px-8 lg:py-7'}>
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
