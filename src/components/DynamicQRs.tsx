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
  Share2,
  Sliders,
  CheckCircle2,
} from 'lucide-react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  DynamicQr,
  listenToDynamicQrs,
  createDynamicQr,
  updateDynamicQrTarget,
  deleteDynamicQr,
  normalizeUrl,
  getDirectQrUrl,
} from '../lib/dynamicQr';
import type { User } from '../lib/auth';

interface DynamicQRsProps {
  currentUser?: User | null;
}

const CATEGORIES = [
  'Operação',
  'Rotas & Despacho',
  'Auditoria',
  'Refugo',
  'Docas',
  'WhatsApp & Grupos',
  'Planilhas',
  'Geral',
];

export const DynamicQRs: React.FC<DynamicQRsProps> = ({ currentUser }) => {
  const [qrs, setQrs] = useState<DynamicQr[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('todos');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Gerador Rápido no topo (Live Quick Generator)
  const [quickUrl, setQuickUrl] = useState('https://docs.google.com/spreadsheets/');
  const [quickTitle, setQuickTitle] = useState('Planilha Operacional');
  const [quickCategory, setQuickCategory] = useState('Operação');
  const [quickSaved, setQuickSaved] = useState(false);
  const [quickSaving, setQuickSaving] = useState(false);

  // Modais
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [changingTargetQr, setChangingTargetQr] = useState<DynamicQr | null>(null);
  const [viewingQr, setViewingQr] = useState<DynamicQr | null>(null);

  // Formulário de Criação Completo
  const [formTitle, setFormTitle] = useState('');
  const [formTargetUrl, setFormTargetUrl] = useState('');
  const [formCategory, setFormCategory] = useState('Operação');
  const [formDescription, setFormDescription] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Modal de Troca de Link Direto
  const [newTargetInput, setNewTargetInput] = useState('');
  const [targetError, setTargetError] = useState<string | null>(null);

  // Notificações / Toast
  const [toast, setToast] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  };

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

  // Copiar link direto para o clipboard
  const handleCopyDirectLink = (url: string, id: string) => {
    const directUrl = normalizeUrl(url);
    navigator.clipboard.writeText(directUrl).then(() => {
      setCopiedId(id);
      showToast('Link direto copiado com sucesso!');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      showToast('Link: ' + directUrl);
    });
  };

  // Abrir modal de criação
  const openCreateModal = () => {
    setFormTitle('');
    setFormTargetUrl('');
    setFormCategory('Operação');
    setFormDescription('');
    setFormError(null);
    setIsCreateOpen(true);
  };

  // Salvar novo QR direto no catálogo
  const handleSaveNew = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formTitle.trim()) {
      setFormError('Por favor, informe um título ou identificação.');
      return;
    }
    if (!formTargetUrl.trim()) {
      setFormError('Informe a URL ou link direto.');
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
        createdBy: currentUser?.username || 'Operador',
      });

      setIsCreateOpen(false);
      showToast('QR Code Direto salvo com sucesso!');
    } catch (err: any) {
      console.error('Erro ao criar QR:', err);
      setFormError(err.message || 'Falha ao salvar QR Code.');
    } finally {
      setSaving(false);
    }
  };

  // Salvar do Gerador Rápido no catálogo
  const handleSaveQuick = async () => {
    if (!quickUrl.trim()) {
      showToast('Digite uma URL antes de salvar.');
      return;
    }
    try {
      setQuickSaving(true);
      await createDynamicQr({
        title: quickTitle.trim() || 'QR Direto',
        targetUrl: quickUrl.trim(),
        category: quickCategory,
        description: 'Gerado via gerador direto rápido',
        createdBy: currentUser?.username || 'Operador',
      });
      setQuickSaved(true);
      showToast('QR Code salvo no seu catálogo!');
      setTimeout(() => setQuickSaved(false), 3000);
    } catch (err: any) {
      showToast('Erro ao salvar QR: ' + err.message);
    } finally {
      setQuickSaving(false);
    }
  };

  // Abrir modal de troca de link
  const openChangeTargetModal = (item: DynamicQr) => {
    setChangingTargetQr(item);
    setNewTargetInput(item.targetUrl);
    setTargetError(null);
  };

  // Salvar novo link no QR Code
  const handleSaveNewTarget = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!changingTargetQr) return;
    if (!newTargetInput.trim()) {
      setTargetError('Informe o novo link direto.');
      return;
    }

    try {
      setSaving(true);
      setTargetError(null);
      await updateDynamicQrTarget(changingTargetQr.id, newTargetInput);
      setChangingTargetQr(null);
      showToast(`Link atualizado com sucesso! O QR Code foi atualizado para o novo destino direto.`);
    } catch (err: any) {
      setTargetError(err.message || 'Falha ao atualizar link.');
    } finally {
      setSaving(false);
    }
  };

  // Excluir QR
  const handleDelete = async (item: DynamicQr) => {
    const confirm = window.confirm(
      `Tem certeza que deseja excluir o QR "${item.title}"?`
    );
    if (!confirm) return;

    try {
      await deleteDynamicQr(item.id);
      showToast('QR Code removido do catálogo.');
    } catch (err: any) {
      showToast('Erro ao excluir QR.');
    }
  };

  // Download do QR em PNG Alta Resolução
  const downloadQrPng = (url: string, filenameTitle: string, elementId?: string) => {
    let canvas: HTMLCanvasElement | null = null;
    if (elementId) {
      canvas = document.getElementById(elementId) as HTMLCanvasElement;
    }
    if (!canvas) {
      // Cria canvas temporário se necessário
      canvas = document.createElement('canvas');
      canvas.width = 1024;
      canvas.height = 1024;
    }

    const dataUrl = canvas.toDataURL('image/png');
    const safeName = filenameTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qrcode-direto-${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download do PNG (1024px) concluído!');
  };

  // Download do QR em SVG
  const downloadQrSvg = (elementId: string, filenameTitle: string) => {
    const svg = document.getElementById(elementId) as unknown as SVGSVGElement;
    if (!svg) {
      showToast('Erro ao capturar imagem SVG.');
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);
    const safeName = filenameTitle.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `qrcode-direto-${safeName}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToast('Download do SVG vetorial concluído!');
  };

  // Imprimir Etiqueta Direta
  const handlePrintLabel = (title: string, category: string, directUrl: string, svgElementId: string, description?: string) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Por favor, permita pop-ups para imprimir a etiqueta.');
      return;
    }

    const svgElement = document.getElementById(svgElementId);
    const svgHtml = svgElement ? svgElement.outerHTML : '';
    const normalized = normalizeUrl(directUrl);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta QR Direto - ${title}</title>
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
            .qr-box svg {
              width: 180px;
              height: 180px;
            }
            .direct-link {
              font-family: monospace;
              font-size: 11px;
              font-weight: 700;
              background: #f8fafc;
              border: 1px solid #e2e8f0;
              padding: 6px 10px;
              border-radius: 6px;
              word-break: break-all;
              color: #0f172a;
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
            <span class="badge">${category || 'Geral'}</span>
            <h1>${title}</h1>
            ${description ? `<p class="desc">${description}</p>` : ''}
            <div class="qr-box">
              ${svgHtml}
            </div>
            <div class="direct-link">${normalized}</div>
            <div class="footer">QR Code Direto &bull; Sem Ponte</div>
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
      if (selectedCategory !== 'todos' && item.category !== selectedCategory) return false;
      if (search.trim()) {
        const q = search.trim().toLowerCase();
        const matchTitle = item.title.toLowerCase().includes(q);
        const matchUrl = item.targetUrl.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchUrl && !matchDesc) return false;
      }
      return true;
    });
  }, [qrs, search, selectedCategory]);

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
            <span className="text-[#1769ff]">QR Codes Diretos</span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            Gerador de QR Codes Diretos
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            Gere códigos QR 100% diretos: sem encurtador e sem ponte. Ao escanear, o link de destino abre direto no celular!
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#FFE600] px-5 py-3 text-sm font-black text-slate-950 shadow-sm transition hover:bg-yellow-400 active:scale-[0.98] cursor-pointer"
        >
          <Plus className="h-5 w-5 stroke-[2.5]" />
          <span>Novo QR no Catálogo</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* GERADOR RÁPIDO AO VIVO (DIRETO E SEM PONTE)                   */}
      {/* ============================================================ */}
      <div className="overflow-hidden rounded-2xl border-2 border-blue-200 bg-white shadow-sm">
        <div className="border-b border-blue-100 bg-gradient-to-r from-blue-50/80 via-white to-blue-50/80 px-5 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#1769ff] text-white">
              <QrCode className="h-4 w-4" />
            </span>
            <div>
              <h2 className="text-sm font-black text-slate-900">Gerador Rápido Instantâneo</h2>
              <p className="text-[11px] text-slate-500">Digite ou cole qualquer link e gere o QR Code direto na hora</p>
            </div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[11px] font-bold text-emerald-800">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
            100% Direto (Sem ponte)
          </span>
        </div>

        <div className="p-5">
          <div className="flex flex-col lg:flex-row items-center gap-6">
            {/* Campos de Entrada */}
            <div className="flex-1 w-full space-y-3.5">
              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  Link ou Texto de Destino (Direto) *
                </label>
                <input
                  type="text"
                  value={quickUrl}
                  onChange={e => setQuickUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/... ou wa.me/... ou qualquer link"
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-blue-100 transition shadow-xs"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    Título / Identificação
                  </label>
                  <input
                    type="text"
                    value={quickTitle}
                    onChange={e => setQuickTitle(e.target.value)}
                    placeholder="Ex: Planilha de Rotas Manhã"
                    className="w-full rounded-xl border border-slate-300 px-3 py-2 text-xs text-slate-800 outline-none focus:border-[#3483FA]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                    Categoria
                  </label>
                  <select
                    value={quickCategory}
                    onChange={e => setQuickCategory(e.target.value)}
                    className="w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs text-slate-800 outline-none focus:border-[#3483FA]"
                  >
                    {CATEGORIES.map(c => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Botões Rápidos */}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => downloadQrPng(quickUrl, quickTitle, 'qr-canvas-quick')}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-bold text-white hover:bg-slate-800 transition cursor-pointer shadow-xs"
                >
                  <Download className="h-3.5 w-3.5 text-[#FFE600]" />
                  <span>Baixar PNG (1024px)</span>
                </button>

                <button
                  type="button"
                  onClick={() => downloadQrSvg('qr-svg-quick', quickTitle)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                >
                  <Download className="h-3.5 w-3.5 text-blue-600" />
                  <span>Baixar SVG</span>
                </button>

                <button
                  type="button"
                  onClick={() => handlePrintLabel(quickTitle, quickCategory, quickUrl, 'qr-svg-quick')}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-slate-800 hover:bg-slate-50 transition cursor-pointer shadow-xs"
                >
                  <Printer className="h-3.5 w-3.5 text-slate-600" />
                  <span>Imprimir Etiqueta</span>
                </button>

                <a
                  href={normalizeUrl(quickUrl)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-xs font-bold text-[#1769ff] hover:bg-blue-50 transition shadow-xs"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Testar Link</span>
                </a>

                <button
                  type="button"
                  onClick={handleSaveQuick}
                  disabled={quickSaving || quickSaved}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-[#FFE600] px-3.5 py-2 text-xs font-black text-slate-950 hover:bg-yellow-400 transition cursor-pointer disabled:opacity-50 ml-auto shadow-xs"
                >
                  {quickSaving ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : quickSaved ? (
                    <Check className="h-3.5 w-3.5 text-emerald-800" />
                  ) : (
                    <Plus className="h-3.5 w-3.5" />
                  )}
                  <span>{quickSaved ? 'Salvo no Catálogo!' : 'Salvar no Catálogo'}</span>
                </button>
              </div>
            </div>

            {/* Preview do QR Code Direto */}
            <div className="flex flex-col items-center justify-center p-4 bg-slate-50 rounded-2xl border border-slate-200 shrink-0">
              <div className="bg-white p-3 rounded-xl border border-slate-200 shadow-sm">
                <QRCodeSVG
                  id="qr-svg-quick"
                  value={normalizeUrl(quickUrl) || 'https://ecooy.app'}
                  size={140}
                  level="M"
                  includeMargin={true}
                />
              </div>

              {/* Canvas oculto para download em alta resolução */}
              <div className="hidden">
                <QRCodeCanvas
                  id="qr-canvas-quick"
                  value={normalizeUrl(quickUrl) || 'https://ecooy.app'}
                  size={1024}
                  level="H"
                  includeMargin={true}
                />
              </div>

              <div className="mt-2 text-center max-w-[160px]">
                <div className="text-[11px] font-black text-slate-900 truncate" title={quickTitle}>
                  {quickTitle || 'QR Direto'}
                </div>
                <div className="text-[10px] text-slate-500 font-mono truncate" title={quickUrl}>
                  {quickUrl}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ============================================================ */}
      {/* BARRA DE FILTROS E BUSCA DO CATÁLOGO DE QRS                   */}
      {/* ============================================================ */}
      <div className="flex flex-col gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
        <div className="relative flex-1">
          <Search className="absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por título, destino ou observação..."
            className="h-10 w-full rounded-xl border border-slate-200 bg-slate-50/60 pl-10 pr-4 text-xs sm:text-sm text-slate-800 outline-none transition focus:border-[#3483FA] focus:bg-white focus:ring-2 focus:ring-blue-100"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
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

          <span className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
            {filteredQrs.length} {filteredQrs.length === 1 ? 'QR Salvo' : 'QRs Salvos'}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* GRID DO CATÁLOGO DE QR CODES DIRETOS                         */}
      {/* ============================================================ */}
      {loading ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-14 text-center">
          <RefreshCw className="h-8 w-8 animate-spin text-[#1769ff]" />
          <p className="mt-3 text-sm font-bold text-slate-700">Carregando catálogo de QR Codes...</p>
        </div>
      ) : filteredQrs.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-slate-200 bg-white py-16 px-4 text-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 text-amber-500 mb-4 border border-amber-200">
            <QrCode className="h-8 w-8" />
          </div>
          <h3 className="text-base font-black text-slate-900">Nenhum QR Code no catálogo</h3>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            {search || selectedCategory !== 'todos'
              ? 'Nenhum resultado corresponde aos filtros selecionados.'
              : 'Gere um QR acima ou adicione novos códigos para salvar no catálogo.'}
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#FFE600] px-4 py-2.5 text-xs font-black text-slate-950 transition hover:bg-yellow-400 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Adicionar Novo QR</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredQrs.map(item => {
            const directUrl = normalizeUrl(item.targetUrl);
            const isCopied = copiedId === item.id;
            const canvasId = `qr-canvas-${item.id}`;
            const svgId = `qr-svg-${item.id}`;

            return (
              <div
                key={item.id}
                className="relative flex flex-col justify-between rounded-2xl border border-slate-200 bg-white p-5 shadow-sm transition hover:shadow-md"
              >
                {/* Header do Card */}
                <div>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-1.5 mb-1.5">
                        <span className="inline-block rounded-full border border-slate-200 bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-slate-600">
                          {item.category || 'Geral'}
                        </span>
                        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold text-emerald-700">
                          <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                          Direto
                        </span>
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
                      className="group relative shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition hover:border-[#1769ff] hover:scale-105 cursor-pointer"
                      title="Clique para ampliar o QR Code"
                    >
                      <QRCodeSVG
                        id={svgId}
                        value={directUrl}
                        size={76}
                        level="M"
                        includeMargin={false}
                      />
                      <div className="absolute inset-0 flex items-center justify-center rounded-xl bg-slate-900/40 opacity-0 transition group-hover:opacity-100">
                        <Eye className="h-4 w-4 text-white" />
                      </div>
                    </button>
                  </div>

                  {/* Canvas oculto para download PNG alta resolução */}
                  <div className="hidden">
                    <QRCodeCanvas
                      id={canvasId}
                      value={directUrl}
                      size={1024}
                      level="H"
                      includeMargin={true}
                    />
                  </div>

                  {/* Caixa com o Link Direto */}
                  <div className="mt-4 space-y-2">
                    <div className="rounded-xl border border-slate-200/90 bg-slate-50 p-2.5">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        <span className="flex items-center gap-1">
                          <Link2 className="h-3 w-3 text-slate-600" />
                          Link Direto de Destino
                        </span>
                        <a
                          href={directUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#1769ff] hover:underline font-bold"
                        >
                          Testar
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="truncate font-mono text-xs text-slate-800 font-semibold" title={item.targetUrl}>
                        {item.targetUrl}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Barra de Ações do Card */}
                <div className="mt-4 border-t border-slate-100 pt-3 flex flex-wrap items-center justify-between gap-1.5">
                  {/* Botão de Trocar / Editar Link */}
                  <button
                    type="button"
                    onClick={() => openChangeTargetModal(item)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1769ff] px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98] cursor-pointer"
                    title="Altera a URL direta deste QR Code"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    <span>Trocar Link</span>
                  </button>

                  {/* Copiar Link Direto */}
                  <button
                    type="button"
                    onClick={() => handleCopyDirectLink(item.targetUrl, item.id)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                    title="Copiar link de destino"
                  >
                    {isCopied ? (
                      <Check className="h-3.5 w-3.5 text-emerald-600" />
                    ) : (
                      <Copy className="h-3.5 w-3.5" />
                    )}
                  </button>

                  {/* Baixar PNG */}
                  <button
                    type="button"
                    onClick={() => downloadQrPng(directUrl, item.title, canvasId)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                    title="Baixar imagem PNG"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>

                  {/* Imprimir Etiqueta */}
                  <button
                    type="button"
                    onClick={() => handlePrintLabel(item.title, item.category || 'Geral', item.targetUrl, svgId, item.description)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                    title="Imprimir etiqueta"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>

                  {/* Excluir */}
                  <button
                    type="button"
                    onClick={() => handleDelete(item)}
                    className="inline-flex items-center rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-red-600 transition hover:bg-red-50 hover:border-red-200 cursor-pointer"
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
      {/* MODAL 1: CRIAR NOVO QR CODE DIRETO NO CATÁLOGO               */}
      {/* ============================================================ */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setIsCreateOpen(false)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#FFE600] text-slate-950 font-black shadow-sm">
                <QrCode className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Novo QR Code Direto</h2>
                <p className="text-xs text-slate-500">QR Code com link direto sem ponte ou encurtador</p>
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
                  placeholder="Ex: Tabela de Rotas Manhã, Docas, Grupo WhatsApp..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-blue-100"
                />
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-700 mb-1">
                  Link Direto de Destino (URL) *
                </label>
                <input
                  type="text"
                  required
                  value={formTargetUrl}
                  onChange={e => setFormTargetUrl(e.target.value)}
                  placeholder="https://docs.google.com/spreadsheets/d/... ou https://..."
                  className="w-full rounded-xl border border-slate-300 px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none focus:border-[#3483FA] focus:ring-2 focus:ring-blue-100"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  Ao ler o QR com o celular, a URL abre diretamente sem passar por nenhum intermediário.
                </p>
              </div>

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
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#FFE600] px-5 py-2.5 text-xs font-black text-slate-950 transition hover:bg-yellow-400 disabled:opacity-50 shadow-sm cursor-pointer"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Salvando...</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4" />
                      <span>Salvar no Catálogo</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: TROCA RÁPIDA DE LINK DIRETO                         */}
      {/* ============================================================ */}
      {changingTargetQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl">
            <button
              type="button"
              onClick={() => setChangingTargetQr(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#1769ff] text-white shadow-sm">
                <Edit3 className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Alterar Link do QR Code</h2>
                <p className="text-xs text-slate-500">
                  {changingTargetQr.title}
                </p>
              </div>
            </div>

            <form onSubmit={handleSaveNewTarget} className="mt-4 space-y-4">
              {targetError && (
                <div className="rounded-xl bg-red-50 p-3 text-xs font-semibold text-red-700 border border-red-200">
                  {targetError}
                </div>
              )}

              <div>
                <label className="block text-[11px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                  Link Atual
                </label>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-mono text-slate-600 truncate">
                  {changingTargetQr.targetUrl}
                </div>
              </div>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-slate-800 mb-1">
                  Novo Link Direto *
                </label>
                <input
                  type="text"
                  required
                  autoFocus
                  value={newTargetInput}
                  onChange={e => setNewTargetInput(e.target.value)}
                  placeholder="Cole aqui a nova URL (Google Sheets, Form, Link WhatsApp...)"
                  className="w-full rounded-xl border-2 border-[#1769ff] px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none shadow-sm"
                />
                <p className="mt-1 text-[11px] text-slate-500">
                  O QR Code será atualizado com esta nova URL direta.
                </p>
              </div>

              <div className="mt-6 flex items-center justify-end gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={() => setChangingTargetQr(null)}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="inline-flex items-center gap-2 rounded-xl bg-[#1769ff] px-5 py-2.5 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {saving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      <span>Atualizando...</span>
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" />
                      <span>Salvar Novo Link</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 3: VISUALIZAR, TESTAR E EXPORTAR QR CODE DIRETO        */}
      {/* ============================================================ */}
      {viewingQr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in">
          <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl text-center">
            <button
              type="button"
              onClick={() => setViewingQr(null)}
              className="absolute right-4 top-4 rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
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

            {/* Imagem do QR Direto em tamanho grande */}
            <div className="my-6 flex justify-center">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-inner">
                <QRCodeSVG
                  id={`modal-qr-svg-${viewingQr.id}`}
                  value={normalizeUrl(viewingQr.targetUrl)}
                  size={210}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>

            {/* Link direto */}
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-1">
                Link Direto de Destino (Sem Ponte)
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-slate-900 font-bold" title={viewingQr.targetUrl}>
                  {viewingQr.targetUrl}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyDirectLink(viewingQr.targetUrl, viewingQr.id)}
                    className="rounded-lg bg-white border border-slate-200 p-1.5 text-slate-700 hover:bg-slate-100 shadow-sm cursor-pointer"
                    title="Copiar link"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={normalizeUrl(viewingQr.targetUrl)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-white border border-slate-200 p-1.5 text-[#1769ff] hover:bg-blue-50 shadow-sm"
                    title="Abrir destino diretamente"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Botões de Ação de Exportação */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => downloadQrPng(viewingQr.targetUrl, viewingQr.title, `qr-canvas-${viewingQr.id}`)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
              >
                <Download className="h-4 w-4 mb-1 text-[#1769ff]" />
                <span>Baixar PNG</span>
              </button>

              <button
                type="button"
                onClick={() => downloadQrSvg(`modal-qr-svg-${viewingQr.id}`, viewingQr.title)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
              >
                <Download className="h-4 w-4 mb-1 text-emerald-600" />
                <span>Baixar SVG</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintLabel(viewingQr.title, viewingQr.category || 'Geral', viewingQr.targetUrl, `modal-qr-svg-${viewingQr.id}`, viewingQr.description)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-sm transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
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
