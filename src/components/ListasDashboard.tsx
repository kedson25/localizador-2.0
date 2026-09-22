import React, { useEffect, useMemo, useState } from 'react';
import {
  Barcode,
  CalendarDays,
  ChevronRight,
  Download,
  Layers,
  Package,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  User as UserIcon,
  X,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { ColetaLista } from '../types';
import { User } from '../lib/auth';
import {
  deleteLista as deleteListaFirestore,
  getAllItemsForExport,
  getListaSortTimestamp,
  listenToListas,
  saveLista,
} from '../lib/firebase';
import { apiReconcileListas } from '../lib/api';

interface ListasDashboardProps {
  currentUser?: User | null;
}

type DateFilter = 'hoje' | 'ontem' | '7dias' | '15dias' | 'mes' | 'todas';

const CICLOS = [
  'Ciclo 1 - Saída AM',
  'Ciclo 2 - Saída PM',
  'Ciclo 3 - Saída SD',
];

const DATE_FILTERS: Array<{ id: DateFilter; label: string }> = [
  { id: 'hoje', label: 'Hoje' },
  { id: 'ontem', label: 'Ontem' },
  { id: '7dias', label: '7 dias' },
  { id: '15dias', label: '15 dias' },
  { id: 'mes', label: 'Mês' },
  { id: 'todas', label: 'Todas' },
];

function localDateKey(date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  const dd = String(date.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function normalizeLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
}

function parseListaDate(lista: ColetaLista): Date {
  const raw = String(lista.data || '').trim();

  const br = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const [, dd, mm, yyyy] = br;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
  }

  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const [, yyyy, mm, dd] = iso;
    return new Date(Number(yyyy), Number(mm) - 1, Number(dd), 12, 0, 0, 0);
  }

  const createdAt = (lista as any).createdAt;
  if (typeof createdAt === 'string') {
    const parsed = new Date(createdAt);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  if (createdAt?.toDate) {
    const parsed = createdAt.toDate();
    if (parsed instanceof Date && !Number.isNaN(parsed.getTime())) return parsed;
  }
  if (createdAt?.seconds) {
    return new Date(createdAt.seconds * 1000);
  }

  if (lista.id?.startsWith('lista-')) {
    const timestamp = Number(lista.id.replace('lista-', ''));
    if (Number.isFinite(timestamp)) return new Date(timestamp);
  }

  return new Date(0);
}

function matchesDateFilter(date: Date, filter: DateFilter): boolean {
  if (filter === 'todas') return true;
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return false;

  const today = normalizeLocalDay(new Date());
  const target = normalizeLocalDay(date);

  if (filter === 'hoje') {
    return localDateKey(target) === localDateKey(today);
  }

  if (filter === 'ontem') {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    return localDateKey(target) === localDateKey(yesterday);
  }

  if (filter === 'mes') {
    return target.getFullYear() === today.getFullYear() && target.getMonth() === today.getMonth();
  }

  const days = filter === '7dias' ? 7 : 15;
  const firstDay = new Date(today);
  firstDay.setDate(firstDay.getDate() - (days - 1));

  return target.getTime() >= firstDay.getTime() && target.getTime() <= today.getTime();
}

function formatDate(date: Date): string {
  if (!date || Number.isNaN(date.getTime()) || date.getTime() === 0) return '-';
  return date.toLocaleDateString('pt-BR');
}

function groupLabel(date: Date): string {
  const today = normalizeLocalDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const key = localDateKey(normalizeLocalDay(date));
  if (key === localDateKey(today)) return 'Hoje';
  if (key === localDateKey(yesterday)) return 'Ontem';

  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });
}

function shortCycle(value?: string): string {
  const text = String(value || '').trim();
  if (!text) return '-';
  if (/SD/i.test(text)) return 'Saída SD';
  if (/PM/i.test(text)) return 'Saída PM';
  if (/AM/i.test(text)) return 'Saída AM';
  return text;
}

