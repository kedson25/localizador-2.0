import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  Barcode,
  BookOpen,
  Boxes,
  ChevronDown,
  ChevronRight,
  Code2,
  FileSearch,
  GitCompareArrows,
  ListTodo,
  LogOut,
  Menu,
  MessageSquare,
  PackageOpen,
  Search,
  Settings,
  Trash2,
  Truck,
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

type NavItem = {
  id: string;
  label: string;
  shortLabel?: string;
  path: string;
  keywords: string;
  icon: React.ElementType;
  section: 'operacao' | 'analise' | 'sistema';
  adminOnly?: boolean;
  publicModule?: boolean;
};

export const NAV_ITEMS: NavItem[] = [
  {
    id: 'hub',
    label: 'Módulos',
    shortLabel: 'Módulos',
    path: '/',
    keywords: 'modulos inicio hub ferramentas',
    icon: Boxes,
    section: 'operacao',
    publicModule: true,
  },
  {
    id: 'listas',
    label: 'Listas de Coleta',
    shortLabel: 'Listas',
    path: '/listas',
    keywords: 'lista coleta bipagem pacotes',
    icon: ListTodo,
    section: 'operacao',
  },
  {
    id: 'consulta',
    label: 'Buscar IDs',
    shortLabel: 'Buscador',
    path: '/consulta',
    keywords: 'buscar ids consulta pacote movimento',
    icon: Search,
    section: 'operacao',
  },
  {
    id: 'refugo',
    label: 'Controle Refugo',
    shortLabel: 'Refugo',
    path: '/refugo',
    keywords: 'refugo conferencia mapa faltantes',
    icon: Barcode,
    section: 'operacao',
  },
  {
    id: 'expedicao',
    label: 'Controle de Docas',
    shortLabel: 'Docas',
    path: '/expedicao',
    keywords: 'expedicao docas vagas despacho aduana',
    icon: Truck,
    section: 'operacao',
  },
  {
    id: 'brancas',
    label: 'Análise de Brancas',
    shortLabel: 'Brancas',
    path: '/brancas',
    keywords: 'brancas sem rota auditoria',
    icon: FileSearch,
    section: 'analise',
  },
  {
    id: 'correlacao',
    label: 'Correlação de IDs',
    shortLabel: 'Correlação',
    path: '/correlacao',
    keywords: 'correlacao fos conciliar',
    icon: GitCompareArrows,
    section: 'analise',
  },
  {
    id: 'baixas',
    label: 'Baixas',
    shortLabel: 'Baixas',
    path: '/baixas',
    keywords: 'baixas entregue em rota',
    icon: PackageOpen,
    section: 'analise',
  },
  {
    id: 'remover',
    label: 'Remover IDs',
    shortLabel: 'Remover',
    path: '/remover',
    keywords: 'remover ids filtro lote',
    icon: Trash2,
    section: 'analise',
  },
  {
    id: 'reporte',
    label: 'Reporte WhatsApp',
    shortLabel: 'Reporte',
    path: '/reporte',
    keywords: 'reporte whatsapp resumo',
    icon: MessageSquare,
    section: 'analise',
  },
  {
    id: 'guia',
    label: 'Guia & Aulas',
    shortLabel: 'Guia',
    path: '/guia',
    keywords: 'guia aulas videos treinamento buscador publico',
    icon: BookOpen,
    section: 'sistema',
    publicModule: true,
  },
  {
    id: 'codes',
    label: 'Codes',
    shortLabel: 'Codes',
    path: '/codes',
    keywords: 'codes codigos html',
    icon: Code2,
    section: 'sistema',
    publicModule: true,
  },
  {
    id: 'admin',
    label: 'Relatórios',
    shortLabel: 'Relatórios',
    path: '/admin',
    keywords: 'relatorios admin metricas usuarios',
    icon: BarChart3,
    section: 'sistema',
    adminOnly: true,
  },
  {
    id: 'configuracoes',
    label: 'Configurações',
    shortLabel: 'Ajustes',
    path: '/configuracoes',
    keywords: 'configuracoes ajustes conta',
    icon: Settings,
    section: 'sistema',
    publicModule: true,
  },
];

