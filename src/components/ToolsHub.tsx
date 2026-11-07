import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  ArrowRight,
  BarChart3,
  Barcode,
  BookOpen,
  Code2,
  Database,
  FileSearch,
  GitCompareArrows,
  ListTodo,
  MessageSquare,
  PackageOpen,
  Search,
  Settings,
  Trash2,
  Truck,
  UploadCloud,
} from 'lucide-react';
import type { GroupSummary } from '../types';
import type { User } from '../lib/auth';
import { DashboardShell } from './DashboardShell';

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
  category: 'operacao' | 'conciliacao' | 'sistema';
  icon: React.ElementType;
  iconClass: string;
  iconBoxClass: string;
  adminOnly?: boolean;
  publicModule?: boolean;
};

const ALL_TOOLS: ToolItem[] = [
  {
    id: 'listas',
    path: '/listas',
    name: 'Listas de Coleta',
    category: 'operacao',
    icon: ListTodo,
    iconClass: 'text-amber-700',
    iconBoxClass: 'bg-amber-50 border border-amber-200',
  },
  {
    id: 'consulta',
    path: '/consulta',
    name: 'Buscar IDs',
    category: 'operacao',
    icon: Search,
    iconClass: 'text-[#1769ff]',
    iconBoxClass: 'bg-blue-50 border border-blue-200',
  },
  {
    id: 'refugo',
    path: '/refugo',
    name: 'Controle Refugo',
    category: 'operacao',
    icon: Barcode,
    iconClass: 'text-rose-700',
    iconBoxClass: 'bg-rose-50 border border-rose-200',
  },
  {
    id: 'expedicao',
    path: '/expedicao',
    name: 'Controle de Docas',
    category: 'operacao',
    icon: Truck,
    iconClass: 'text-indigo-700',
    iconBoxClass: 'bg-indigo-50 border border-indigo-200',
  },
  {
    id: 'brancas',
    path: '/brancas',
    name: 'Análise de Brancas',
    category: 'conciliacao',
    icon: FileSearch,
    iconClass: 'text-orange-700',
    iconBoxClass: 'bg-orange-50 border border-orange-200',
  },
  {
    id: 'correlacao',
    path: '/correlacao',
    name: 'Correlação de IDs',
    category: 'conciliacao',
    icon: GitCompareArrows,
    iconClass: 'text-violet-700',
    iconBoxClass: 'bg-violet-50 border border-violet-200',
  },
  {
    id: 'baixas',
    path: '/baixas',
    name: 'Baixas',
    category: 'conciliacao',
    icon: PackageOpen,
    iconClass: 'text-emerald-700',
    iconBoxClass: 'bg-emerald-50 border border-emerald-200',
  },
  {
    id: 'remover',
    path: '/remover',
    name: 'Remover IDs',
    category: 'conciliacao',
    icon: Trash2,
    iconClass: 'text-red-600',
    iconBoxClass: 'bg-red-50 border border-red-200',
  },
  {
    id: 'reporte',
    path: '/reporte',
    name: 'Reporte WhatsApp',
    category: 'conciliacao',
    icon: MessageSquare,
    iconClass: 'text-emerald-600',
    iconBoxClass: 'bg-emerald-50 border border-emerald-200',
  },
  {
    id: 'guia',
    path: '/guia',
    name: 'Guia & Aulas',
    category: 'sistema',
    icon: BookOpen,
    iconClass: 'text-emerald-700',
    iconBoxClass: 'bg-emerald-50 border border-emerald-200',
    publicModule: true,
  },
  {
    id: 'codes',
    path: '/codes',
    name: 'Codes',
    category: 'sistema',
    icon: Code2,
    iconClass: 'text-[#1769ff]',
    iconBoxClass: 'bg-blue-50 border border-blue-200',
    publicModule: true,
  },
  {
    id: 'admin',
    path: '/admin',
    name: 'Relatórios',
    category: 'sistema',
    icon: BarChart3,
    iconClass: 'text-slate-700',
    iconBoxClass: 'bg-slate-100 border border-slate-200',
    adminOnly: true,
  },
  {
    id: 'configuracoes',
    path: '/configuracoes',
    name: 'Configurações',
    category: 'sistema',
    icon: Settings,
    iconClass: 'text-slate-700',
    iconBoxClass: 'bg-slate-100 border border-slate-200',
    publicModule: true,
  },
];