export const ListasDashboard: React.FC<ListasDashboardProps> = ({ currentUser }) => {
  const navigate = useNavigate();
  const [listas, setListas] = useState<ColetaLista[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [dateFilter, setDateFilter] = useState<DateFilter>('hoje');
  const [syncing, setSyncing] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);
  const [novaData, setNovaData] = useState(() => localDateKey(new Date()));
  const [novaSaida, setNovaSaida] = useState('Ciclo 2 - Saída PM');
  const [novoTipo, setNovoTipo] = useState<'comum' | 'grupos'>('comum');

  useEffect(() => {
    const unsubscribe = listenToListas(data => {
      setListas(data);
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();

    return [...listas]
      .filter(lista => matchesDateFilter(parseListaDate(lista), dateFilter))
      .filter(lista => {
        if (!term) return true;
        return [
          lista.nome,
          lista.data,
          lista.responsavel,
          lista.rota,
          lista.saidaPadrao,
          lista.tipo,
          lista.status,
        ].some(value => String(value || '').toLowerCase().includes(term));
      })
      .sort((a, b) => {
        const ta = getListaSortTimestamp(a);
        const tb = getListaSortTimestamp(b);
        if (ta !== tb) return tb - ta;
        return String(b.id || '').localeCompare(String(a.id || ''));
      });
  }, [listas, search, dateFilter]);

  const grouped = useMemo(() => {
    const groups = new Map<string, { label: string; date: Date; items: ColetaLista[] }>();

    for (const lista of filtered) {
      const date = parseListaDate(lista);
      const key = localDateKey(date);
      const existing = groups.get(key);

      if (existing) {
        existing.items.push(lista);
      } else {
        groups.set(key, {
          label: groupLabel(date),
          date,
          items: [lista],
        });
      }
    }

    return Array.from(groups.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
  }, [filtered]);

  const filteredTotalItens = useMemo(
    () => filtered.reduce((sum, lista) => sum + Number(lista.totalItens ?? lista.itens?.length ?? 0), 0),
    [filtered]
  );

  const currentFilterLabel = DATE_FILTERS.find(item => item.id === dateFilter)?.label || 'Hoje';

  const abrirLista = (id: string) => {
    setOpeningId(id);
    navigate(`/listas/${id}`);
  };

  const sincronizar = async () => {
    setSyncing(true);
    try {
      await apiReconcileListas();
    } catch (error) {
      console.error('Erro ao sincronizar listas:', error);
    } finally {
      setSyncing(false);
    }
  };

  const exportarLista = async (lista: ColetaLista) => {
    try {
      const itens = await getAllItemsForExport(lista.id);
      const ids = itens
        .map(item => String(item.codigo || '').replace(/\D/g, ''))
        .filter(Boolean);

      if (ids.length === 0) {
        window.alert('Não há itens para exportar.');
        return;
      }

      const blob = new Blob([ids.join('\n')], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${lista.nome.toLowerCase().replace(/\s+/g, '_')}_IDs.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Erro ao exportar lista:', error);
      window.alert('Não foi possível exportar a lista.');
    }
  };

  const reabrirLista = async (lista: ColetaLista) => {
    setListas(prev => prev.map(item => item.id === lista.id ? { ...item, status: 'em_andamento' } : item));
    try {
      await saveLista({ id: lista.id, status: 'em_andamento' } as ColetaLista);
    } catch (error) {
      console.error('Erro ao reabrir lista:', error);
    }
  };

  const excluirLista = async (lista: ColetaLista) => {
    if (!window.confirm(`Excluir a lista "${lista.nome}"?`)) return;
    setListas(prev => prev.filter(item => item.id !== lista.id));
    try {
      await deleteListaFirestore(lista.id);
    } catch (error) {
      console.error('Erro ao excluir lista:', error);
    }
  };

  const criarLista = async (event: React.FormEvent) => {
    event.preventDefault();
    if (creating) return;

    setCreating(true);
    try {
      const [yyyy, mm, dd] = novaData.split('-');
      const dataFormatada = yyyy && mm && dd ? `${dd}/${mm}/${yyyy}` : new Date().toLocaleDateString('pt-BR');

      let nomeCurto = novaSaida;
      if (/PM/i.test(novaSaida)) nomeCurto = 'Saída PM';
      else if (/AM/i.test(novaSaida)) nomeCurto = 'Saída AM';
      else if (/SD/i.test(novaSaida)) nomeCurto = 'Saída SD';

      const id = `lista-${Date.now()}`;
      const novaLista: ColetaLista = {
        id,
        nome: `${nomeCurto} - ${dataFormatada}`,
        tipo: novoTipo,
        grupos: novoTipo === 'grupos' ? [] : undefined,
        grupoAtivoId: '',
        rota: novoTipo === 'grupos' ? 'Multirotas / Grupos' : 'Geral',
        data: dataFormatada,
        createdAt: new Date().toISOString(),
        responsavel: currentUser?.username || 'Usuário',
        status: 'em_andamento',
        saidaPadrao: novaSaida,
        motivoPadrao: '',
        totalItens: 0,
        totalValidados: 0,
        itens: [],
      };

      setListas(prev => [novaLista, ...prev]);
      setShowCreate(false);
      await saveLista(novaLista, true);
      navigate(`/listas/${id}`);
    } catch (error) {
      console.error('Erro ao criar lista:', error);
      window.alert('Não foi possível criar a lista.');
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="w-full space-y-4 pb-10">
      <section className="rounded-2xl border border-gray-200 bg-white px-5 py-5 shadow-sm sm:px-6">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-[#3483FA]">
              <Package className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <h1 className="text-lg font-bold text-gray-900">Listas de Coleta</h1>
              <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-gray-500">
                <span>{filtered.length} {filtered.length === 1 ? 'lista' : 'listas'} em {currentFilterLabel.toLowerCase()}</span>
                <span>{filteredTotalItens.toLocaleString('pt-BR')} pacotes</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl bg-[#3483FA] px-4 py-2.5 text-sm font-bold text-white shadow-sm transition hover:bg-blue-600"
          >
            <Plus className="h-4 w-4" />
            Nova lista
          </button>
        </div>
      </section>

      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-100 p-4">
          <div className="flex flex-wrap gap-2">
            {DATE_FILTERS.map(filter => (
              <button
                key={filter.id}
                type="button"
                onClick={() => setDateFilter(filter.id)}
                className={`rounded-lg px-3.5 py-2 text-xs font-bold transition ${
                  dateFilter === filter.id
                    ? 'bg-[#3483FA] text-white shadow-sm'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200 hover:text-gray-900'
                }`}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-3 border-b border-gray-100 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative w-full sm:max-w-sm">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder="Buscar lista, ciclo ou responsável"
              className="w-full rounded-xl border border-gray-200 bg-gray-50 py-2.5 pl-9 pr-3 text-sm text-gray-800 outline-none transition focus:border-[#3483FA] focus:bg-white"
            />
          </div>

          <button
            type="button"
            onClick={sincronizar}
            disabled={syncing}
            className="inline-flex min-h-[40px] items-center justify-center gap-2 rounded-xl border border-gray-200 bg-white px-3.5 py-2 text-xs font-bold text-gray-600 transition hover:bg-gray-50 disabled:opacity-50"
          >
            <RotateCcw className={`h-4 w-4 ${syncing ? 'animate-spin text-[#3483FA]' : ''}`} />
            {syncing ? 'Sincronizando' : 'Sincronizar'}
          </button>
        </div>

        {loading ? (
          <div className="space-y-3 p-4">
            {[1, 2, 3].map(item => (
              <div key={item} className="h-24 animate-pulse rounded-xl bg-gray-100" />
            ))}
          </div>
        ) : grouped.length === 0 ? (
          <div className="px-4 py-14 text-center">
            <Package className="mx-auto h-9 w-9 text-gray-300" />
            <p className="mt-2 text-sm font-bold text-gray-600">Nenhuma lista em {currentFilterLabel.toLowerCase()}</p>
            <p className="mt-1 text-xs text-gray-400">Altere o período ou crie uma nova lista.</p>
            {dateFilter !== 'todas' && (
              <button
                type="button"
                onClick={() => setDateFilter('todas')}
                className="mt-4 rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs font-bold text-[#3483FA] hover:bg-blue-50"
              >
                Ver todas
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6 p-4 sm:p-5">
            {grouped.map(group => (
              <section key={localDateKey(group.date)}>
                <div className="mb-2 flex items-center gap-2 px-1">
                  <CalendarDays className={`h-4 w-4 ${group.label === 'Hoje' ? 'text-[#3483FA]' : group.label === 'Ontem' ? 'text-amber-600' : 'text-gray-400'}`} />
                  <h2 className="text-sm font-bold text-gray-900">{group.label}</h2>
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold text-gray-500">{group.items.length}</span>
                </div>

                <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                  {group.items.map((lista, index) => {
                    const total = Number(lista.totalItens ?? lista.itens?.length ?? 0);
                    const date = parseListaDate(lista);
                    const finalizada = lista.status === 'finalizada';

                    return (
                      <div
                        key={lista.id}
                        className={`grid gap-4 px-4 py-4 transition hover:bg-gray-50 sm:px-5 lg:grid-cols-[minmax(260px,1.5fr)_minmax(330px,1.2fr)_auto] lg:items-center ${index > 0 ? 'border-t border-gray-100' : ''}`}
                      >
                        <button type="button" onClick={() => abrirLista(lista.id)} className="min-w-0 text-left">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="truncate text-sm font-bold text-gray-900 sm:text-[15px]">{lista.nome}</span>
                            <span className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${finalizada ? 'bg-emerald-50 text-emerald-700' : 'bg-blue-50 text-blue-700'}`}>
                              {finalizada ? 'Finalizada' : 'Em andamento'}
                            </span>
                          </div>
                          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                            <span>{formatDate(date)}</span>
                            <span className="font-medium text-gray-600">{shortCycle(lista.saidaPadrao)}</span>
                            <span>{lista.tipo === 'grupos' ? 'Por grupos' : 'Comum'}</span>
                          </div>
                        </button>

                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Pacotes</p>
                            <p className="mt-0.5 text-sm font-bold tabular-nums text-[#3483FA]">{total.toLocaleString('pt-BR')}</p>
                          </div>
                          <div>
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Responsável</p>
                            <p className="mt-0.5 truncate text-sm font-semibold text-gray-700">{lista.responsavel || '-'}</p>
                          </div>
                          <div className="hidden sm:block">
                            <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">Tipo</p>
                            <p className="mt-0.5 text-sm font-semibold text-gray-700">{lista.tipo === 'grupos' ? 'Grupos' : 'Comum'}</p>
                          </div>
                        </div>

                        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                          <button
                            type="button"
                            onClick={() => abrirLista(lista.id)}
                            disabled={openingId === lista.id}
                            className="inline-flex min-h-[38px] items-center gap-1.5 rounded-lg bg-[#3483FA] px-3.5 py-2 text-xs font-bold text-white transition hover:bg-blue-600 disabled:opacity-60"
                          >
                            <Barcode className="h-4 w-4" />
                            {openingId === lista.id ? 'Abrindo...' : 'Abrir'}
                            <ChevronRight className="h-3.5 w-3.5" />
                          </button>

                          <button
                            type="button"
                            onClick={() => exportarLista(lista)}
                            className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-gray-200 text-gray-500 transition hover:bg-gray-100 hover:text-gray-800"
                            title="Exportar IDs"
                          >
                            <Download className="h-4 w-4" />
                          </button>

                          {finalizada && (
                            <button
                              type="button"
                              onClick={() => reabrirLista(lista)}
                              className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-amber-200 text-amber-600 transition hover:bg-amber-50"
                              title="Reabrir lista"
                            >
                              <RotateCcw className="h-4 w-4" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => excluirLista(lista)}
                            className="flex h-[38px] w-[38px] items-center justify-center rounded-lg border border-red-100 text-red-500 transition hover:bg-red-50"
                            title="Excluir lista"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        )}
      </section>

      {showCreate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <div>
                <h3 className="text-base font-bold text-gray-900">Nova lista</h3>
                <p className="mt-0.5 text-xs text-gray-400">Defina a data, o ciclo e o tipo.</p>
              </div>
              <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100">
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={criarLista} className="space-y-4 p-5">
              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                  <CalendarDays className="h-3.5 w-3.5 text-[#3483FA]" />
                  Data
                </span>
                <input
                  type="date"
                  value={novaData}
                  onChange={event => setNovaData(event.target.value)}
                  required
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm outline-none focus:border-[#3483FA] focus:bg-white"
                />
              </label>

              <label className="block space-y-1.5">
                <span className="flex items-center gap-1.5 text-xs font-bold text-gray-700">
                  <Layers className="h-3.5 w-3.5 text-amber-600" />
                  Ciclo
                </span>
                <select
                  value={novaSaida}
                  onChange={event => setNovaSaida(event.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm font-semibold outline-none focus:border-[#3483FA] focus:bg-white"
                >
                  {CICLOS.map(ciclo => <option key={ciclo}>{ciclo}</option>)}
                </select>
              </label>

              <div>
                <p className="mb-2 text-xs font-bold text-gray-700">Tipo</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setNovoTipo('comum')}
                    className={`rounded-xl border p-3 text-left transition ${novoTipo === 'comum' ? 'border-[#3483FA] bg-blue-50 text-blue-700' : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    <Package className="h-4 w-4" />
                    <span className="mt-2 block text-xs font-bold">Comum</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setNovoTipo('grupos')}
                    className={`rounded-xl border p-3 text-left transition ${novoTipo === 'grupos' ? 'border-violet-400 bg-violet-50 text-violet-700' : 'border-gray-200 bg-white text-gray-600'}`}
                  >
                    <UserIcon className="h-4 w-4" />
                    <span className="mt-2 block text-xs font-bold">Por grupos</span>
                  </button>
                </div>
              </div>

              <div className="flex justify-end gap-2 border-t border-gray-100 pt-4">
                <button type="button" onClick={() => setShowCreate(false)} className="rounded-lg px-4 py-2 text-xs font-bold text-gray-500 hover:bg-gray-100">
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={creating}
                  className="rounded-lg bg-[#3483FA] px-4 py-2 text-xs font-bold text-white hover:bg-blue-600 disabled:opacity-60"
                >
                  {creating ? 'Criando...' : 'Criar lista'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
