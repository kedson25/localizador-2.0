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
  Server,
  ShieldCheck,
  CheckCircle2,
  Pause,
  Play,
  ArrowRight,
} from 'lucide-react';
import { QRCodeSVG, QRCodeCanvas } from 'qrcode.react';
import {
  DynamicQr,
  listenToDynamicQrs,
  createDynamicQr,
  updateDynamicQrTarget,
  toggleDynamicQrStatus,
  deleteDynamicQr,
  normalizeUrl,
  getPermanentQrUrl,
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

  // Modais
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [changingTargetQr, setChangingTargetQr] = useState<DynamicQr | null>(null);
  const [viewingQr, setViewingQr] = useState<DynamicQr | null>(null);

  // Formulário de Criação Completo
  const [formTitle, setFormTitle] = useState('');
  const [formTargetUrl, setFormTargetUrl] = useState('');
  const [formCustomCode, setFormCustomCode] = useState('');
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

  // Copiar link do servidor (URL que nunca muda)
  const handleCopyServerUrl = (code: string, id: string) => {
    const url = getPermanentQrUrl(code);
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(id);
      showToast('Link do servidor copiado!');
      setTimeout(() => setCopiedId(null), 2000);
    }).catch(() => {
      showToast('Link: ' + url);
    });
  };

  // Copiar destino atual
  const handleCopyTargetUrl = (url: string, id: string) => {
    navigator.clipboard.writeText(url).then(() => {
      setCopiedId(`target-${id}`);
      showToast('Link de destino copiado!');
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

  // Salvar novo QR no catálogo
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
      showToast('QR Code permanente criado com sucesso!');
    } catch (err: any) {
      console.error('Erro ao criar QR:', err);
      setFormError(err.message || 'Falha ao salvar QR Code.');
    } finally {
      setSaving(false);
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
      setTargetError('Informe o novo link de destino.');
      return;
    }

    try {
      setSaving(true);
      setTargetError(null);
      await updateDynamicQrTarget(changingTargetQr.id, newTargetInput);
      setChangingTargetQr(null);
      showToast(`Link de destino atualizado no servidor! O QR impresso permanece 100% idêntico.`);
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
      showToast(item.status === 'active' ? 'QR Code pausado no servidor.' : 'QR Code ativado no servidor!');
    } catch (err: any) {
      showToast('Erro ao alternar status do QR.');
    }
  };

  // Excluir QR
  const handleDelete = async (item: DynamicQr) => {
    const confirm = window.confirm(
      `Tem certeza que deseja excluir o QR "${item.title}"? O endereço do servidor deixará de responder.`
    );
    if (!confirm) return;

    try {
      await deleteDynamicQr(item.id);
      showToast('QR Code removido do sistema.');
    } catch (err: any) {
      showToast('Erro ao excluir QR.');
    }
  };

  // Download do QR em PNG Alta Resolução (1024px)
  const downloadQrPng = (item: DynamicQr) => {
    const canvasId = `qr-canvas-${item.code}`;
    const canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    if (!canvas) {
      showToast('Preparando imagem...');
      return;
    }

    const dataUrl = canvas.toDataURL('image/png');
    const safeName = item.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qrcode-fixo-${item.code}-${safeName}.png`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    showToast('Download do PNG (1024px) concluído!');
  };

  // Download do QR em SVG Vetorial
  const downloadQrSvg = (item: DynamicQr) => {
    const svgId = `qr-svg-${item.code}`;
    const svg = document.getElementById(svgId) as unknown as SVGSVGElement;
    if (!svg) {
      showToast('Erro ao capturar imagem SVG.');
      return;
    }
    const svgData = new XMLSerializer().serializeToString(svg);
    const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
    const blobUrl = URL.createObjectURL(svgBlob);
    const safeName = item.title.replace(/[^a-zA-Z0-9]/g, '_').toLowerCase();
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = `qrcode-fixo-${item.code}-${safeName}.svg`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(blobUrl);
    showToast('Download do SVG vetorial concluído!');
  };

  // Imprimir Etiqueta Física Fixa
  const handlePrintLabel = (item: DynamicQr) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      showToast('Por favor, permita pop-ups para imprimir a etiqueta.');
      return;
    }

    const svgElement = document.getElementById(`qr-svg-${item.code}`);
    const svgHtml = svgElement ? svgElement.outerHTML : '';
    const serverUrl = getPermanentQrUrl(item.code);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>Etiqueta QR Permanente - ${item.title}</title>
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
              width: 190px;
              height: 190px;
            }
            .server-link {
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
              font-weight: 700;
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
            <div class="server-link">${serverUrl}</div>
            <div class="footer">QR Code Permanente &bull; Nunca Precisa Reimprimir</div>
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
        const matchCode = item.code.toLowerCase().includes(q);
        const matchDesc = item.description?.toLowerCase().includes(q);
        if (!matchTitle && !matchUrl && !matchCode && !matchDesc) return false;
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
            <span className="text-[#1769ff]">QR Codes Dinâmicos</span>
          </div>
          <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
            QR Codes com Servidor Fixo
          </h1>
          <p className="mt-1 text-xs sm:text-sm text-slate-600">
            O QR Code impresso <strong>NUNCA muda de jeito algum</strong>. Troque a planilha ou link de destino no sistema quando quiser e a mesma placa continua funcionando perfeitamente!
          </p>
        </div>

        <button
          type="button"
          onClick={openCreateModal}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#FFE600] px-5 py-3 text-sm font-black text-slate-950 shadow-sm transition hover:bg-yellow-400 active:scale-[0.98] cursor-pointer"
        >
          <Plus className="h-5 w-5 stroke-[2.5]" />
          <span>Novo QR Permanente</span>
        </button>
      </div>

      {/* ============================================================ */}
      {/* BANNER EXPLICATIVO: O QR NUNCA MUDA (COMO UM SERVIDOR)       */}
      {/* ============================================================ */}
      <div className="rounded-2xl border border-blue-200 bg-gradient-to-r from-blue-50/90 via-indigo-50/60 to-blue-50/90 p-4 sm:p-5 shadow-xs">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#1769ff] text-white shadow-sm">
            <Server className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-slate-900">
                O QR Code físico NUNCA muda de imagem (Como um Servidor Dedicado)
              </h2>
              <span className="hidden sm:inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-extrabold text-emerald-800">
                <ShieldCheck className="h-3 w-3 text-emerald-600" />
                QR Fixo 100% Permanente
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-600 leading-relaxed">
              O QR Code impresso na etiqueta ou placa de acrílico contém o endereço fixo do seu servidor. Quando você clica em <strong>"Trocar Link"</strong> e digita uma nova planilha ou URL, <strong>o desenho do QR Code permanece rigorosamente o mesmo</strong> e quem escanear com o celular é levado <strong>instantaneamente (0s de espera)</strong> para o novo destino!
            </p>
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
            placeholder="Buscar por título, código ou link de destino..."
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
            {filteredQrs.length} {filteredQrs.length === 1 ? 'QR Cadastrado' : 'QRs Cadastrados'}
          </span>
        </div>
      </div>

      {/* ============================================================ */}
      {/* GRID DO CATÁLOGO DE QR CODES DIRETOS                         */}
      {/* ============================================================ */}
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
            {search || selectedCategory !== 'todos'
              ? 'Nenhum resultado corresponde aos filtros selecionados.'
              : 'Crie o primeiro QR Code fixo para rotas, docas ou planilhas.'}
          </p>
          <button
            type="button"
            onClick={openCreateModal}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-[#FFE600] px-4 py-2.5 text-xs font-black text-slate-950 transition hover:bg-yellow-400 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Criar Primeiro QR Code</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filteredQrs.map(item => {
            const serverUrl = getPermanentQrUrl(item.code);
            const isCopied = copiedId === item.id;
            const isPaused = item.status === 'paused';
            const canvasId = `qr-canvas-${item.code}`;
            const svgId = `qr-svg-${item.code}`;

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
                        <span className="inline-flex items-center gap-1 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                          <Server className="h-3 w-3 text-blue-600" />
                          QR Fixo
                        </span>
                        {isPaused && (
                          <span className="inline-flex items-center gap-1 rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
                            Pausado
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

                    {/* QR Code Thumbnail Preview (O QR FIXO QUE NUNCA MUDA) */}
                    <button
                      type="button"
                      onClick={() => setViewingQr(item)}
                      className="group relative shrink-0 rounded-xl border border-slate-200 bg-white p-1.5 shadow-sm transition hover:border-[#1769ff] hover:scale-105 cursor-pointer"
                      title="Clique para ampliar o QR Code permanente"
                    >
                      <QRCodeSVG
                        id={svgId}
                        value={serverUrl}
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
                      value={serverUrl}
                      size={1024}
                      level="H"
                      includeMargin={true}
                    />
                  </div>

                  {/* Caixas de Informação de Links */}
                  <div className="mt-4 space-y-2">
                    {/* Link de Destino Atual */}
                    <div className="rounded-xl border border-slate-200/90 bg-slate-50 p-2.5">
                      <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500 mb-1">
                        <span className="flex items-center gap-1">
                          <ExternalLink className="h-3 w-3 text-slate-600" />
                          Destino Atual
                        </span>
                        <a
                          href={normalizeUrl(item.targetUrl)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-[#1769ff] hover:underline font-bold"
                        >
                          Abrir destino
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      </div>
                      <p className="truncate font-mono text-xs text-slate-800 font-semibold" title={item.targetUrl}>
                        {item.targetUrl}
                      </p>
                    </div>

                    {/* Endereço do Servidor Fixo */}
                    <div className="flex items-center justify-between rounded-xl border border-blue-100 bg-blue-50/50 px-2.5 py-1.5 text-xs">
                      <div className="min-w-0 flex-1 truncate font-mono text-[11px] text-blue-900">
                        <span className="text-slate-400 font-sans text-[10px] uppercase font-bold">Servidor: </span>
                        {serverUrl}
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyServerUrl(item.code, item.id)}
                        className="ml-2 inline-flex items-center gap-1 rounded-md bg-white px-2 py-1 text-[10px] font-bold text-slate-700 shadow-xs border border-slate-200 hover:bg-slate-50 cursor-pointer"
                        title="Copiar endereço do servidor"
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
                  <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2.5 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1 font-bold text-slate-700">
                      <Activity className="h-3.5 w-3.5 text-[#1769ff]" />
                      {item.scansCount || 0} leituras
                    </span>
                    <span className="text-[10px]">
                      {item.lastScannedAt
                        ? `Última: ${new Date(item.lastScannedAt).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}`
                        : 'Aguardando primeira leitura'}
                    </span>
                  </div>
                </div>

                {/* Barra de Ações do Card */}
                <div className="mt-4 border-t border-slate-100 pt-3 flex flex-wrap items-center justify-between gap-1.5">
                  {/* Botão de Trocar / Editar Link */}
                  <button
                    type="button"
                    onClick={() => openChangeTargetModal(item)}
                    className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-xl bg-[#1769ff] px-3 py-2 text-xs font-black text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98] cursor-pointer"
                    title="Altera a planilha ou URL de destino sem mudar o QR impresso"
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    <span>Trocar Link</span>
                  </button>

                  {/* Baixar PNG */}
                  <button
                    type="button"
                    onClick={() => downloadQrPng(item)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                    title="Baixar imagem PNG de alta resolução"
                  >
                    <Download className="h-3.5 w-3.5" />
                  </button>

                  {/* Imprimir Etiqueta */}
                  <button
                    type="button"
                    onClick={() => handlePrintLabel(item)}
                    className="inline-flex items-center gap-1 rounded-xl border border-slate-200 bg-white px-2.5 py-2 text-xs font-bold text-slate-700 transition hover:bg-slate-50 cursor-pointer"
                    title="Imprimir etiqueta física"
                  >
                    <Printer className="h-3.5 w-3.5" />
                  </button>

                  {/* Pausar / Ativar */}
                  <button
                    type="button"
                    onClick={() => handleToggleStatus(item)}
                    className={`inline-flex items-center rounded-xl border px-2.5 py-2 text-xs font-bold transition cursor-pointer ${
                      isPaused
                        ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                        : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                    }`}
                    title={isPaused ? 'Ativar redirecionamento' : 'Pausar temporariamente'}
                  >
                    {isPaused ? <Play className="h-3.5 w-3.5 fill-current" /> : <Pause className="h-3.5 w-3.5" />}
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
      {/* MODAL 1: CRIAR NOVO QR CODE PERMANENTE                       */}
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
                <h2 className="text-lg font-black text-slate-900">Novo QR Code Permanente</h2>
                <p className="text-xs text-slate-500">O desenho do QR nunca muda, mesmo trocando o link depois</p>
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
                  Link de Destino Atual (Planilha, Formulário, Link...) *
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
                  Você poderá alterar este destino quando quiser. O QR impresso nunca mudará!
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
                    Código do Servidor (Opcional)
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
                      <span>Gerar QR Code Fixo</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/* MODAL 2: TROCAR LINK DE DESTINO (O QR FÍSICO NUNCA MUDA)     */}
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
                <RefreshCw className="h-5 w-5" />
              </div>
              <div>
                <h2 className="text-lg font-black text-slate-900">Trocar Link de Destino</h2>
                <p className="text-xs text-slate-500">
                  {changingTargetQr.title} &bull; Código: <code className="font-mono">{changingTargetQr.code}</code>
                </p>
              </div>
            </div>

            {/* Garantia visual de que o QR NÃO muda */}
            <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50/80 p-3.5 text-xs text-emerald-900">
              <div className="font-extrabold flex items-center gap-1.5 mb-1">
                <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                O QR Code físico NUNCA muda de jeito algum!
              </div>
              <p className="text-[11px] leading-relaxed text-emerald-800">
                A placa de acrílico ou folha impressa colada no galpão continuará funcionando perfeitamente sem precisar reimprimir nada. O servidor começará a redirecionar para a nova URL abaixo imediatamente.
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
                  Destino Atual
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
                  placeholder="Cole aqui a nova URL (Google Sheets, Formulário, Link WhatsApp...)"
                  className="w-full rounded-xl border-2 border-[#1769ff] px-3.5 py-2.5 text-xs sm:text-sm text-slate-900 font-mono outline-none shadow-sm"
                />
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
      {/* MODAL 3: VISUALIZAR, TESTAR E EXPORTAR QR CODE               */}
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

            {/* Imagem do QR Permanente em tamanho grande */}
            <div className="my-6 flex justify-center">
              <div className="rounded-2xl border-2 border-slate-200 bg-white p-4 shadow-inner">
                <QRCodeSVG
                  id={`modal-qr-svg-${viewingQr.code}`}
                  value={getPermanentQrUrl(viewingQr.code)}
                  size={210}
                  level="H"
                  includeMargin={true}
                />
              </div>
            </div>

            {/* Endereço permanente do servidor */}
            <div className="rounded-xl border border-blue-100 bg-blue-50/70 p-3 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-blue-700 block mb-1">
                Endereço Fixo do Servidor (Nunca Muda)
              </span>
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs text-blue-950 font-bold">
                  {getPermanentQrUrl(viewingQr.code)}
                </span>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => handleCopyServerUrl(viewingQr.code, viewingQr.id)}
                    className="rounded-lg bg-white border border-blue-200 p-1.5 text-blue-700 hover:bg-blue-50 shadow-xs cursor-pointer"
                    title="Copiar link permanente"
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                  <a
                    href={getPermanentQrUrl(viewingQr.code)}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg bg-white border border-blue-200 p-1.5 text-[#1769ff] hover:bg-blue-50 shadow-xs"
                    title="Testar redirecionamento instantâneo"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                </div>
              </div>
            </div>

            {/* Destino atual */}
            <div className="mt-2.5 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-500 block mb-0.5">
                Destino Atual Configurado
              </span>
              <span className="truncate font-mono text-xs text-slate-700 block" title={viewingQr.targetUrl}>
                {viewingQr.targetUrl}
              </span>
            </div>

            {/* Botões de Ação de Exportação */}
            <div className="mt-6 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => downloadQrPng(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-xs transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
              >
                <Download className="h-4 w-4 mb-1 text-[#1769ff]" />
                <span>Baixar PNG</span>
              </button>

              <button
                type="button"
                onClick={() => downloadQrSvg(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-xs transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
              >
                <Download className="h-4 w-4 mb-1 text-emerald-600" />
                <span>Baixar SVG</span>
              </button>

              <button
                type="button"
                onClick={() => handlePrintLabel(viewingQr)}
                className="inline-flex flex-col items-center justify-center rounded-xl border border-slate-200 bg-white p-2.5 text-xs font-bold text-slate-800 shadow-xs transition hover:bg-slate-50 hover:border-slate-300 cursor-pointer"
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