export const ToolsHub: React.FC<ToolsHubProps> = ({
  totalRows,
  groups: _groups,
  onClear,
  currentUser,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const canUpload = Boolean(currentUser?.isAdmin || currentUser?.allowedGroups?.includes('upload'));

  const allowedTools = useMemo(() => {
    return ALL_TOOLS.filter(tool => {
      if (tool.adminOnly) return Boolean(currentUser?.isAdmin);
      if (tool.publicModule) return true;
      if (currentUser?.isAdmin) return true;
      return Boolean(currentUser?.allowedGroups?.includes(tool.id));
    });
  }, [currentUser]);

  const filteredTools = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return allowedTools;
    return allowedTools.filter(tool => tool.name.toLowerCase().includes(q));
  }, [allowedTools, query]);

  const operacaoTools = useMemo(
    () => filteredTools.filter(t => t.category === 'operacao'),
    [filteredTools]
  );
  const conciliacaoTools = useMemo(
    () => filteredTools.filter(t => t.category === 'conciliacao'),
    [filteredTools]
  );
  const sistemaTools = useMemo(
    () => filteredTools.filter(t => t.category === 'sistema'),
    [filteredTools]
  );

  const renderSection = (title: string, items: ToolItem[]) => {
    if (items.length === 0) return null;
    return (
      <section className="space-y-2.5">
        <div className="flex items-center justify-between border-b border-slate-200 pb-1.5">
          <h2 className="text-xs font-black uppercase tracking-wider text-slate-500">
            {title}
          </h2>
          <span className="font-mono text-[11px] font-bold text-slate-400">
            {items.length}
          </span>
        </div>

        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
          {items.map(tool => {
            const Icon = tool.icon;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => navigate(tool.path)}
                className="group flex items-center justify-between gap-3 border border-slate-200 bg-white p-3.5 text-left transition hover:border-slate-400 hover:bg-slate-50/70 shadow-2xs cursor-pointer"
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center ${tool.iconBoxClass}`}>
                    <Icon className={`h-4 w-4 ${tool.iconClass}`} />
                  </span>
                  <span className="truncate text-sm font-black text-slate-900">
                    {tool.name}
                  </span>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-hover:translate-x-0.5 group-hover:text-[#1769ff]" />
              </button>
            );
          })}
        </div>
      </section>
    );
  };

  return (
    <DashboardShell currentUser={currentUser}>
      <div className="space-y-5">
        {/* Barra Superior de Status da Base e Filtro */}
        <div className="flex flex-col gap-2.5 border border-slate-200 bg-white p-3.5 shadow-2xs sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-base font-black uppercase tracking-tight text-slate-900">
              Módulos
            </h1>

            <div className="flex items-center gap-1.5 border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700">
              <Database className="h-3.5 w-3.5 text-[#1769ff]" />
              <span className="font-mono">
                {totalRows > 0 ? `${totalRows.toLocaleString('pt-BR')} IDs na base` : 'Base CSV vazia'}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 sm:w-56 sm:flex-initial">
              <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="Filtrar módulo..."
                className="h-8 w-full border border-slate-200 bg-slate-50 pl-8 pr-2.5 text-xs text-slate-800 outline-none focus:border-[#1769ff] focus:bg-white"
              />
            </div>

            {canUpload && (
              <>
                {totalRows > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      if (window.confirm('Zerar os dados da base CSV principal?')) onClear();
                    }}
                    className="h-8 border border-red-200 bg-white px-3 text-xs font-bold text-red-600 hover:bg-red-50 cursor-pointer"
                  >
                    Zerar Base
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => navigate('/upload')}
                  className="inline-flex h-8 items-center gap-1.5 bg-[#1769ff] px-3 text-xs font-bold text-white hover:bg-blue-700 cursor-pointer"
                >
                  <UploadCloud className="h-3.5 w-3.5" />
                  <span>{totalRows > 0 ? 'Atualizar CSV' : 'Carregar CSV'}</span>
                </button>
              </>
            )}
          </div>
        </div>

        {/* Grades de Módulos sem descrições supérfluas */}
        {filteredTools.length === 0 ? (
          <div className="border border-dashed border-slate-300 bg-white py-10 text-center text-xs text-slate-500">
            Nenhum módulo encontrado.
          </div>
        ) : (
          <div className="space-y-5">
            {renderSection('Operação & Coleta', operacaoTools)}
            {renderSection('Conciliação & Auditoria', conciliacaoTools)}
            {renderSection('Sistema', sistemaTools)}
          </div>
        )}
      </div>
    </DashboardShell>
  );
};
