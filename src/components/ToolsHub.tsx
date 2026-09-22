import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Barcode,
  Bell,
  Boxes,
  ChevronDown,
  ChevronRight,
  CircleHelp,
  FileSearch,
  FileSpreadsheet,
  Folder,
  Handshake,
  Home,
  ListTodo,
  MessageSquare,
  PackageOpen,
  Rocket,
  Search,
  Settings,
  Trash2,
  UploadCloud,
  UserCircle2,
} from 'lucide-react';
import type { GroupSummary } from '../types';
import type { User } from '../lib/auth';

interface ToolsHubProps {
  totalRows: number;
  groups: GroupSummary[];
  onClear: () => void;
  currentUser?: User | null;
}

type ToolItem = {
  id: string;
  path: string;
  name: string;
  description: string;
  tag: string;
  icon: React.ElementType;
  iconClass: string;
  iconBoxClass: string;
  badgeClass: string;
};

interface ModuleGroupProps {
  title: string;
  count?: number;
  accent: 'yellow' | 'blue' | 'orange';
  icon: React.ElementType;
  tools: ToolItem[];
  isOpen: boolean;
  onToggle: () => void;
  onOpenTool: (path: string) => void;
  status?: React.ReactNode;
  footer?: React.ReactNode;
}

const accentStyles = {
  yellow: {
    box: 'bg-[#FFE600] text-[#233043]',
    hover: 'hover:bg-[#fffdf0]',
  },
  blue: {
    box: 'bg-[#1769ff] text-white',
    hover: 'hover:bg-blue-50/60',
  },
  orange: {
    box: 'bg-[#ff9800] text-white',
    hover: 'hover:bg-orange-50/60',
  },
};

function ModuleGroup({
  title,
  count,
  accent,
  icon: GroupIcon,
  tools,
  isOpen,
  onToggle,
  onOpenTool,
  status,
  footer,
}: ModuleGroupProps) {
  const palette = accentStyles[accent];

  return (
    <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_8px_28px_rgba(15,23,42,0.06)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-4 border-b border-slate-200 bg-white px-5 py-3.5 text-left transition-colors hover:bg-slate-50/80 sm:px-6"
      >
        <div className="flex min-w-0 items-center gap-3.5">
          {isOpen ? (
            <ChevronDown className="h-5 w-5 shrink-0 text-slate-700" />
          ) : (
            <ChevronRight className="h-5 w-5 shrink-0 text-slate-700" />
          )}
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg shadow-sm ${palette.box}`}>
            <GroupIcon className="h-5 w-5" />
          </span>
          <div className="flex min-w-0 items-center gap-3">
            <h2 className="truncate text-sm font-black uppercase tracking-[0.02em] text-slate-900 sm:text-base">
              {title}
            </h2>
            {typeof count === 'number' && (
              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-600">
                {count}
              </span>
            )}
          </div>
        </div>
        {status}
      </button>

      {isOpen && (
        <div>
          <div className="divide-y divide-slate-200">
            {tools.map(tool => {
              const Icon = tool.icon;
              return (
                <button
                  key={tool.id}
                  type="button"
                  onClick={() => onOpenTool(tool.path)}
                  className={`group flex w-full items-center justify-between gap-4 px-5 py-3.5 text-left transition-colors sm:px-7 ${palette.hover}`}
                >
                  <div className="flex min-w-0 items-center gap-4">
                    <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl ${tool.iconBoxClass}`}>
                      <Icon className={`h-6 w-6 ${tool.iconClass}`} />
                    </span>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2.5">
                        <span className="text-sm font-extrabold text-slate-900 sm:text-[15px]">
                          {tool.name}
                        </span>
                        <span className={`rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wide ${tool.badgeClass}`}>
                          {tool.tag}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-slate-500 sm:text-[13px]">
                        {tool.description}
                      </p>
                    </div>
                  </div>

                  <span className="flex shrink-0 items-center gap-2 text-sm font-bold text-[#1769ff]">
                    <span className="hidden sm:inline">Abrir</span>
                    <ArrowRight className="h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </span>
                </button>
              );
            })}
          </div>
          {footer}
        </div>
      )}
    </section>
  );
}

