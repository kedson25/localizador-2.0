import React, { useEffect, useMemo, useState } from 'react';
import {
  Code2,
  Copy,
  Check,
  Trash2,
  Edit3,
  Eye,
  X,
  Plus,
  Search,
  ExternalLink,
  RefreshCw,
  FileCode,
} from 'lucide-react';
import {
  SavedCode,
  listenToSavedCodes,
  createSavedCode,
  updateSavedCode,
  deleteSavedCode,
} from '../lib/codes';
import type { User } from '../lib/auth';

interface CodesPanelProps {
  currentUser?: User | null;
}

export const CodesPanel: React.FC<CodesPanelProps> = ({ currentUser }) => {
  const [codes, setCodes] = useState<SavedCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Formulário simples para colar e salvar
  const [inputTitle, setInputTitle] = useState('');
  const [inputCode, setInputCode] = useState('');
  const [showPreviewTop, setShowPreviewTop] = useState(false);
  const [saving, setSaving] = useState(false);

  // Modal de Edição
  const [editingItem, setEditingItem] = useState<SavedCode | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editCode, setEditCode] = useState('');
  const [editSaving, setEditSaving] = useState(false);

  // Modal de Pré-visualização do HTML
  const [previewItem, setPreviewItem] = useState<SavedCode | null>(null);

  // Feedback rápido
  const [feedback, setFeedback] = useState<string | null>(null);

  const showFeedback = (msg: string) => {
    setFeedback(msg);
    setTimeout(() => setFeedback(null), 2500);
  };

  useEffect(() => {
    const unsubscribe = listenToSavedCodes(
      items => {
        setCodes(items);
        setLoading(false);
      },
      err => {
        console.warn('Erro ao carregar códigos:', err);
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, []);

  // Copiar código
  const handleCopy = (codeText: string, id: string) => {
    navigator.clipboard.writeText(codeText).then(() => {
      setCopiedId(id);
      showFeedback('Código copiado!');
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  // Salvar novo código
  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputCode.trim()) {
      showFeedback('Cole um código antes de salvar.');
      return;
    }

    try {
      setSaving(true);
      await createSavedCode({
        title: inputTitle.trim() || 'Código',
        code: inputCode,
        createdBy: currentUser?.username || 'Usuário',
      });
      setInputTitle('');
      setInputCode('');
      setShowPreviewTop(false);
      showFeedback('Código salvo com sucesso!');
    } catch (err: any) {
      showFeedback('Erro ao salvar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  // Abrir edição
  const openEdit = (item: SavedCode) => {
    setEditingItem(item);
    setEditTitle(item.title);
    setEditCode(item.code);
  };

  // Salvar edição
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!editCode.trim()) {
      showFeedback('O código não pode estar vazio.');
      return;
    }

    try {
      setEditSaving(true);
      await updateSavedCode(editingItem.id, {
        title: editTitle.trim() || 'Código',
        code: editCode,
      });
      setEditingItem(null);
      showFeedback('Código atualizado!');
    } catch (err: any) {
      showFeedback('Erro ao atualizar: ' + err.message);
    } finally {
      setEditSaving(false);
    }
  };

  // Excluir código
  const handleDelete = async (id: string) => {
    if (!window.confirm('Excluir este código?')) return;
    try {
      await deleteSavedCode(id);
      showFeedback('Código excluído.');
    } catch (err: any) {
      showFeedback('Erro ao excluir.');
    }
  };

  // Filtragem
  const filtered = useMemo(() => {
    if (!search.trim()) return codes;
    const q = search.trim().toLowerCase();
    return codes.filter(
      item => item.title.toLowerCase().includes(q) || item.code.toLowerCase().includes(q)
    );
  }, [codes, search]);

  return (
    <div className="mx-auto max-w-5xl space-y-4">
      {/* Notificação discreta */}
      {feedback && (
        <div className="fixed bottom-5 right-5 z-50 rounded-lg bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-lg">
          {feedback}
        </div>
      )}

      {/* Cabeçalho minimalista */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <h1 className="text-base font-black text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Code2 className="h-4 w-4 text-[#1769ff]" />
          <span>Codes</span>
        </h1>
        <span className="text-xs font-mono font-bold text-slate-500">
          {codes.length} {codes.length === 1 ? 'salvo' : 'salvos'}
        </span>
      </div>

      {/* Caixa de Entrada: Cole o HTML e Salve */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
        <form onSubmit={handleSave} className="space-y-3">
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={inputTitle}
              onChange={e => setInputTitle(e.target.value)}
              placeholder="Título / Identificação (opcional)"
              className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
            />
            {inputCode.trim() && (
              <button
                type="button"
                onClick={() => setShowPreviewTop(!showPreviewTop)}
                className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
              >
                <Eye className="h-3.5 w-3.5" />
                <span>{showPreviewTop ? 'Ocultar Preview' : 'Ver Preview'}</span>
              </button>
            )}
          </div>

          {/* Preview se ativado */}
          {showPreviewTop && inputCode.trim() && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-2">
              <iframe
                title="Top Preview"
                srcDoc={inputCode}
                className="w-full h-44 rounded border border-slate-200 bg-white"
                sandbox="allow-scripts"
              />
            </div>
          )}

          {/* Textarea do Código */}
          <textarea
            required
            rows={7}
            value={inputCode}
            onChange={e => setInputCode(e.target.value)}
            placeholder="Cole aqui o seu código HTML..."
            className="w-full rounded-lg border border-slate-300 bg-[#0f172a] p-3 font-mono text-xs text-emerald-400 outline-none placeholder:text-slate-500 focus:border-[#1769ff]"
            spellCheck={false}
          />

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => {
                setInputTitle('');
                setInputCode('');
                setShowPreviewTop(false);
              }}
              className="text-xs text-slate-400 hover:text-slate-600 cursor-pointer"
            >
              Limpar
            </button>
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[#FFE600] px-4 py-2 text-xs font-black text-slate-950 transition hover:bg-yellow-400 disabled:opacity-50 cursor-pointer shadow-xs"
            >
              <Plus className="h-4 w-4" />
              <span>{saving ? 'Salvando...' : 'Salvar Código'}</span>
            </button>
          </div>
        </form>
      </div>

      {/* Busca se houver mais de 1 código */}
      {codes.length > 1 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            type="search"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar nos códigos..."
            className="w-full rounded-lg border border-slate-200 bg-white py-1.5 pl-9 pr-3 text-xs text-slate-800 outline-none focus:border-[#1769ff]"
          />
        </div>
      )}

      {/* Lista de Códigos Salvos */}
      {loading ? (
        <div className="py-8 text-center text-xs text-slate-500">Carregando...</div>
      ) : filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed border-slate-300 py-12 text-center text-xs text-slate-500">
          {search ? 'Nenhum código corresponde à busca.' : 'Nenhum código salvo ainda. Cole seu código acima e clique em Salvar.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(item => {
            const isCopied = copiedId === item.id;
            return (
              <div
                key={item.id}
                className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs space-y-2"
              >
                {/* Topo do item: Título e Ações */}
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-sm font-bold text-slate-900 truncate">
                    {item.title}
                  </h3>

                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleCopy(item.code, item.id)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      title="Copiar código"
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

                    <button
                      type="button"
                      onClick={() => setPreviewItem(item)}
                      className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                      title="Visualizar HTML"
                    >
                      <Eye className="h-3 w-3" />
                      <span>Visualizar</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => openEdit(item)}
                      className="rounded-md border border-slate-200 p-1 text-slate-600 hover:bg-slate-100 cursor-pointer"
                      title="Editar"
                    >
                      <Edit3 className="h-3.5 w-3.5" />
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(item.id)}
                      className="rounded-md border border-slate-200 p-1 text-red-500 hover:bg-red-50 cursor-pointer"
                      title="Excluir"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>

                {/* Bloco de Código Monospace */}
                <div className="relative rounded-lg border border-slate-800 bg-[#0f172a] p-2.5">
                  <pre className="max-h-36 overflow-x-auto overflow-y-auto font-mono text-xs text-emerald-300 leading-relaxed">
                    <code>{item.code}</code>
                  </pre>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal de Pré-visualização do HTML */}
      {previewItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-3xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900 truncate">
                {previewItem.title}
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopy(previewItem.code, `modal-${previewItem.id}`)}
                  className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-bold text-slate-700 hover:bg-slate-100 cursor-pointer"
                >
                  <Copy className="h-3 w-3" />
                  <span>Copiar</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewItem(null)}
                  className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 flex-1 min-h-[300px] rounded-lg border border-slate-200 bg-slate-50 p-2">
              <iframe
                title="Preview"
                srcDoc={previewItem.code}
                className="w-full h-full min-h-[300px] rounded border border-slate-200 bg-white"
                sandbox="allow-scripts"
              />
            </div>
          </div>
        </div>
      )}

      {/* Modal de Edição */}
      {editingItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-xs">
          <div className="relative w-full max-w-2xl rounded-xl border border-slate-200 bg-white p-5 shadow-2xl space-y-3">
            <div className="flex items-center justify-between border-b border-slate-100 pb-2">
              <h3 className="text-sm font-bold text-slate-900">Editar Código</h3>
              <button
                type="button"
                onClick={() => setEditingItem(null)}
                className="rounded-md p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveEdit} className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Título</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={e => setEditTitle(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 px-3 py-1.5 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">Código</label>
                <textarea
                  required
                  rows={9}
                  value={editCode}
                  onChange={e => setEditCode(e.target.value)}
                  className="w-full rounded-lg border border-slate-300 bg-[#0f172a] p-2.5 font-mono text-xs text-emerald-400 outline-none focus:border-[#1769ff]"
                  spellCheck={false}
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => setEditingItem(null)}
                  className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:bg-slate-50 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={editSaving}
                  className="rounded-lg bg-[#1769ff] px-4 py-1.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
                >
                  {editSaving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