export function canAccessNavItem(item: NavItem, user?: User | null): boolean {
  if (item.adminOnly) return Boolean(user?.isAdmin);
  if (item.publicModule) return true;
  if (user?.isAdmin) return true;
  return Boolean(user?.allowedGroups?.includes(item.id));
}

export function isNavItemActive(pathname: string, itemPath: string): boolean {
  if (itemPath === '/') return pathname === '/';
  if (itemPath === '/refugo') {
    return pathname.startsWith('/refugo') || pathname.startsWith('/mapa-refugo');
  }
  if (itemPath === '/codes') {
    return pathname.startsWith('/codes') || pathname.startsWith('/qrs');
  }
  return pathname === itemPath || pathname.startsWith(`${itemPath}/`);
}

export const DashboardShell: React.FC<DashboardShellProps> = ({
  currentUser,
  title,
  children,
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [search, setSearch] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMobileMenuOpen(false);
  }, [location.pathname]);

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

  const allowedItems = useMemo(
    () => NAV_ITEMS.filter(item => canAccessNavItem(item, currentUser)),
    [currentUser]
  );

  const operacaoItems = useMemo(
    () => allowedItems.filter(item => item.section === 'operacao'),
    [allowedItems]
  );
  const analiseItems = useMemo(
    () => allowedItems.filter(item => item.section === 'analise'),
    [allowedItems]
  );
  const sistemaItems = useMemo(
    () => allowedItems.filter(item => item.section === 'sistema'),
    [allowedItems]
  );

  const activeItem = useMemo(
    () => allowedItems.find(item => isNavItemActive(location.pathname, item.path)),
    [allowedItems, location.pathname]
  );

  const isExpedicao = location.pathname.startsWith('/expedicao');

  const results = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return [];
    return allowedItems
      .filter(item => `${item.label} ${item.keywords}`.toLowerCase().includes(term))
      .slice(0, 6);
  }, [search, allowedItems]);

  const logout = async () => {
    const auth = await import('../lib/auth');
    auth.logoutUser();
    window.location.href = '/login';
  };

  const openResult = (path: string) => {
    setSearch('');
    setSearchFocused(false);
    navigate(path);
  };

  const renderNavSection = (sectionTitle: string, items: NavItem[]) => {
    if (items.length === 0) return null;
    return (
      <div className="space-y-0.5">
        <div className="px-3 pb-1 pt-2 text-[10px] font-black uppercase tracking-widest text-slate-400">
          {sectionTitle}
        </div>
        {items.map(item => {
          const Icon = item.icon;
          const active = isNavItemActive(location.pathname, item.path);
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => navigate(item.path)}
              className={`group relative flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs transition cursor-pointer ${
                active
                  ? 'bg-[#fff5bd] font-black text-slate-950'
                  : 'font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              {active && <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#253b80]" />}
              <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-[#253b80]' : 'text-slate-400 group-hover:text-slate-700'}`} />
              <span className="truncate">{item.label}</span>
            </button>
          );
        })}
      </div>
    );
  };

  return (
    <div className="ecooy-shell min-h-screen flex flex-col">
      {/* Sidebar Desktop */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[216px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-[#FFE600] px-4">
          <button
            type="button"
            onClick={() => navigate('/')}
            className="flex items-center gap-2.5 text-left cursor-pointer"
          >
            <span className="flex h-8 w-8 items-center justify-center bg-[#253b80] text-white shadow-2xs">
              <Zap className="h-4 w-4" />
            </span>
            <span className="text-lg font-black tracking-tight text-[#253b80] uppercase">
              Ecooy
            </span>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
          {renderNavSection('Operação', operacaoItems)}
          {renderNavSection('Conciliação', analiseItems)}
          {renderNavSection('Sistema', sistemaItems)}
        </nav>

        <div className="border-t border-slate-200 bg-slate-50 p-2.5">
          <button
            type="button"
            onClick={logout}
            className="flex w-full items-center gap-2 px-3 py-2 text-xs font-bold text-slate-600 transition hover:bg-red-50 hover:text-red-700 cursor-pointer"
          >
            <LogOut className="h-3.5 w-3.5" />
            <span>Sair da Conta</span>
          </button>
        </div>
      </aside>

      {/* Drawer Mobile */}
      {mobileMenuOpen && (
        <div className="fixed inset-0 z-50 flex lg:hidden">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setMobileMenuOpen(false)}
          />
          <aside className="relative z-10 flex w-[250px] max-w-[82vw] flex-col bg-white shadow-2xl">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-[#FFE600] px-4">
              <div className="flex items-center gap-2">
                <span className="flex h-8 w-8 items-center justify-center bg-[#253b80] text-white">
                  <Zap className="h-4 w-4" />
                </span>
                <span className="text-base font-black uppercase tracking-tight text-[#253b80]">
                  Ecooy
                </span>
              </div>
              <button
                type="button"
                onClick={() => setMobileMenuOpen(false)}
                className="p-1.5 text-slate-800 hover:bg-black/10"
                aria-label="Fechar menu"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-3">
              {renderNavSection('Operação', operacaoItems)}
              {renderNavSection('Conciliação', analiseItems)}
              {renderNavSection('Sistema', sistemaItems)}
            </nav>

            <div className="border-t border-slate-200 bg-slate-50 p-3">
              <button
                type="button"
                onClick={logout}
                className="flex w-full items-center justify-center gap-2 border border-red-200 bg-red-50 px-3 py-2 text-xs font-bold text-red-700"
              >
                <LogOut className="h-4 w-4" />
                <span>Sair</span>
              </button>
            </div>
          </aside>
        </div>
      )}

      {/* Área Principal */}
      <div className="w-full flex-1 flex flex-col lg:pl-[216px]">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          <div className="flex h-14 items-center justify-between gap-2 px-3 sm:px-5 lg:px-6">
            {/* Esquerda: Botão Mobile + Breadcrumb limpo */}
            <div className="flex min-w-0 items-center gap-2">
              <button
                type="button"
                onClick={() => setMobileMenuOpen(true)}
                className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 lg:hidden cursor-pointer"
                aria-label="Abrir navegação"
              >
                <Menu className="h-4 w-4" />
              </button>

              <div className="flex min-w-0 items-center gap-1.5 text-xs sm:text-sm">
                <button
                  type="button"
                  onClick={() => navigate('/')}
                  className="font-bold text-slate-500 hover:text-slate-900 transition cursor-pointer shrink-0"
                >
                  Módulos
                </button>
                {activeItem && activeItem.path !== '/' && (
                  <>
                    <ChevronRight className="h-3.5 w-3.5 text-slate-400 shrink-0" />
                    <span className="truncate font-black text-slate-900">
                      {title || activeItem.label}
                    </span>
                  </>
                )}
              </div>
            </div>

            {/* Centro: Busca rápida de módulos */}
            <div className="relative hidden max-w-xs flex-1 sm:block md:max-w-md">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onFocus={() => setSearchFocused(true)}
                onBlur={() => window.setTimeout(() => setSearchFocused(false), 140)}
                onChange={event => setSearch(event.target.value)}
                placeholder="Ir para módulo..."
                className="h-9 w-full border border-slate-200 bg-slate-50 pl-9 pr-3 text-xs text-slate-800 outline-none transition focus:border-[#1769ff] focus:bg-white"
              />

              {searchFocused && search.trim() && (
                <div className="absolute left-0 right-0 top-[40px] z-50 border border-slate-200 bg-white shadow-xl">
                  {results.length > 0 ? results.map(item => {
                    const Icon = item.icon;
                    return (
                      <button
                        key={item.path}
                        type="button"
                        onMouseDown={() => openResult(item.path)}
                        className="flex w-full items-center justify-between border-b border-slate-100 px-3.5 py-2.5 text-left text-xs font-bold text-slate-700 last:border-b-0 hover:bg-slate-50 cursor-pointer"
                      >
                        <span className="flex items-center gap-2">
                          <Icon className="h-3.5 w-3.5 text-[#1769ff]" />
                          {item.label}
                        </span>
                        <span className="text-[11px] text-[#1769ff]">Abrir</span>
                      </button>
                    );
                  }) : (
                    <div className="px-3.5 py-2.5 text-xs text-slate-500">Nenhum módulo encontrado.</div>
                  )}
                </div>
              )}
            </div>

            {/* Direita: Perfil compacto */}
            <div ref={userMenuRef} className="relative flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setUserMenuOpen(prev => !prev)}
                className="flex h-9 items-center gap-2 border border-slate-200 bg-slate-50 px-2.5 text-left text-slate-800 transition hover:border-slate-300 hover:bg-slate-100 cursor-pointer"
                aria-label="Conta do usuário"
                aria-expanded={userMenuOpen}
              >
                <UserCircle2 className="h-4 w-4 text-slate-600 shrink-0" />
                <span className="max-w-[110px] truncate text-xs font-bold text-slate-900 sm:max-w-[150px]">
                  {currentUser?.username || 'Usuário'}
                </span>
                <span className="hidden border border-slate-200 bg-white px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider text-slate-600 md:inline-block">
                  {currentUser?.isAdmin ? 'Admin' : 'Operador'}
                </span>
                <ChevronDown className={`h-3.5 w-3.5 text-slate-500 transition-transform ${userMenuOpen ? 'rotate-180' : ''}`} />
              </button>

              {userMenuOpen && (
                <div
                  role="menu"
                  className="absolute right-0 top-full z-50 mt-1 w-56 border border-slate-200 bg-white shadow-xl"
                >
                  <div className="border-b border-slate-100 bg-slate-50 px-3.5 py-2.5">
                    <p className="truncate text-xs font-black text-slate-900">{currentUser?.username || 'Usuário'}</p>
                    <p className="text-[10px] font-bold uppercase text-slate-500">
                      {currentUser?.isAdmin ? 'Administrador' : 'Operador'}
                    </p>
                  </div>

                  <div className="p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Boxes className="h-3.5 w-3.5 text-[#1769ff]" />
                      <span>Módulos</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        navigate('/configuracoes');
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                    >
                      <Settings className="h-3.5 w-3.5 text-slate-500" />
                      <span>Configurações</span>
                    </button>

                    {currentUser?.isAdmin && (
                      <button
                        type="button"
                        onClick={() => {
                          setUserMenuOpen(false);
                          navigate('/admin');
                        }}
                        className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                      >
                        <BarChart3 className="h-3.5 w-3.5 text-slate-500" />
                        <span>Relatórios</span>
                      </button>
                    )}
                  </div>

                  <div className="border-t border-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setUserMenuOpen(false);
                        logout();
                      }}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      <span>Sair</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Barra horizontal rápida para Mobile / Coletores */}
          <div className="flex items-center gap-1 overflow-x-auto border-t border-slate-100 bg-slate-50/80 px-3 py-1.5 lg:hidden app-scroll-x">
            {allowedItems.map(item => {
              const Icon = item.icon;
              const active = isNavItemActive(location.pathname, item.path);
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(item.path)}
                  className={`inline-flex shrink-0 items-center gap-1.5 border px-2.5 py-1 text-[11px] font-bold transition cursor-pointer ${
                    active
                      ? 'border-slate-900 bg-[#FFE600] text-slate-950'
                      : 'border-slate-200 bg-white text-slate-600 hover:text-slate-900'
                  }`}
                >
                  <Icon className="h-3 w-3" />
                  <span>{item.shortLabel || item.label}</span>
                </button>
              );
            })}
          </div>
        </header>

        <main className={isExpedicao
          ? 'w-full max-w-none flex-1 px-3 py-3 sm:px-4 lg:px-5'
          : 'mx-auto w-full max-w-[1360px] flex-1 px-3 py-4 sm:px-5 lg:px-6 lg:py-5'}>
          {children}
        </main>
      </div>
    </div>
  );
};