export const ToolsHub: React.FC<ToolsHubProps> = ({
  totalRows,
  groups: _groups,
  onClear,
  currentUser,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [isBacklogOpen, setIsBacklogOpen] = useState(true);
  const [isRefugoOpen, setIsRefugoOpen] = useState(true);
  const [isBrancasOpen, setIsBrancasOpen] = useState(true);

  const allBacklogTools: ToolItem[] = [
    {
      id: 'listas',
      path: '/listas',
      name: 'Listas de Coleta',
      description: 'Criação e bipagem de listas operacionais.',
      tag: 'Novo',
      icon: ListTodo,
      iconClass: 'text-[#ff9800]',
      iconBoxClass: 'bg-amber-50',
      badgeClass: 'border-amber-300 bg-amber-50 text-amber-700',
    },
    {
      id: 'consulta',
      path: '/consulta',
      name: 'Buscar IDs',
      description: 'Localização de pacotes e rotas na base.',
      tag: 'Consulta',
      icon: Search,
      iconClass: 'text-[#1769ff]',
      iconBoxClass: 'bg-blue-50',
      badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
    },
    {
      id: 'remover',
      path: '/remover',
      name: 'Remover IDs',
      description: 'Filtragem e baixa em lote.',
      tag: 'Ação',
      icon: Trash2,
      iconClass: 'text-red-500',
      iconBoxClass: 'bg-red-50',
      badgeClass: 'border-red-200 bg-red-50 text-red-600',
    },
    {
      id: 'reporte',
      path: '/reporte',
      name: 'Reporte WhatsApp',
      description: 'Resumo formatado para compartilhamento.',
      tag: 'Relatório',
      icon: MessageSquare,
      iconClass: 'text-emerald-500',
      iconBoxClass: 'bg-emerald-50',
      badgeClass: 'border-emerald-300 bg-emerald-50 text-emerald-700',
    },
  ];

  const backlogTools = allBacklogTools.filter(
    tool => currentUser?.isAdmin || currentUser?.allowedGroups?.includes(tool.id)
  );

  const canUpload = currentUser?.isAdmin || currentUser?.allowedGroups?.includes('upload');

  const refugoTools: ToolItem[] = [
    {
      id: 'refugo',
      path: '/refugo',
      name: 'Controle Refugo',
      description: 'Auditoria e conferência de faltantes.',
      tag: 'Auditoria',
      icon: Barcode,
      iconClass: 'text-[#1769ff]',
      iconBoxClass: 'bg-blue-50',
      badgeClass: 'border-blue-200 bg-blue-50 text-blue-700',
    },
  ];

  const brancasTools: ToolItem[] = [
    {
      id: 'brancas',
      path: '/brancas',
      name: 'Análise de Brancas',
      description: 'Descubra por que pacotes não receberam rota e acompanhe a recuperação.',
      tag: 'Auditoria',
      icon: FileSearch,
      iconClass: 'text-[#ff9800]',
      iconBoxClass: 'bg-orange-50',
      badgeClass: 'border-orange-300 bg-orange-50 text-orange-700',
    },
  ];

  const matchesQuery = (tool: ToolItem) => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return true;
    return `${tool.name} ${tool.description} ${tool.tag}`.toLowerCase().includes(normalized);
  };

  const filteredBacklog = useMemo(() => backlogTools.filter(matchesQuery), [backlogTools, query]);
  const filteredRefugo = useMemo(() => refugoTools.filter(matchesQuery), [query]);
  const filteredBrancas = useMemo(() => brancasTools.filter(matchesQuery), [query]);

  const logout = async () => {
    const auth = await import('../lib/auth');
    auth.logoutUser();
    window.location.href = '/login';
  };

  const reportsPath = currentUser?.isAdmin
    ? '/admin'
    : currentUser?.allowedGroups?.includes('reporte')
      ? '/reporte'
      : '/';

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[72px] items-center gap-3 bg-[#FFE600] px-7">
          <span className="flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#253b80] bg-white/70 text-[#253b80]">
            <Handshake className="h-6 w-6" />
          </span>
          <div className="leading-[0.95] text-[#253b80]">
            <div className="text-lg font-black">mercado</div>
            <div className="text-lg font-black">livre</div>
          </div>
        </div>

        <nav className="flex-1 px-4 py-7">
          <div className="space-y-2">
            <button type="button" onClick={() => navigate('/')} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
              <Home className="h-5 w-5" />
              Início
            </button>
            <button type="button" className="relative flex w-full items-center gap-4 rounded-xl bg-[#fff5bd] px-4 py-3 text-sm font-extrabold text-slate-900">
              <span className="absolute -left-4 h-9 w-1 rounded-r bg-[#FFE600]" />
              <Boxes className="h-5 w-5" />
              Módulos
            </button>
            <button type="button" onClick={() => navigate(reportsPath)} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
              <BarChart3 className="h-5 w-5" />
              Relatórios
            </button>
            <button type="button" onClick={() => currentUser?.isAdmin && navigate('/admin')} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
              <Settings className="h-5 w-5" />
              Configurações
            </button>
            <button type="button" onClick={() => window.alert('Ajuda: escolha um módulo ou utilize a busca no topo.')} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
              <CircleHelp className="h-5 w-5" />
              Ajuda
            </button>
          </div>
        </nav>

        <div className="mx-6 mb-7 border-t border-slate-200 pt-6">
          <div className="flex gap-3 text-slate-500">
            <PackageOpen className="mt-0.5 h-6 w-6 shrink-0" />
            <div className="text-xs font-medium leading-4">
              Mais agilidade<br />
              para um mundo<br />
              em movimento.
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
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Buscar módulos, ferramentas ou ajuda..."
              className="h-11 w-full rounded-lg border border-slate-300 bg-slate-50 pl-12 pr-4 text-sm text-slate-800 outline-none transition focus:border-[#3483FA] focus:bg-white focus:ring-2 focus:ring-blue-100"
            />
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

        <main className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
          <div className="mb-5 flex items-center gap-2 text-xs font-medium text-slate-500">
            <span className="text-[#1769ff]">Início</span>
            <ChevronRight className="h-4 w-4" />
            <span className="font-bold text-slate-800">Módulos</span>
          </div>

          <div className="mb-6 flex flex-col justify-between gap-4 md:flex-row md:items-start">
            <div>
              <h1 className="text-4xl font-black tracking-tight text-slate-950 sm:text-5xl">Módulos</h1>
              <p className="mt-1.5 text-sm text-slate-500 sm:text-base">
                Ferramentas para otimizar sua operação logística.
              </p>
            </div>

            <div className="hidden min-w-[310px] items-center gap-4 rounded-xl bg-blue-50/70 px-5 py-4 text-slate-600 md:flex">
              <Rocket className="h-8 w-8 shrink-0 text-slate-500" />
              <div className="text-sm leading-5">
                Operações mais inteligentes<br />
                entregam grandes resultados.
                <div className="mt-3 h-0.5 w-10 bg-[#FFE600]" />
              </div>
            </div>
          </div>

          <div className="space-y-4">
            {(filteredBacklog.length > 0 || !query) && (
              <ModuleGroup
                title="Lista Backlog"
                count={backlogTools.length}
                accent="yellow"
                icon={Folder}
                tools={filteredBacklog}
                isOpen={isBacklogOpen}
                onToggle={() => setIsBacklogOpen(value => !value)}
                onOpenTool={navigate}
                status={(
                  <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-xs font-medium text-slate-600 sm:flex">
                    <span className={`h-2.5 w-2.5 rounded-full ${totalRows > 0 ? 'bg-emerald-500' : 'bg-amber-500'}`} />
                    {totalRows > 0 ? `${totalRows.toLocaleString('pt-BR')} IDs carregados` : 'Aguardando CSV'}
                  </div>
                )}
                footer={canUpload ? (
                  <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 sm:px-7">
                    {totalRows > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          if (window.confirm('Tem certeza que deseja zerar os dados da base principal?')) onClear();
                        }}
                        className="rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-600 transition hover:bg-red-100"
                      >
                        Zerar base
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => navigate('/upload')}
                      className="flex items-center gap-2 rounded-lg bg-[#1769ff] px-5 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-700"
                    >
                      <UploadCloud className="h-4 w-4" />
                      {totalRows > 0 ? 'Atualizar CSV' : 'Carregar CSV'}
                    </button>
                  </div>
                ) : undefined}
              />
            )}

            {(filteredRefugo.length > 0 || !query) && (
              <ModuleGroup
                title="Controle Refugo"
                count={refugoTools.length}
                accent="blue"
                icon={Folder}
                tools={filteredRefugo}
                isOpen={isRefugoOpen}
                onToggle={() => setIsRefugoOpen(value => !value)}
                onOpenTool={navigate}
              />
            )}

            {(filteredBrancas.length > 0 || !query) && (
              <ModuleGroup
                title="Análise de Brancas"
                accent="orange"
                icon={FileSpreadsheet}
                tools={filteredBrancas}
                isOpen={isBrancasOpen}
                onToggle={() => setIsBrancasOpen(value => !value)}
                onOpenTool={navigate}
                status={(
                  <span className="hidden rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[10px] font-extrabold uppercase text-amber-700 sm:inline-flex">
                    Novo
                  </span>
                )}
              />
            )}

            {query && filteredBacklog.length === 0 && filteredRefugo.length === 0 && filteredBrancas.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                <Search className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-3 text-sm font-bold text-slate-700">Nenhum módulo encontrado</p>
                <p className="mt-1 text-xs text-slate-400">Tente buscar por outro nome ou ferramenta.</p>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
