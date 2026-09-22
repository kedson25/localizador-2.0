import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  BarChart3,
  Check,
  CheckCircle2,
  ChevronRight,
  Copy,
  Database,
  Download,
  Edit3,
  FileText,
  Package,
  Search,
  Shield,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  User,
  deleteUser,
  getAllUsers,
  getUserById,
  updateUserAdminStatus,
} from '../lib/auth';
import {
  deleteRefugoHistoricoMetrica,
  listenToListas,
  listenToRefugoHistoricoMetricas,
  listenToRefugoScans,
  saveLista,
} from '../lib/firebase';
import { ColetaLista, RefugoHistoricoMetrica } from '../types';
import { AdminRefugoMetrics } from './AdminRefugoMetrics';
import { PageSkeleton } from './PageSkeleton';
import { SupabaseManager } from './SupabaseManager';

export interface RefugoScan {
  id: string;
  rota: string;
  scannedAt: Date | string;
  status: 'found' | 'not_found';
  foundBy?: string;
}

interface AdminPanelProps {
  currentUser?: User | null;
}

const ACCESS_TABS = [
  { id: 'consulta', label: 'Buscar grupos' },
  { id: 'remover', label: 'Remover IDs' },
  { id: 'reporte', label: 'Reporte' },
  { id: 'upload', label: 'Importar CSV' },
];

function parseToYYYYMMDD(value?: string): string | null {
  if (!value) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;

  const match = text.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})/);
  if (!match) return null;

  const [, dd, mm, yyyy] = match;
  return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

function getLocalDateIso(offsetDays = 0): string {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getListDateIso(lista: ColetaLista): string | null {
  const direct = parseToYYYYMMDD(lista.data) || parseToYYYYMMDD(lista.nome);
  if (direct) return direct;

  const created = (lista as any).createdAt;
  if (typeof created === 'string') {
    const parsed = parseToYYYYMMDD(created);
    if (parsed) return parsed;
  }

  if (lista.id?.startsWith('lista-')) {
    const timestamp = Number(lista.id.replace('lista-', ''));
    if (Number.isFinite(timestamp) && timestamp > 1_000_000_000_000) {
      const date = new Date(timestamp);
      return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    }
  }

  return null;
}

function formatDate(value?: string | null): string {
  if (!value) return '-';
  const iso = parseToYYYYMMDD(value) || value;
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso.split('-').reverse().join('/');
  }
  return value;
}

