import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  QrCode,
  Plus,
  Search,
  ExternalLink,
  Copy,
  Check,
  Download,
  Printer,
  RefreshCw,
  Trash2,
  Pause,
  Play,
  ArrowUpRight,
  Sparkles,
  Link2,
  Calendar,
  Activity,
  Tag,
  Eye,
  Edit3,
  X,
  AlertCircle,
  HelpCircle,
} from 'lucide-react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  DynamicQr,
  listenToDynamicQrs,
  createDynamicQr,
  updateDynamicQrTarget,
  toggleDynamicQrStatus,
  deleteDynamicQr,
  getPermanentQrUrl,
  normalizeUrl,
} from '../lib/dynamicQr';
import type { User } from '../lib/auth';

interface DynamicQRsProps {
  currentUser?: User | null;
}

const CATEGORIES = [
  'Operação',
  'Auditoria',
  'Refugo',
  'Docas',
  'Comunicação',
  'RH',
  'Geral',
];

export const DynamicQRs: React.FC<DynamicQRsProps> = ({ currentUser }) => {
  const [qrs, setQrs] = useState<DynamicQr[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'paused'>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Modais
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingQr, setEditingQr] = useState<DynamicQr | null>(null);
  const [changingTargetQr, setChangingTargetQr] = useState<DynamicQr | null>(null);
  const [viewingQr, setViewingQr] = useState<DynamicQr | null>(null);

  // Form states
  const [formTitle, setFormTitle] = useState('');
  const [formTargetUrl, setFormTargetUrl] = useState('');
  const [formCustomCode, setFormCustomCode] = useState('');
  const [formCategory, setFormCategory] = useState('Operação');
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Troca de link rápido
  const [newTargetInput, setNewTargetInput] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);

  // Notificações
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

  // Canvas ref para exportação de PNG em alta resolução
  const hiddenCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const unsubscribe = listenToDynamicQrs(
      items => {
        setQrs(items);
        setLoading(false);
      },
      err => {
        console.warn('Erro ao carregar QRs:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  const handleCopyLink = (code: string, id: string) => {
    const url = getPermanentQrUrl(code);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      showToast('Link permanente copiado para a área de transferência!');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      showToast('Link: ' + url);
    });
  };

  // Abrir modal de criação
  const openCreateModal = () => {
    setFormTitle('');
    setFormTargetUrl('');
    setFormCustomCode('');
    setFormCategory('Operação');
    setFormDescription('');
    setFormError(null);
    setIsCreateOpen(true);
  };

  // Salvar novo QR Code
  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Por favor, informe um título ou identificação.');
      return;
    }
    if (!formTargetUrl.trim()) {
      setFormError('Informe a URL ou link de destino.');
      return;
    }

    try {
      setSaving(true);
      setFormError(null);
      await createDynamicQr({
        title: formTitle,
        targetUrl: formTargetUrl,
        category: formCategory,
        description: formDescription,
        customCode: formCustomCode,
        createdBy: currentUser?.username || 'Operador',
      });

      setIsCreateOpen(false);
      showToast('QR Code Dinâmico criado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao criar QR:', err);
      setFormError(err.message || 'Falha ao criar QR Code.');
    } finally {
      setSaving(false);
    }
  };

  // Abrir modal de troca rápida de link
  const openChangeTargetModal = (item: DynamicQr) => {
    setChangingTargetQr(item);
    setNewTargetInput(item.targetUrl);
    setTargetError(null);
  };

  const handleSaveNewTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingTargetQr) return;
    if (!newTargetInput.trim()) {
      setTargetError('Informe o novo link de destino.');
      return;
    }

    try {
      setSaving(true);
      setTargetError(null);
      await updateDynamicQrTarget(changingTargetQr.id, newTargetInput);
      setChangingTargetQr(null);
      showToast(`Link de destino atualizado! O QR Code permanece idêntico.`);
    } catch (err: any) {
      setTargetError(err.message || 'Falha ao atualizar link.');
    } finally {
      setSaving(false);
    }
  };

  // Alternar status
  const handleToggleStatus = async (item: DynamicQr) => {
    try {
      await toggleDynamicQrStatus(item.id, item.status);
      showToast(item.status === 'active' ? 'QR Code pausado.' : 'QR Code ativado!');
    } catch (err: any) {
      showToast('Erro ao alternar status do QR.');
    }
  };

  // Excluir QR
  const handleDelete = async (item: DynamicQr) => {
    const confirm = window.confirm(
      `Tem certeza que deseja excluir o QR "${item.title}"? O link permanente deixará de funcionar imediatamente.`
    );
    if (!confirm) return;

    try {
      await deleteDynamicQr(item.id);
      showToast('QR Code excluído com sucesso.');
    } catch (err: any) {
      showToast('Erro ao excluir QR.');
    }
  };

  // Download do QR em PNG
  const downloadQrPng = (item: DynamicQr) => {
    const canvas = document.getElementById(`qr-canvas-${item.code}`) as HTMLCanvasElement;
    if (!canvas) {
      showToast('Preparando imagem...');
      return;
    }
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode-${item.code}-${item.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase()}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download do PNG iniciado!');
  };

  // Download do QR em SVG
  const downloadQrSvg = (item: DynamicQr) => {
    const svg = document.getElementById(`qr-svg-${item.code}`) as unknown as SVGSVGElement;
    if (!svg) return;
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(svgBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `qrcode-${item.code}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('Download do SVG iniciado!');
  };

  // Imprimir etiqueta
  const handlePrintLabel = (item: DynamicQr) => {
    const permanentUrl = getPermanentQrUrl(item.code);
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Por favor, permita pop-ups para imprimir a etiqueta.');
      return;
    }

    const svgElement = document.getElementById(`qr-svg-${item.code}`);
    const svgHtml = svgElement ? svgElement.outerHTML : '';

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta QR - ${item.title}</title>
          <style>
            @page { size: auto; margin: 10mm; }
            body {
              font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              margin: 0;
              background: #fff;
              color: #000;
            }
            .card {
              border: 3px solid #000;
              border-radius: 16px;
              padding: 24px;
              width: 320px;
              text-align: center;
              page-break-inside: avoid;
            }
            .badge {
              display: inline-block;
              background: #f1f5f9;
              border: 1px solid #cbd5e1;
              padding: 4px 10px;
              font-size: 11px;
              font-weight: 800;
              text-transform: uppercase;
              letter-spacing: 0.05em;
              border-radius: 999px;
              margin-bottom: 12px;
            }
            h1 {
              font-size: 20px;
              font-weight: 900;
              margin: 0 0 6px 0;
              line-height: 1.2;
            }
            p.desc {
              font-size: 12px;
              color: #475569;
              margin: 0 0 16px 0;
            }
            .qr-box {
              display: flex;
              justify-content: center;
              margin: 14px 0;
            }
            .short-link {
              font-family: monospace;
              font-size: 13px;
              font-weight: 700;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              padding: 6px 10px;
              border-radius: 6px;
              word-break: break-all;
            }
            .footer {
              margin-top: 14px;
              font-size: 10px;
              color: #64748b;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.05em;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <span class="badge">${item.category || 'Geral'}</span>
            <h1>${item.title}</h1>
            ${item.description ? `<p class="desc">${item.description}</p>` : ''}
            <div class="qr-box">
              ${svgHtml}
            </div>
            <div class="short-link">${permanentUrl}</div>
            <div class="footer">QR Code Dinâmico &bull; ecooy</div>
          </div>
          <script>
            window.onload = function() {
              window.print();
            }
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  // Filtragem e busca
  const filteredQrs = useMemo(() => {
    return qrs.filter(item => {
      // Status
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      // Categoria
      if (selectedCategory !== 'todos' && item.category !== selectedCategory) return false;
      // Busca
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchUrl = item.targetUrl.toLowerCase().includes(q);
        const matchCode = item.code.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchUrl && !matchCode && !matchDesc) return false;
      }
      return true;
    });
  }, [qrs, search, selectedCategory, statusFilter]);

  // Estatísticas do topo
  const stats = useMemo(() => {
    const total = qrs.length;
    const active = qrs.filter(q => q.status === 'active').length;
    const totalScans = qrs.reduce((acc, q) => acc + (q.scansCount || 0), 0);
    const mostScanned = [...qrs].sort((a, b) => (b.scansCount || 0) - (a.scansCount || 0))[0];
    return { total, active, totalScans, mostScanned };
  }, [qrs]);

  return (
    <div className="space-y-6">
      {/* Toast flutuante */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white shadow-2xl border border-slate-700 animate-in fade-in slide-in-from-bottom-4">
          <Sparkles className="h-4 w-4 text-[#FFE600]" />
          <span>{toast}</span>
        </div>
      )}

      {/* Header do Módulo */}
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
            <span>Módulos</span>
            <span>&bull;</span>
            <span className="text-[#1769ff]">QRs Dinâmicos</span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            Gerenciador de QR Codes Dinâmicos
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            Gere códigos QR permanentes. Altere o link de destino a qualquer momento sem trocar ou reimprimir a etiqueta física!
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#FFE600] px-5 py-3 text-sm font-black text-slate-950 shadow-sm transition hover:bg-yellow-400 active:scale-[0.98]"
        >
          <Plus className="h-5 w-5 stroke-[2.5]" />
          <span>Novo QR Dinâmico</span>
        </button>
      </div>

      {/* Banner Explicativo - Conceito do QR Dinâmico */}
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 via-indigo-50/70 to-blue-50/90 p-4 sm:p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3.5">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#1769ff] text-white shadow-sm">
            <RefreshCw className="h-5 w-5" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-extrabold text-slate-900">
              Como funciona o QR Code 100% Dinâmico?
            </h2>
            <p className="mt-0.5 text-xs text-slate-600 leading-relaxed">
              O QR Code gerado contém um link fixo do sistema (ex: <code className="font-mono bg-white/80 px-1 py-0.5 rounded border border-blue-100 text-[#1769ff]">/qr/rotas-01</code>). Quando você clica em <strong>"Trocar Link"</strong> e salva uma nova planilha ou URL, <strong>o código QR continua exatamente o mesmo</strong> e qualquer pessoa que ler o QR físico será redirecionada imediatamente para o novo destino.
            </p>
          </div>
        </div>
      </div>

      {/* KPIs / Cards de Resumo */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Total de QRs</span>
            <QrCode className="h-4 w-4 text-slate-400" />
          </div>
          <div className="mt-2 text-2xl font-black text-slate-900">{stats.total}</div>
          <div className="mt-1 text-[11px] text-slate-500">Cadastrados no sistema</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Ativos</span>
            <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </div>
          <div className="mt-2 text-2xl font-black text-emerald-600">{stats.active}</div>
          <div className="mt-1 text-[11px] text-slate-500">Redirecionando normalmente</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Acessos / Scans</span>
            <Activity className="h-4 w-4 text-[#1769ff]" />
          </div>
          <div className="mt-2 text-2xl font-black text-[#1769ff]">{stats.totalScans.toLocaleString('pt-BR')}</div>
          <div className="mt-1 text-[11px] text-slate-500">Leituras registradas</div>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Mais Acessado</span>
            <ArrowUpRight className="h-4 w-4 text-amber-500" />
          </div>
          <div className="mt-2 truncate text-base font-extrabold text-slate-900" title={stats.mostScanned?.title || '-'}>
            {stats.mostScanned?.title || 'Nenhum'}
          </div>
          <div className="mt-1 text-[11px] text-slate-500">
            {stats.mostScanned ? `${stats.mostScanned.scansCount} leituras` : 'Sem dados'}
          </div>
        </div>
      </div>

      {/* Barra de Filtros e Busca */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, destino ou código curto..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-xs sm:text-sm text-slate-800 outline-none transition focus:border-[#3483FA] focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Categoria */}
          <select
            value={selectedCategory}
            onChange={e => setSelectedCategory(e.target.value)}
            className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-700 outline-none hover:bg-slate-100 focus:border-[#3483FA]"
          >
            <option value="todos">Todas as Categorias</option>
            {CATEGORIES.map(c => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>

          {/* Status */}
          <div className="inline-flex h-10 rounded-xl border border-slate-200 bg-slate-50 p-1">
            <button
              type="button"
              onClick={() => setStatusFilter('all')}
              className={`rounded-lg px-2.5 text-xs font-bold transition ${statusFilter === 'all' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Todos
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('active')}
              className={`rounded-lg px-2.5 text-xs font-bold transition ${statusFilter === 'active' ? 'bg-emerald-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Ativos
            </button>
            <button
              type="button"
              onClick={() => setStatusFilter('paused')}
              className={`rounded-lg px-2.5 text-xs font-bold transition ${statusFilter === 'paused' ? 'bg-amber-500 text-white shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              Pausados
            </button>
          </div>
        </div>
      </div>

      {/* Lista / Grid de QR Codes */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-[#1769ff]" />
          <p className="mt-3 text-sm font-bold text-slate-700">Carregando QR Codes...</p>
        </div>
      ) : filteredQrs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 mb-4 border border-amber-200">
            <QrCode className="h-8 w-8" />
          </div>
          <h3 className="text-base font-black text-slate-900">Nenhum QR Code encontrado</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            {search || selectedCategory !== 'todos' || statusFilter !== 'all'
              ? 'Tente ajustar os filtros ou a busca acima.'
              : 'Comece criando o primeiro QR Code dinâmico para tabelas, rotas ou avisos do galpão.'}
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#FFE600] px-4 py-2.5 text-xs font-black text-slate-950 transition hover:bg-yellow-400"
          >
            <Plus className="h-4 w-4" />
            <span>Criar Primeiro QR Code</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredQrs.map(item => {
            const permanentUrl = getPermanentQrUrl(item.code);
            const isCopied = copiedId === item.id;
            const isPaused = item.status === 'paused';

            return (
              <div
                key={item.id}
                className={`relative flex flex-col justify-between rounded-2xl border bg-white p-5 shadow-sm transition hover:shadow-md ${
                  isPaused ? 'border-amber-200 bg-amber-50/20' : 'border-slate-200'
                }`}
              >
                {/* Header do Card */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                          {item.category || 'Geral'}
                        </span>
                        {isPaused ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            <Pause className="h-2.5 w-2.5 fill-current" />
                            Pausado
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            Ativo
                          </span>
                        )}
                      </div>
                      <h3 className="truncate text-base font-black text-slate-900" title={item.title}>
                        {item.title}
                      </h3>
                      {item.description && (
                        <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{item.description}</p>
                      )}
                    </div>

                    {/* QR Code Thumbnail Preview (clicável para expandir) */}
                    <button
                      type="button"
                      onClick={() => setViewingQr(item)}
                      className="group relative shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition hover:border-[#1769ff] hover:scale-105"
                      title="Clique para ampliar o QR Code"
                    >
                      <QRCodeSVG
                        id={`qr-svg-${item.code}`}
                        value={permanentUrl}
                        size={72}
                        level="M"
                        includeMargin={false}
                      />
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/40 opacity-0 transition group-hover:opacity-100">
                        <Eye className="h-4 w-4 text-white" />
                      </div>
                    </button>
                  </div>

                  {/* Canvas oculto para download PNG */}
                  <div className="hidden">
                    <QRCodeCanvas
                      id={`qr-canvas-${item.code}`}
                      value={permanentUrl}
                      size={1024}
                      level="H"
                      includeMargin={true}
                    />
                  </div>

                  {/* Informações de Link */}
                  <div className="mt-4 space-y-2">
                    {/* Link de destino atual */}
                    <div className="rounded-xl border border-slate-200/90 bg-slate-50 p-2.5">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        <span className="flex items-center gap-1">
                          <ExternalLink className="h-3 w-3" />
                          Destino Atual
                        </span>
                        <a
                          href={item.targetUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#1769ff] hover:underline"
                        >
                          Testar link
                        </a>
                      </div>
                      <p className="truncate font-mono text-xs text-slate-800 font-semibold" title={item.targetUrl}>
                        {item.targetUrl}
                      </p>
                    </div>

                    {/* Link fixo do QR */}
                    <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-blue-900">
                        <span className="text-slate-400">QR: </span>
                        {permanentUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyLink(item.code, item.id)}
                        className="ml-2 inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-sm border border-slate-200 hover:bg-slate-50"
                        title="Copiar link permanente"
                      >
                        {isCopied ? (
                          <>
                            <Check className="h-3 w-3 text-emerald-600" />
                            <span className="text-emerald-700">Copiado</span>
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            <span>Copiar</span>
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* Métricas do QR */}
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1 font-bold text-slate-700">
                      <Activity className="h-3.5 w-3.5 text-[#1769ff]" />
                      {item.scansCount || 0} acessos
                    </span>
                    <span>
                      {item.lastScannedAt
                        ? `Último: ${new Date(item.lastScannedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : 'Nunca escaneado'}
                    </span>
                  </div>
                </div>

                {/* Ações do Card */}
                <div className="mt-4 border-t border-slate-100 pt-3 flex flex-wrap items-center justify-between gap-1.5">
                  {/* Botão principal de troca de link */}
                  <button
                    type="button"
                    onClick={() => openChangeTargetModal(item)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1769ff] px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98]"
                    title="Altera a URL de destino mantendo o QR impresso intacto"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Trocar Link</span>
                  </button>

                  {/* Visualizar / Baixar */}
                  <button
                    type="button"
                    onClick={() => setViewingQr(item)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                    title="Visualizar e baixar QR Code"
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden sm:inline">Baixar</span>
                  </button>

                  {/* Imprimir Etiqueta */}
                  <button
                    type="button"
                    onClick={() => handlePrintLabel(item)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50"
                    title="Imprimir etiqueta para colar no galpão"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>

                  {/* Pausar / Ativar */}
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(item)}
                    className={`inline-flex items-center rounded-xl border px-2.5 py-2 text-xs font-bold transition ${
                      isPaused
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100'
                    }`}
                    title={isPaused ? 'Ativar redirecionamento' : 'Pausar redirecionamento'}
                  >
                    {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5 fill-current" />}
                  </button>

                  {/* Excluir */}
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 hover:border-red-200"
                    title="Excluir QR Code"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 1: CRIAR NOVO QR DINÂMICO                             */}
      {/* ============================================================ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFE600] text-slate-950 font-black shadow-sm">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Novo QR Code Dinâmico</h2>
                <p className="text-xs text-slate-500">Crie o código uma vez e atualize o destino quantas vezes precisar</p>
              </div>
            </div>

            <form onSubmit={handleSaveNew} className="mt-5 space-y-4">
              {formError && (
                <div className="flex items-center gap-2 rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  Título / Identificação do QR *
                </label>
                <input
                  type="text"
                  required
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  placeholder="Ex: Tabela de Rotas Manhã, Grupo Docas, Auditoria..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  Link de Destino Atual (URL) *
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={formTargetUrl}
                    onChange={e => setFormTargetUrl(e.target.value)}
                    placeholder="https://docs.google.com/spreadsheets/d/... ou https://..."
                    className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-blue-100"
                  />
                </div>
                <p className="mt-1 text-[11px] text-slate-500">
                  Você poderá trocar este link a qualquer momento sem que o QR impresso mude.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={formCategory}
                    onChange={e => setFormCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-xs sm:text-sm text-slate-800 outline-none focus:border-[#3483FA]"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    Código Curto / Slug (Opcional)
                  </label>
                  <input
                    type="text"
                    value={formCustomCode}
                    onChange={e => setFormCustomCode(e.target.value)}
                    placeholder="Ex: rotas-01 (automático se vazio)"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none focus:border-[#3483FA]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  Observações / Descrição (Opcional)
                </label>
                <textarea
                  rows={2}
                  value={formDescription}
                  onChange={e => setFormDescription(e.target.value)}
                  placeholder="Informações adicionais para a equipe..."
                  className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs sm:text-sm text-slate-900 outline-none focus:border-[#3483FA]"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setIsCreateOpen(false)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#FFE600] px-5 py-2.5 text-xs font-black text-slate-950 transition hover:bg-yellow-400 disabled:opacity-50 shadow-sm"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      <span>Criar QR Code</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: TROCA RÁPIDA DE LINK (O CORAÇÃO DO QR DINÂMICO)     */}
      {/* ============================================================ */}
      {changingTargetQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setChangingTargetQr(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1769ff] text-white shadow-sm">
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Alterar Link de Destino</h2>
                <p className="text-xs text-slate-500">
                  {changingTargetQr.title} &bull; Código: <code className="font-mono">{changingTargetQr.code}</code>
                </p>
              </div>
            </div>

            {/* Aviso de permanência do QR */}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900">
              <div className="font-extrabold flex items-center gap-1.5 mb-1">
                <Check className="h-4 w-4 text-emerald-600" />
                O QR Code físico permanecerá 100% idêntico!
              </div>
              <p className="text-[11px] leading-relaxed text-emerald-800">
                Qualquer placa, folha impressa ou adesivo já colado continuará funcionando normalmente e redirecionará instantaneamente para a nova URL abaixo.
              </p>
            </div>

            <form onSubmit={handleSaveNewTarget} className="mt-4 space-y-4">
              {targetError && (
                <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
                  {targetError}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Destino Antigo (Atual)
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 truncate">
                  {changingTargetQr.targetUrl}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-800 mb-1">
                  Novo Link de Destino *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newTargetInput}
                  onChange={e => setNewTargetInput(e.target.value)}
                  placeholder="Cole aqui a nova URL (Google Docs, Planilha, Grupo WhatsApp...)"
                  className="w-full rounded-xl border-2 border-[#1769ff] px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none shadow-sm"
                />
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setChangingTargetQr(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Atualizando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Salvar e Atualizar Destino</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 3: VISUALIZAR, TESTAR E EXPORTAR QR CODE              */}
      {/* ============================================================ */}
      {viewingQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-center">
            <button
              type="button"
              onClick={() => setViewingQr(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>

            <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-3 py-1 text-[10px] font-extrabold uppercase tracking-wide text-slate-600 mb-2">
              {viewingQr.category || 'Geral'}
            </span>
            <h2 className="text-xl font-black text-slate-900">{viewingQr.title}</h2>
            {viewingQr.description && (
              <p className="mt-1 text-xs text-slate-500">{viewingQr.description}</p>
            )}

            {/* Imagem do QR em tamanho grande */}
            <div className="my-6 flex justify-center">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-inner">
                <QRCodeSVG
                  value={getPermanentQrUrl(viewingQr.code)}
                  size={200}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>

            {/* Link permanente */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-1">
                Link Permanente do QR
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-blue-950 font-bold">
                  {getPermanentQrUrl(viewingQr.code)}
                </span>
                <button
                  type="button"
                  onClick={() => handleCopyLink(viewingQr.code, viewingQr.id)}
                  className="rounded-lg bg-white border border-blue-200 p-1.5 text-blue-700 hover:bg-blue-50 shadow-sm"
                  title="Copiar link"
                >
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>

            {/* Destino atual */}
            <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Destino Atual
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-slate-800" title={viewingQr.targetUrl}>
                  {viewingQr.targetUrl}
                </span>
                <a
                  href={getPermanentQrUrl(viewingQr.code)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-bold text-[#1769ff] hover:underline"
                >
                  Testar
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>

            {/* Botões de Ação de Exportação */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => downloadQrPng(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                <Download className="h-4 w-4 mb-1 text-[#1769ff]" />
                <span>Baixar PNG</span>
              </button>

              <button
                type="button"
                onClick={() => downloadQrSvg(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                <Download className="h-4 w-4 mb-1 text-emerald-600" />
                <span>Baixar SVG</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintLabel(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300"
              >
                <Printer className="h-4 w-4 mb-1 text-slate-700" />
                <span>Imprimir</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
