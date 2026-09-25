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
  Folder,
  GitCompareArrows,
  Home,
  ListTodo,
  MessageSquare,
  PackageOpen,
  Search,
  Settings,
  Trash2,
  UploadCloud,
  UserCircle2,
  Zap,
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
        className={`flex w-full items-center justify-between gap-4 bg-white px-5 py-3.5 text-left transition-colors hover:bg-slate-50/80 sm:px-6 ${isOpen ? 'border-b border-slate-200' : ''}`}
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
            {tools.length > 0 ? tools.map(tool => {
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
            }) : (
              <div className="px-6 py-5 text-sm text-slate-500">Nenhum módulo encontrado.</div>
            )}
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

  // Sempre inicia fechado quando a página é carregada/recarregada.
  const [isBacklogOpen, setIsBacklogOpen] = useState(false);
  const [isRefugoOpen, setIsRefugoOpen] = useState(false);
  const [isBrancasOpen, setIsBrancasOpen] = useState(false);
  const [isCorrelacaoOpen, setIsCorrelacaoOpen] = useState(false);

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

  const correlacaoTools: ToolItem[] = [
    {
      id: 'correlacao',
      path: '/correlacao',
      name: 'Correlação de IDs',
      description: 'Compare IDs da lista com a base FOS, motivo e data.',
      tag: 'Conciliação',
      icon: GitCompareArrows,
      iconClass: 'text-violet-600',
      iconBoxClass: 'bg-violet-50',
      badgeClass: 'border-violet-200 bg-violet-50 text-violet-700',
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
  const filteredCorrelacao = useMemo(() => correlacaoTools.filter(matchesQuery), [query]);

  const logout = async () => {
    const auth = await import('../lib/auth');
    auth.logoutUser();
    window.location.href = '/login';
  };

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-[238px] flex-col border-r border-slate-200 bg-white lg:flex">
        <div className="flex h-[72px] items-center gap-3 bg-[#FFE600] px-7">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#253b80] text-white shadow-sm">
            <Zap className="h-5 w-5" />
          </span>
          <div className="text-[22px] font-black tracking-[-0.04em] text-[#253b80]">ecooy</div>
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

            {currentUser?.isAdmin && (
              <button type="button" onClick={() => navigate('/admin')} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
                <BarChart3 className="h-5 w-5" />
                Relatórios
              </button>
            )}

            <button type="button" onClick={() => navigate('/configuracoes')} className="flex w-full items-center gap-4 rounded-xl px-4 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900">
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
          <div className="mb-5 flex items-center gap-2 text-xs font-medium text-slate-400">
            <span className="text-[#1769ff]">Início</span>
            <ChevronRight className="h-3.5 w-3.5" />
            <span className="font-bold text-slate-700">Módulos</span>
          </div>

          <div className="mb-7 flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
            <div>
              <h1 className="text-3xl font-black tracking-[-0.04em] text-slate-950 sm:text-4xl">Módulos</h1>
              <p className="mt-1 text-sm text-slate-500 sm:text-base">Ferramentas para otimizar sua operação logística.</p>
            </div>

            <div className="hidden items-center gap-4 rounded-2xl bg-blue-50/70 px-5 py-4 text-slate-600 xl:flex">
              <Zap className="h-7 w-7 text-[#1769ff]" />
              <div>
                <div className="text-sm font-medium">Operações mais simples</div>
                <div className="text-sm font-medium">entregam grandes resultados.</div>
                <div className="mt-2 h-0.5 w-10 bg-[#FFE600]" />
              </div>
            </div>
          </div>

          <div className="mb-5 flex gap-2 overflow-x-auto pb-1 lg:hidden">
            <button onClick={() => navigate('/')} className="rounded-xl bg-[#fff5bd] px-4 py-2 text-xs font-bold text-slate-900">Módulos</button>
            {currentUser?.isAdmin && (
              <button onClick={() => navigate('/admin')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm">Relatórios</button>
            )}
            <button onClick={() => navigate('/configuracoes')} className="rounded-xl bg-white px-4 py-2 text-xs font-bold text-slate-600 shadow-sm">Configurações</button>
          </div>

          <div className="space-y-4">
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
                <div className="hidden items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 sm:flex">
                  <span className={`h-2.5 w-2.5 rounded-full ${totalRows > 0 ? 'bg-emerald-500' : 'bg-amber-400'}`} />
                  {totalRows > 0 ? `${totalRows.toLocaleString('pt-BR')} IDs` : 'Aguardando CSV'}
                </div>
              )}
              footer={canUpload ? (
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 bg-slate-50/40 px-5 py-3 sm:px-7">
                  {totalRows > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        if (window.confirm('Tem certeza que deseja zerar os dados da base principal?')) onClear();
                      }}
                      className="rounded-xl border border-red-200 bg-white px-3.5 py-2 text-xs font-bold text-red-600 hover:bg-red-50"
                    >
                      Zerar base
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => navigate('/upload')}
                    className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-4 py-2.5 text-xs font-extrabold text-white shadow-sm hover:bg-blue-700"
                  >
                    <UploadCloud className="h-4 w-4" />
                    {totalRows > 0 ? 'Atualizar CSV' : 'Carregar CSV'}
                  </button>
                </div>
              ) : undefined}
            />

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

            <ModuleGroup
              title="Análise de Brancas"
              accent="orange"
              icon={FileSearch}
              tools={filteredBrancas}
              isOpen={isBrancasOpen}
              onToggle={() => setIsBrancasOpen(value => !value)}
              onOpenTool={navigate}
              status={<span className="rounded-full border border-amber-300 bg-amber-50 px-3 py-1 text-[10px] font-black uppercase text-amber-700">Novo</span>}
            />

            <ModuleGroup
              title="Correlação"
              count={correlacaoTools.length}
              accent="blue"
              icon={GitCompareArrows}
              tools={filteredCorrelacao}
              isOpen={isCorrelacaoOpen}
              onToggle={() => setIsCorrelacaoOpen(value => !value)}
              onOpenTool={navigate}
              status={<span className="rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-[10px] font-black uppercase text-violet-700">Novo</span>}
            />
          </div>
        </main>
      </div>
    </div>
  );
};