function parseDateRobust(value: any): Date | null {
  if (!value) return null;
  if (value instanceof Date) return value;
  if (typeof value?.toDate === 'function') return value.toDate();
  if (typeof value === 'number') {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (typeof value === 'string') {
    const native = new Date(value);
    if (!Number.isNaN(native.getTime())) return native;

    const br = value.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,?\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    if (br) {
      const [, dd, mm, yyyy, hh = '0', min = '0', ss = '0'] = br;
      const parsed = new Date(Number(yyyy), Number(mm) - 1, Number(dd), Number(hh), Number(min), Number(ss));
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  if (value?.seconds) return new Date(value.seconds * 1000);
  return null;
}

function countRotasBrancas(lista: ColetaLista): number {
  if (lista.motivosCount) {
    return Object.entries(lista.motivosCount).reduce((total, [key, value]) => {
      return key.toLowerCase().includes('branca') ? total + Number(value || 0) : total;
    }, 0);
  }

  return (lista.itens || []).filter(item => (item.rota || '').toLowerCase().includes('branca')).length;
}

function listStats(lista: ColetaLista) {
  const total = lista.totalItens ?? lista.itens?.length ?? 0;
  const validados = lista.totalValidados ?? (lista.itens || []).filter(item => item.validado).length;
  const pendentes = Math.max(0, total - validados);
  return { total, validados, pendentes };
}

export const AdminPanel: React.FC<AdminPanelProps> = ({ currentUser }) => {
  const navigate = useNavigate();
  const [adminTab, setAdminTab] = useState<'metricas' | 'usuarios' | 'supabase'>('metricas');
  const [quickFilter, setQuickFilter] = useState<'todos' | 'hoje' | 'ontem' | '7dias' | '15dias' | 'mes_atual' | 'custom'>('todos');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [users, setUsers] = useState<User[]>([]);
  const [listas, setListas] = useState<ColetaLista[]>([]);
  const [refugoScans, setRefugoScans] = useState<RefugoScan[]>([]);
  const [refugoHistorico, setRefugoHistorico] = useState<RefugoHistoricoMetrica[]>([]);
  const [loading, setLoading] = useState(true);
  const [listasReady, setListasReady] = useState(false);
  const [isVerifiedAdmin, setIsVerifiedAdmin] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const [selectedListaForMetrics, setSelectedListaForMetrics] = useState<ColetaLista | null>(null);
  const [formAcerto, setFormAcerto] = useState('100');
  const [formGaiola, setFormGaiola] = useState('Fechado com Sucesso');
  const [formFaltaram, setFormFaltaram] = useState('0');
  const [formStatus, setFormStatus] = useState<'em_andamento' | 'finalizada'>('finalizada');
  const [formData, setFormData] = useState('');

  const [selectedListaForReport, setSelectedListaForReport] = useState<ColetaLista | null>(null);
  const [reportTab, setReportTab] = useState<'nao_validados' | 'todos' | 'validados'>('nao_validados');
  const [reportSearch, setReportSearch] = useState('');
  const [copiedReportNaoValidados, setCopiedReportNaoValidados] = useState(false);
  const [copiedItemId, setCopiedItemId] = useState<string | null>(null);

  useEffect(() => {
    setListasReady(false);

    const verify = async () => {
      setLoading(true);
      if (!currentUser?.id) {
        setIsVerifiedAdmin(false);
        setLoading(false);
        return;
      }

      try {
        const freshUser = await getUserById(currentUser.id);
        if (!freshUser?.isAdmin) {
          setIsVerifiedAdmin(false);
          return;
        }

        setIsVerifiedAdmin(true);
        setUsers(await getAllUsers());
        setOperationError(null);
      } catch (error) {
        setIsVerifiedAdmin(false);
        setOperationError(error instanceof Error ? error.message : 'Não foi possível verificar o acesso.');
      } finally {
        setLoading(false);
      }
    };

    void verify();

    const unsubListas = listenToListas(data => {
      setListas(data);
      setListasReady(true);
    });
    const unsubRefugo = listenToRefugoScans(setRefugoScans);
    const unsubHistorico = listenToRefugoHistoricoMetricas(setRefugoHistorico);

    return () => {
      unsubListas();
      unsubRefugo();
      unsubHistorico();
    };
  }, [currentUser]);

  useEffect(() => {
    if (!selectedListaForReport) return;
    const fresh = listas.find(lista => lista.id === selectedListaForReport.id);
    if (fresh) setSelectedListaForReport(fresh);
  }, [listas, selectedListaForReport?.id]);

  const refreshUsers = async () => setUsers(await getAllUsers());

  const runAdminAction = async (action: () => Promise<void>) => {
    try {
      await action();
      setOperationError(null);
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : 'Não foi possível concluir a operação.');
    }
  };

  const applyPreset = (preset: 'todos' | 'hoje' | 'ontem' | '7dias' | '15dias' | 'mes_atual') => {
    setQuickFilter(preset);
    const today = getLocalDateIso();

    if (preset === 'todos') {
      setStartDate('');
      setEndDate('');
      return;
    }
    if (preset === 'hoje') {
      setStartDate(today);
      setEndDate(today);
      return;
    }
    if (preset === 'ontem') {
      const yesterday = getLocalDateIso(-1);
      setStartDate(yesterday);
      setEndDate(yesterday);
      return;
    }
    if (preset === '7dias') {
      setStartDate(getLocalDateIso(-6));
      setEndDate(today);
      return;
    }
    if (preset === '15dias') {
      setStartDate(getLocalDateIso(-14));
      setEndDate(today);
      return;
    }

    const now = new Date();
    setStartDate(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
    setEndDate(today);
  };

  const filteredListas = useMemo(() => {
    return [...listas]
      .filter(lista => {
        if (!startDate && !endDate) return true;
        const date = getListDateIso(lista);
        if (!date) return true;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
      })
      .sort((a, b) => {
        const dateA = getListDateIso(a) || '';
        const dateB = getListDateIso(b) || '';
        if (dateA !== dateB) return dateB.localeCompare(dateA);
        return b.id.localeCompare(a.id);
      });
  }, [listas, startDate, endDate]);

  const filteredRefugoHistorico = useMemo(() => {
    return refugoHistorico.filter(item => {
      const date = item.data || (item.timestamp ? new Date(item.timestamp).toISOString().slice(0, 10) : '');
      if (!date) return true;
      return (!startDate || date >= startDate) && (!endDate || date <= endDate);
    });
  }, [refugoHistorico, startDate, endDate]);

  const filteredActiveScans = useMemo(() => {
    return refugoScans.filter(scan => {
      const date = parseDateRobust(scan.scannedAt);
      if (!date) return false;
      const iso = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      return (!startDate || iso >= startDate) && (!endDate || iso <= endDate);
    });
  }, [refugoScans, startDate, endDate]);

  const metrics = useMemo(() => {
    const finalizadas = filteredListas.filter(lista => lista.status === 'finalizada');
    const volume = filteredListas.reduce((total, lista) => total + listStats(lista).total, 0);
    const validados = filteredListas.reduce((total, lista) => total + listStats(lista).validados, 0);
    const brancasListas = filteredListas.reduce((total, lista) => total + countRotasBrancas(lista), 0);

    const historicoEncontrados = filteredRefugoHistorico.reduce((total, item) => total + Number(item.totalEncontrados || 0), 0);
    const historicoBrancas = filteredRefugoHistorico.reduce((total, item) => total + Number(item.totalBrancas || 0), 0);
    const ativosEncontrados = filteredActiveScans.filter(scan => scan.status === 'found').length;
    const ativosBrancas = filteredActiveScans.filter(scan => scan.status !== 'found' || (scan.rota || '').toLowerCase().includes('branca')).length;

    const accuracies = finalizadas
      .map(lista => Number(lista.porcentagemAcerto))
      .filter(value => Number.isFinite(value));

    return {
      volume,
      taxaValidacao: volume > 0 ? Math.round((validados / volume) * 100) : 0,
      finalizadas: finalizadas.length,
      totalListas: filteredListas.length,
      mediaAcerto: accuracies.length > 0 ? (accuracies.reduce((a, b) => a + b, 0) / accuracies.length).toFixed(1) : '0.0',
      brancas: brancasListas + historicoBrancas + ativosBrancas,
      encontradas: historicoEncontrados + ativosEncontrados,
    };
  }, [filteredListas, filteredRefugoHistorico, filteredActiveScans]);

  const pendingUsers = users.filter(user => !user.isApproved);

  const openReport = (lista: ColetaLista) => {
    const stats = listStats(lista);
    setSelectedListaForReport(lista);
    setReportTab(stats.pendentes > 0 ? 'nao_validados' : 'todos');
    setReportSearch('');
  };

  const openMetrics = (lista: ColetaLista) => {
    setSelectedListaForMetrics(lista);
    setFormAcerto(lista.porcentagemAcerto !== undefined ? String(lista.porcentagemAcerto) : '100');
    setFormGaiola(lista.fechamentoGaiola || 'Fechado com Sucesso');
    setFormFaltaram(lista.itensFaltaram !== undefined ? String(lista.itensFaltaram) : '0');
    setFormStatus(lista.status || 'finalizada');
    setFormData(lista.data || getLocalDateIso());
  };

  const saveMetrics = async () => {
    if (!selectedListaForMetrics) return;
    await runAdminAction(async () => {
      await saveLista({
        ...selectedListaForMetrics,
        status: formStatus,
        data: formData || selectedListaForMetrics.data,
        porcentagemAcerto: Number.parseFloat(formAcerto) || 0,
        fechamentoGaiola: formGaiola,
        itensFaltaram: Number.parseInt(formFaltaram, 10) || 0,
      });
      setSelectedListaForMetrics(null);
    });
  };

  const toggleApproval = async (user: User) => {
    await runAdminAction(async () => {
      await updateUserAdminStatus(user.id, { isApproved: !user.isApproved });
      await refreshUsers();
    });
  };

  const toggleAdmin = async (user: User) => {
    await runAdminAction(async () => {
      await updateUserAdminStatus(user.id, { isAdmin: !user.isAdmin });
      await refreshUsers();
    });
  };

  const toggleTabAccess = async (user: User, tabId: string) => {
    const current = user.allowedGroups || [];
    const next = current.includes(tabId) ? current.filter(id => id !== tabId) : [...current, tabId];
    await runAdminAction(async () => {
      await updateUserAdminStatus(user.id, { allowedGroups: next });
      await refreshUsers();
    });
  };

  const removeUser = async (user: User) => {
    if (!window.confirm(`Excluir ${user.username}?`)) return;
    await runAdminAction(async () => {
      await deleteUser(user.id);
      await refreshUsers();
    });
  };

  const toggleValidatedItem = async (itemId: string) => {
    if (!selectedListaForReport) return;
    const itens = (selectedListaForReport.itens || []).map(item => item.id === itemId ? { ...item, validado: !item.validado } : item);
    await runAdminAction(async () => saveLista({ ...selectedListaForReport, itens }));
  };

  const validateAll = async () => {
    if (!selectedListaForReport) return;
    if (!window.confirm('Validar todos os IDs pendentes desta lista?')) return;
    const itens = (selectedListaForReport.itens || []).map(item => ({ ...item, validado: true }));
    await runAdminAction(async () => saveLista({ ...selectedListaForReport, itens }));
  };

  const copyPending = async () => {
    if (!selectedListaForReport) return;
    const text = (selectedListaForReport.itens || []).filter(item => !item.validado).map(item => item.codigo).join('\n');
    if (!text) return;
    await navigator.clipboard.writeText(text);
    setCopiedReportNaoValidados(true);
    setTimeout(() => setCopiedReportNaoValidados(false), 1800);
  };

  const downloadPending = () => {
    if (!selectedListaForReport) return;
    const text = (selectedListaForReport.itens || []).filter(item => !item.validado).map(item => item.codigo).join('\n');
    if (!text) return;
    const blob = new Blob([text], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `pendentes_${selectedListaForReport.nome.replace(/\s+/g, '_')}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (loading || !listasReady) return <PageSkeleton variant="dashboard" />;

  if (!isVerifiedAdmin) {
    return (
      <div className="mx-auto mt-10 max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <Shield className="mx-auto mb-3 h-9 w-9 text-gray-400" />
        <h2 className="text-lg font-bold text-gray-900">Acesso restrito</h2>
        <p className="mt-1 text-sm text-gray-500">Sua conta não possui permissão de administrador.</p>
        <button onClick={() => navigate('/')} className="mt-5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">Voltar</button>
      </div>
    );
  }

  const metricCards = [
    { label: 'Volume coletado', value: metrics.volume.toLocaleString('pt-BR') },
    { label: 'Validação', value: `${metrics.taxaValidacao}%` },
    { label: 'Listas concluídas', value: `${metrics.finalizadas}/${metrics.totalListas}` },
    { label: 'Média de acerto', value: `${metrics.mediaAcerto}%` },
    { label: 'Rotas brancas', value: metrics.brancas.toLocaleString('pt-BR') },
    { label: 'Rotas encontradas', value: metrics.encontradas.toLocaleString('pt-BR') },
  ];

  return (
    <div className="space-y-4 pb-10">
      {operationError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{operationError}</div>
      )}

      <nav className="flex flex-wrap items-center gap-1 rounded-xl border border-gray-200 bg-white p-1 shadow-sm">
        {[
          ['metricas', BarChart3, 'Visão geral'],
          ['usuarios', Users, 'Usuários'],
          ['supabase', Database, 'Banco'],
        ].map(([id, Icon, label]) => (
          <button
            key={String(id)}
            type="button"
            onClick={() => setAdminTab(id as 'metricas' | 'usuarios' | 'supabase')}
            className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${adminTab === id ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'}`}
          >
            <Icon className="h-4 w-4" />
            {label as string}
            {id === 'usuarios' && pendingUsers.length > 0 && <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] text-white">{pendingUsers.length}</span>}
          </button>
        ))}
      </nav>

      {adminTab === 'metricas' && (
        <div className="space-y-4">
          <section className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex flex-wrap gap-1.5">
                {[
                  ['todos', 'Todas'],
                  ['hoje', 'Hoje'],
                  ['ontem', 'Ontem'],
                  ['7dias', '7 dias'],
                  ['15dias', '15 dias'],
                  ['mes_atual', 'Mês'],
                ].map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => applyPreset(id as any)}
                    className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${quickFilter === id ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={startDate}
                  onChange={event => { setStartDate(event.target.value); setQuickFilter('custom'); }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 outline-none focus:border-gray-400"
                />
                <span className="text-xs text-gray-400">até</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={event => { setEndDate(event.target.value); setQuickFilter('custom'); }}
                  className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 outline-none focus:border-gray-400"
                />
                {(startDate || endDate) && (
                  <button onClick={() => applyPreset('todos')} className="rounded-lg px-2 py-1.5 text-xs font-semibold text-gray-500 hover:bg-gray-100">Limpar</button>
                )}
              </div>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
            {metricCards.map(card => (
              <div key={card.label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">{card.label}</p>
                <p className="mt-2 text-2xl font-bold tabular-nums text-gray-900">{card.value}</p>
              </div>
            ))}
          </section>

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
              <div>
                <h2 className="text-sm font-bold text-gray-900">Listas</h2>
                <p className="text-xs text-gray-400">{filteredListas.length} no período</p>
              </div>
            </div>

            {filteredListas.length === 0 ? (
              <div className="px-4 py-12 text-center text-sm text-gray-400">Nenhuma lista encontrada.</div>
            ) : (
              <div className="divide-y divide-gray-100">
                {filteredListas.map(lista => {
                  const stats = listStats(lista);
                  const validationRate = stats.total > 0 ? Math.round((stats.validados / stats.total) * 100) : 0;

                  return (
                    <div key={lista.id} className="grid gap-4 px-4 py-4 hover:bg-gray-50/70 lg:grid-cols-[minmax(220px,1.3fr)_minmax(430px,2fr)_auto] lg:items-center">
                      <button type="button" onClick={() => openReport(lista)} className="min-w-0 text-left">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold text-gray-900">{lista.nome}</span>
                          <span className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-semibold ${lista.status === 'finalizada' ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                            {lista.status === 'finalizada' ? 'Finalizada' : 'Em andamento'}
                          </span>
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                          <span>{formatDate(lista.data || getListDateIso(lista))}</span>
                          <span>{lista.tipo === 'grupos' ? 'Grupos' : 'Comum'}</span>
                          {lista.responsavel && <span>{lista.responsavel}</span>}
                        </div>
                      </button>

                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
                        <CompactStat label="Itens" value={stats.total} />
                        <CompactStat label="Validados" value={stats.validados} />
                        <CompactStat label="Validação" value={`${validationRate}%`} />
                        <CompactStat label="Acerto" value={lista.porcentagemAcerto !== undefined ? `${lista.porcentagemAcerto}%` : '-'} />
                        <CompactStat label="Faltantes" value={lista.itensFaltaram ?? '-'} danger={Number(lista.itensFaltaram || 0) > 0} />
                        <CompactStat label="Brancas" value={countRotasBrancas(lista)} />
                      </div>

                      <div className="flex items-center gap-2 lg:justify-end">
                        <button
                          type="button"
                          onClick={() => openReport(lista)}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-100"
                        >
                          Abrir
                          {stats.pendentes > 0 && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800">{stats.pendentes}</span>}
                          <ChevronRight className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => openMetrics(lista)}
                          className="rounded-lg border border-gray-200 p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900"
                          title="Editar fechamento"
                        >
                          <Edit3 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <details className="group rounded-xl border border-gray-200 bg-white shadow-sm">
            <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-sm font-semibold text-gray-800">
              <span>Detalhes do Refugo</span>
              <span className="text-xs font-normal text-gray-400">histórico, brancas e rotas encontradas</span>
            </summary>
            <div className="border-t border-gray-100 p-3 sm:p-4">
              <AdminRefugoMetrics
                historico={filteredRefugoHistorico}
                activeScans={filteredActiveScans}
                onDeleteHistorico={async id => runAdminAction(() => deleteRefugoHistoricoMetrica(id))}
                startDate={startDate}
                endDate={endDate}
              />
            </div>
          </details>
        </div>
      )}

      {adminTab === 'usuarios' && (
        <div className="space-y-4">
          {pendingUsers.length > 0 && (
            <section className="rounded-xl border border-amber-200 bg-white shadow-sm">
              <div className="border-b border-gray-100 px-4 py-3">
                <h2 className="text-sm font-bold text-gray-900">Aguardando aprovação</h2>
              </div>
              <div className="divide-y divide-gray-100">
                {pendingUsers.map(user => (
                  <div key={user.id} className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">{user.username}</p>
                      <p className="text-xs text-gray-400">{user.email}</p>
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => toggleApproval(user)} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white">Aprovar</button>
                      <button onClick={async () => { await toggleApproval(user); await runAdminAction(async () => { await updateUserAdminStatus(user.id, { isAdmin: true }); await refreshUsers(); }); }} className="rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-700">Aprovar como admin</button>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <div className="border-b border-gray-100 px-4 py-3">
              <h2 className="text-sm font-bold text-gray-900">Usuários</h2>
              <p className="text-xs text-gray-400">{users.length} cadastrados</p>
            </div>

            <div className="divide-y divide-gray-100">
              {users.map(user => (
                <div key={user.id} className="grid gap-3 px-4 py-4 lg:grid-cols-[minmax(190px,1fr)_auto_minmax(300px,1.4fr)_auto] lg:items-center">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-gray-900">{user.username}</p>
                    <p className="truncate text-xs text-gray-400">{user.email}</p>
                  </div>

                  <div className="flex gap-2">
                    <button onClick={() => toggleApproval(user)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${user.isApproved ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                      {user.isApproved ? 'Aprovado' : 'Pendente'}
                    </button>
                    <button onClick={() => toggleAdmin(user)} className={`rounded-md px-2.5 py-1.5 text-xs font-semibold ${user.isAdmin ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
                      Admin {user.isAdmin ? 'sim' : 'não'}
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    {ACCESS_TABS.map(tab => {
                      const active = (user.allowedGroups || []).includes(tab.id);
                      return (
                        <button key={tab.id} onClick={() => toggleTabAccess(user, tab.id)} className={`rounded-md border px-2 py-1 text-[11px] font-medium ${active ? 'border-gray-300 bg-gray-100 text-gray-800' : 'border-gray-200 bg-white text-gray-400'}`}>
                          {tab.label}
                        </button>
                      );
                    })}
                  </div>

                  <button onClick={() => removeUser(user)} className="justify-self-start rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 lg:justify-self-end" title="Excluir usuário">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {adminTab === 'supabase' && <SupabaseManager />}

      {selectedListaForMetrics && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-sm font-bold text-gray-900">Fechamento da lista</h3>
                <p className="mt-0.5 max-w-[280px] truncate text-xs text-gray-400">{selectedListaForMetrics.nome}</p>
              </div>
              <button onClick={() => setSelectedListaForMetrics(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
            </div>

            <div className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Status">
                  <select value={formStatus} onChange={event => setFormStatus(event.target.value as any)} className="field-input">
                    <option value="em_andamento">Em andamento</option>
                    <option value="finalizada">Finalizada</option>
                  </select>
                </Field>
                <Field label="Data">
                  <input type="date" value={formData} onChange={event => setFormData(event.target.value)} className="field-input" />
                </Field>
              </div>
              <Field label="Acerto (%)">
                <input type="number" min="0" max="100" step="0.1" value={formAcerto} onChange={event => setFormAcerto(event.target.value)} className="field-input" />
              </Field>
              <Field label="Fechamento da gaiola">
                <select value={formGaiola} onChange={event => setFormGaiola(event.target.value)} className="field-input">
                  <option>Fechado com Sucesso</option>
                  <option>Fechamento Parcial</option>
                  <option>Aguardando Recontagem</option>
                  <option>Divergência Encontrada</option>
                </select>
              </Field>
              <Field label="Faltantes">
                <input type="number" min="0" value={formFaltaram} onChange={event => setFormFaltaram(event.target.value)} className="field-input" />
              </Field>
            </div>

            <div className="flex justify-end gap-2 border-t border-gray-100 bg-gray-50 px-5 py-4">
              <button onClick={() => setSelectedListaForMetrics(null)} className="rounded-lg px-4 py-2 text-xs font-semibold text-gray-600 hover:bg-gray-200">Cancelar</button>
              <button onClick={saveMetrics} className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-semibold text-white hover:bg-black">Salvar</button>
            </div>
          </div>
        </div>
      )}

      {selectedListaForReport && (() => {
        const items = selectedListaForReport.itens || [];
        const pending = items.filter(item => !item.validado);
        const validated = items.filter(item => item.validado);
        let visible = reportTab === 'nao_validados' ? pending : reportTab === 'validados' ? validated : items;

        if (reportSearch.trim()) {
          const query = reportSearch.toLowerCase().trim();
          visible = visible.filter(item => [item.codigo, item.rota, item.motivo, item.responsavel].some(value => String(value || '').toLowerCase().includes(query)));
        }

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 sm:p-6">
            <div className="flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl">
              <div className="flex items-start justify-between border-b border-gray-100 px-5 py-4">
                <div className="min-w-0">
                  <h3 className="truncate text-base font-bold text-gray-900">{selectedListaForReport.nome}</h3>
                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-400">
                    <span>{formatDate(selectedListaForReport.data)}</span>
                    <span>{selectedListaForReport.status === 'finalizada' ? 'Finalizada' : 'Em andamento'}</span>
                    <span>{items.length} IDs</span>
                    <span>{pending.length} pendentes</span>
                  </div>
                </div>
                <button onClick={() => setSelectedListaForReport(null)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"><X className="h-4 w-4" /></button>
              </div>

              <div className="flex flex-col gap-3 border-b border-gray-100 px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex gap-1 rounded-lg bg-gray-100 p-1">
                  {[
                    ['nao_validados', `Pendentes ${pending.length}`],
                    ['todos', `Todos ${items.length}`],
                    ['validados', `Validados ${validated.length}`],
                  ].map(([id, label]) => (
                    <button key={id} onClick={() => setReportTab(id as any)} className={`rounded-md px-3 py-1.5 text-xs font-semibold ${reportTab === id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>{label}</button>
                  ))}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="relative min-w-[190px] flex-1">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
                    <input value={reportSearch} onChange={event => setReportSearch(event.target.value)} placeholder="Buscar ID, rota ou motivo" className="w-full rounded-lg border border-gray-200 py-2 pl-8 pr-3 text-xs outline-none focus:border-gray-400" />
                  </div>
                  <button onClick={copyPending} disabled={pending.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-semibold text-gray-600 disabled:opacity-40">
                    {copiedReportNaoValidados ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedReportNaoValidados ? 'Copiado' : 'Copiar pendentes'}
                  </button>
                  <button onClick={downloadPending} disabled={pending.length === 0} className="rounded-lg border border-gray-200 p-2 text-gray-500 disabled:opacity-40" title="Baixar pendentes"><Download className="h-4 w-4" /></button>
                  {pending.length > 0 && <button onClick={validateAll} className="rounded-lg bg-gray-900 px-3 py-2 text-xs font-semibold text-white">Validar todos</button>}
                </div>
              </div>

              <div className="flex-1 overflow-auto">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-gray-50 text-[10px] uppercase tracking-wide text-gray-400">
                    <tr>
                      <th className="px-4 py-3">ID</th>
                      <th className="px-3 py-3">Status</th>
                      <th className="px-3 py-3">Responsável</th>
                      <th className="px-3 py-3">Rota</th>
                      <th className="px-3 py-3">Motivo</th>
                      <th className="px-3 py-3">Data / hora</th>
                      <th className="px-3 py-3"></th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {visible.map(item => (
                      <tr key={item.id} className="hover:bg-gray-50">
                        <td className="px-4 py-3 font-mono font-semibold text-gray-900">{item.codigo}</td>
                        <td className="px-3 py-3">
                          <button onClick={() => toggleValidatedItem(item.id)} className={`rounded-md px-2 py-1 text-[10px] font-semibold ${item.validado ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            {item.validado ? 'Validado' : 'Pendente'}
                          </button>
                        </td>
                        <td className="px-3 py-3 text-gray-600">{item.responsavel || selectedListaForReport.responsavel || '-'}</td>
                        <td className="px-3 py-3 font-medium text-gray-700">{item.rota || '-'}</td>
                        <td className="max-w-[220px] truncate px-3 py-3 text-gray-500" title={item.motivo || ''}>{item.motivo || '-'}</td>
                        <td className="px-3 py-3 text-gray-400">{item.scannedAt || '-'}</td>
                        <td className="px-3 py-3 text-right">
                          <button
                            onClick={async () => {
                              await navigator.clipboard.writeText(item.codigo);
                              setCopiedItemId(item.codigo);
                              setTimeout(() => setCopiedItemId(null), 1200);
                            }}
                            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
                          >
                            {copiedItemId === item.codigo ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {visible.length === 0 && <div className="py-14 text-center text-sm text-gray-400">Nenhum item encontrado.</div>}
              </div>

              <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-400">
                <span>{visible.length} exibidos</span>
                <button onClick={() => setSelectedListaForReport(null)} className="rounded-lg px-3 py-1.5 font-semibold text-gray-600 hover:bg-gray-200">Fechar</button>
              </div>
            </div>
          </div>
        );
      })()}

      <style>{`
        .field-input {
          width: 100%;
          border: 1px solid rgb(229 231 235);
          border-radius: 0.5rem;
          padding: 0.625rem 0.75rem;
          font-size: 0.875rem;
          color: rgb(31 41 55);
          outline: none;
          background: white;
        }
        .field-input:focus { border-color: rgb(156 163 175); }
      `}</style>
    </div>
  );
};

const CompactStat: React.FC<{ label: string; value: React.ReactNode; danger?: boolean }> = ({ label, value, danger }) => (
  <div className="min-w-0">
    <p className="truncate text-[10px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
    <p className={`mt-0.5 truncate text-sm font-bold tabular-nums ${danger ? 'text-red-600' : 'text-gray-800'}`}>{value}</p>
  </div>
);

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-semibold text-gray-600">{label}</span>
    {children}
  </label>
);
