import React, { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  Edit3,
  ExternalLink,
  FileText,
  FolderKanban,
  Link2,
  Menu,
  Play,
  Plus,
  Search,
  Trash2,
  Video,
  X,
  Zap,
} from 'lucide-react';
import type { CsvRow } from '../types';
import type { User } from '../lib/auth';
import { IdLookupEnhanced } from './IdLookupEnhanced';
import {
  GuiaLesson,
  createGuiaLesson,
  deleteGuiaLesson,
  getVideoEmbedInfo,
  listenToGuiaLessons,
  updateGuiaLesson,
  updateGuiaModule,
} from '../lib/guia';

interface GuiaPublicoPageProps {
  rows: CsvRow[];
  currentUser?: User | null;
}

export const GuiaPublicoPage: React.FC<GuiaPublicoPageProps> = ({
  rows,
  currentUser,
}) => {
  const isAdmin = Boolean(currentUser?.isAdmin);
  const [activeView, setActiveView] = useState<'localizador' | 'guias'>('localizador');
  const [drawerOpen, setDrawerOpen] = useState(false);

  const [lessons, setLessons] = useState<GuiaLesson[]>([]);
  const [activeLessonPlayer, setActiveLessonPlayer] = useState<GuiaLesson | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  // Estado de formulário de Item (vídeo / link / descrição) exclusivo para Admin
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingLesson, setEditingLesson] = useState<GuiaLesson | null>(null);
  const [moduleTitle, setModuleTitle] = useState('');
  const [moduleDescription, setModuleDescription] = useState('');
  const [lessonTitle, setLessonTitle] = useState('');
  const [lessonDescription, setLessonDescription] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  // Estado de formulário para editar cabeçalho/descrição do Módulo
  const [editingModuleTarget, setEditingModuleTarget] = useState<string | null>(null);
  const [editModuleName, setEditModuleName] = useState('');
  const [editModuleDesc, setEditModuleDesc] = useState('');
  const [savingModule, setSavingModule] = useState(false);

  const showToast = (msg: string) => {
    setFeedback(msg);
    window.setTimeout(() => setFeedback(null), 2500);
  };

  useEffect(() => {
    const unsubscribe = listenToGuiaLessons(items => {
      setLessons(items);
    });
    return () => unsubscribe();
  }, []);

  const groupedModules = useMemo(() => {
    const groups = new Map<
      string,
      { moduleDescription: string; items: GuiaLesson[] }
    >();
    lessons.forEach(item => {
      const mod = item.moduleTitle || 'Módulo Geral';
      const existing = groups.get(mod) || {
        moduleDescription: '',
        items: [],
      };
      if (!existing.moduleDescription && item.moduleDescription) {
        existing.moduleDescription = item.moduleDescription;
      }
      existing.items.push(item);
      groups.set(mod, existing);
    });

    return Array.from(groups.entries()).map(
      ([moduleName, { moduleDescription: modDesc, items }]) => ({
        moduleName,
        moduleDescription: modDesc,
        items,
      })
    );
  }, [lessons]);

  const moduleNames = useMemo(
    () => groupedModules.map(g => g.moduleName),
    [groupedModules]
  );

  const getModuleDescriptionByName = (name: string): string => {
    const found = groupedModules.find(g => g.moduleName === name);
    return found?.moduleDescription || '';
  };

  const openCreateModal = (presetModule?: string) => {
    if (!isAdmin) return;
    const defaultMod = presetModule || moduleNames[0] || 'Módulo 1';
    setEditingLesson(null);
    setModuleTitle(defaultMod);
    setModuleDescription(getModuleDescriptionByName(defaultMod));
    setLessonTitle('');
    setLessonDescription('');
    setVideoUrl('');
    setShowFormModal(true);
  };

  const openEditModal = (lesson: GuiaLesson) => {
    if (!isAdmin) return;
    setEditingLesson(lesson);
    setModuleTitle(lesson.moduleTitle);
    setModuleDescription(
      lesson.moduleDescription || getModuleDescriptionByName(lesson.moduleTitle)
    );
    setLessonTitle(lesson.title);
    setLessonDescription(lesson.description || '');
    setVideoUrl(lesson.videoUrl || '');
    setShowFormModal(true);
  };

  const openEditModuleModal = (modName: string, modDesc: string) => {
    if (!isAdmin) return;
    setEditingModuleTarget(modName);
    setEditModuleName(modName);
    setEditModuleDesc(modDesc || '');
  };

  const handleSaveModuleMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin || !editingModuleTarget) return;

    try {
      setSavingModule(true);
      await updateGuiaModule(editingModuleTarget, {
        moduleTitle: editModuleName.trim() || editingModuleTarget,
        moduleDescription: editModuleDesc.trim(),
      });
      showToast('Módulo atualizado!');
      setEditingModuleTarget(null);
    } catch (err: any) {
      showToast('Erro ao atualizar módulo: ' + (err?.message || 'Tente novamente.'));
    } finally {
      setSavingModule(false);
    }
  };

  const handleSaveLesson = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isAdmin) return;

    if (!videoUrl.trim() && !lessonDescription.trim()) {
      showToast('Informe um link ou uma descrição para o item.');
      return;
    }

    try {
      setSaving(true);
      if (editingLesson) {
        await updateGuiaLesson(editingLesson.id, {
          moduleTitle: moduleTitle.trim() || 'Módulo 1',
          moduleDescription: moduleDescription.trim(),
          title: lessonTitle.trim() || 'Item',
          description: lessonDescription.trim(),
          videoUrl: videoUrl.trim(),
        });
        showToast('Item atualizado!');
      } else {
        await createGuiaLesson({
          moduleTitle: moduleTitle.trim() || 'Módulo 1',
          moduleDescription: moduleDescription.trim(),
          title: lessonTitle.trim() || 'Item',
          description: lessonDescription.trim(),
          videoUrl: videoUrl.trim(),
          createdBy: currentUser?.username || 'Admin',
        });
        showToast('Item adicionado ao módulo!');
      }
      setShowFormModal(false);
      setEditingLesson(null);
    } catch (err: any) {
      showToast('Erro ao salvar: ' + (err?.message || 'Tente novamente.'));
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteLesson = async (id: string) => {
    if (!isAdmin) return;
    try {
      await deleteGuiaLesson(id);
      if (activeLessonPlayer?.id === id) {
        setActiveLessonPlayer(null);
      }
      setConfirmDeleteId(null);
      showToast('Item removido.');
    } catch {
      showToast('Erro ao remover item.');
    }
  };

  const activeEmbed = useMemo(() => {
    if (!activeLessonPlayer) return null;
    return getVideoEmbedInfo(activeLessonPlayer.videoUrl);
  }, [activeLessonPlayer]);

  return (
    <div className="min-h-screen flex flex-col bg-[#EBEBEB] text-slate-900">
      {feedback && (
        <div className="fixed bottom-5 right-5 z-50 border border-slate-700 bg-slate-900 px-4 py-2 text-xs font-bold text-white shadow-xl">
          {feedback}
        </div>
      )}

      {/* Drawer Lateral Minimalista: apenas Localizador e Guias */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setDrawerOpen(false)}
          />
          <aside className="relative z-10 flex w-[240px] max-w-[80vw] flex-col bg-white shadow-2xl border-r border-slate-200">
            <div className="flex h-14 items-center justify-between border-b border-slate-200 bg-[#FFE600] px-4">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center bg-[#253b80] text-white">
                  <Zap className="h-4 w-4" />
                </span>
                <span className="text-sm font-black uppercase tracking-tight text-[#253b80]">
                  Ecooy
                </span>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="p-1.5 text-slate-800 hover:bg-black/10 cursor-pointer"
                aria-label="Fechar menu"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <nav className="flex-1 p-2 space-y-1">
              <button
                type="button"
                onClick={() => {
                  setActiveView('localizador');
                  setDrawerOpen(false);
                }}
                className={`relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                  activeView === 'localizador'
                    ? 'bg-[#fff5bd] font-black text-slate-950'
                    : 'font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {activeView === 'localizador' && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#253b80]" />
                )}
                <Search className="h-4 w-4 shrink-0 text-[#253b80]" />
                <span>Localizador</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setActiveView('guias');
                  setDrawerOpen(false);
                }}
                className={`relative flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-xs transition cursor-pointer ${
                  activeView === 'guias'
                    ? 'bg-[#fff5bd] font-black text-slate-950'
                    : 'font-semibold text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }`}
              >
                {activeView === 'guias' && (
                  <span className="absolute left-0 top-0 bottom-0 w-1 bg-[#253b80]" />
                )}
                <BookOpen className="h-4 w-4 shrink-0 text-[#253b80]" />
                <span>Guias</span>
              </button>
            </nav>
          </aside>
        </div>
      )}

      {/* Barra Superior Limpa (Apenas botão do Drawer e Título) */}
      <header className="sticky top-0 z-30 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-13 max-w-[1360px] items-center justify-between px-3 sm:px-5 lg:px-6">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              className="inline-flex h-9 w-9 items-center justify-center border border-slate-200 bg-white text-slate-800 hover:bg-slate-50 cursor-pointer"
              aria-label="Abrir menu"
            >
              <Menu className="h-4 w-4" />
            </button>

            <span className="text-sm font-black uppercase tracking-wider text-slate-900">
              {activeView === 'localizador' ? 'Localizador' : 'Guias'}
            </span>
          </div>

          {isAdmin && activeView === 'guias' && (
            <button
              type="button"
              onClick={() => openCreateModal()}
              className="inline-flex items-center gap-1.5 bg-[#1769ff] hover:bg-blue-700 px-3 py-1.5 text-xs font-bold text-white cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Adicionar Item</span>
            </button>
          )}
        </div>
      </header>

      {/* Conteúdo */}
      <main className="mx-auto w-full max-w-[1360px] flex-1 px-3 py-4 sm:px-5 lg:px-6">
        {activeView === 'localizador' ? (
          <IdLookupEnhanced
            rows={rows}
            onNavigateToUpload={() => {}}
            minimalMode
          />
        ) : (
          <div className="space-y-4">
            {/* Player de Vídeo quando uma aula de vídeo é clicada */}
            {activeLessonPlayer && activeEmbed && activeEmbed.type !== 'none' && (
              <div className="border border-slate-200 bg-slate-950 p-4 text-white">
                <div className="mx-auto max-w-4xl space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="bg-[#FFE600] px-2 py-0.5 text-[10px] font-black uppercase text-slate-950 shrink-0">
                          {activeLessonPlayer.moduleTitle}
                        </span>
                        <h3 className="truncate text-sm font-black text-white">
                          {activeLessonPlayer.title}
                        </h3>
                      </div>
                      {activeLessonPlayer.description && (
                        <p className="mt-1 text-xs text-slate-300 whitespace-pre-line">
                          {activeLessonPlayer.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {activeLessonPlayer.videoUrl && (
                        <a
                          href={activeLessonPlayer.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 border border-slate-700 bg-slate-800 hover:bg-slate-700 px-2.5 py-1 text-xs font-bold text-white"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          <span>Abrir</span>
                        </a>
                      )}
                      <button
                        type="button"
                        onClick={() => setActiveLessonPlayer(null)}
                        className="inline-flex items-center gap-1 border border-slate-700 bg-slate-800 hover:bg-red-600 px-2 py-1 text-xs font-bold text-white cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {activeEmbed.type === 'iframe' ? (
                    <div className="relative w-full overflow-hidden border border-slate-800 bg-black pt-[56.25%]">
                      <iframe
                        title={activeLessonPlayer.title}
                        src={activeEmbed.embedUrl}
                        className="absolute inset-0 h-full w-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  ) : activeEmbed.type === 'video' ? (
                    <video
                      src={activeEmbed.embedUrl}
                      controls
                      autoPlay
                      className="max-h-[480px] w-full border border-slate-800 bg-black"
                    />
                  ) : (
                    <div className="flex flex-col items-center justify-center gap-3 border border-slate-800 bg-slate-900 p-8 text-center">
                      <Video className="h-7 w-7 text-[#FFE600]" />
                      <a
                        href={activeLessonPlayer.videoUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 bg-[#1769ff] hover:bg-blue-600 px-4 py-2 text-xs font-black uppercase text-white"
                      >
                        <ExternalLink className="h-4 w-4" />
                        <span>Abrir Link</span>
                      </a>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Lista de Módulos e Itens */}
            {lessons.length === 0 ? (
              <div className="border border-slate-200 bg-white py-12 px-4 text-center space-y-3">
                <FolderKanban className="mx-auto h-7 w-7 text-slate-400" />
                <p className="text-xs font-bold text-slate-500">
                  Nenhum módulo cadastrado ainda.
                </p>
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => openCreateModal('Módulo 1')}
                    className="inline-flex items-center gap-1.5 bg-[#1769ff] hover:bg-blue-700 px-3.5 py-2 text-xs font-bold text-white cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Adicionar ao Módulo</span>
                  </button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {groupedModules.map(
                  ({ moduleName, moduleDescription: modDesc, items }) => (
                    <div
                      key={moduleName}
                      className="border border-slate-200 bg-white"
                    >
                      {/* Cabeçalho do Módulo + Descrição visível abaixo do título */}
                      <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <FolderKanban className="h-4 w-4 shrink-0 text-[#253b80]" />
                            <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                              {moduleName}
                            </h3>
                            <span className="font-mono text-[11px] font-bold text-slate-400">
                              ({items.length})
                            </span>
                          </div>
                          {modDesc && (
                            <p className="mt-1 pl-6 text-xs text-slate-600 whitespace-pre-line">
                              {modDesc}
                            </p>
                          )}
                        </div>

                        {isAdmin && (
                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() => openEditModuleModal(moduleName, modDesc)}
                              className="inline-flex items-center gap-1 border border-slate-200 bg-white hover:bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700 cursor-pointer"
                              title="Editar título e descrição do módulo"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>Módulo</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => openCreateModal(moduleName)}
                              className="inline-flex items-center gap-1 bg-[#1769ff] hover:bg-blue-700 px-2.5 py-1 text-[11px] font-bold text-white cursor-pointer"
                            >
                              <Plus className="h-3 w-3" />
                              <span>Adicionar</span>
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Itens do Módulo */}
                      <div className="divide-y divide-slate-100">
                        {items.map((lesson, idx) => {
                          const embed = getVideoEmbedInfo(lesson.videoUrl);
                          const isVideo =
                            embed.type === 'iframe' || embed.type === 'video';
                          const isExternalLink = embed.type === 'external';
                          const isPlaying = activeLessonPlayer?.id === lesson.id;

                          return (
                            <div
                              key={lesson.id}
                              className={`flex items-start justify-between gap-3 px-4 py-3 transition ${
                                isPlaying ? 'bg-blue-50/60' : 'hover:bg-slate-50'
                              }`}
                            >
                              {/* Conteúdo clicável (Vídeo abre player inline; Link externo abre nova guia; Sem link apenas exibe) */}
                              {isVideo ? (
                                <button
                                  type="button"
                                  onClick={() =>
                                    setActiveLessonPlayer(isPlaying ? null : lesson)
                                  }
                                  className="flex flex-1 items-start gap-3 text-left min-w-0 cursor-pointer"
                                >
                                  <span
                                    className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border font-mono text-xs font-black ${
                                      isPlaying
                                        ? 'border-[#1769ff] bg-[#1769ff] text-white'
                                        : 'border-slate-200 bg-slate-100 text-slate-700'
                                    }`}
                                  >
                                    <Play className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-bold text-slate-900">
                                        {idx + 1}. {lesson.title}
                                      </span>
                                      <span className="border border-blue-200 bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold uppercase text-[#1769ff]">
                                        Vídeo
                                      </span>
                                    </div>
                                    {lesson.description && (
                                      <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">
                                        {lesson.description}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              ) : isExternalLink ? (
                                <a
                                  href={lesson.videoUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex flex-1 items-start gap-3 text-left min-w-0 group"
                                >
                                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-slate-200 bg-slate-100 text-[#253b80] group-hover:border-[#1769ff] group-hover:bg-blue-50 group-hover:text-[#1769ff]">
                                    <Link2 className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="text-xs font-bold text-slate-900 group-hover:text-[#1769ff] group-hover:underline">
                                        {idx + 1}. {lesson.title}
                                      </span>
                                      <span className="inline-flex items-center gap-1 border border-slate-200 bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-700">
                                        <span>Link</span>
                                        <ExternalLink className="h-2.5 w-2.5" />
                                      </span>
                                    </div>
                                    {lesson.description && (
                                      <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">
                                        {lesson.description}
                                      </p>
                                    )}
                                  </div>
                                </a>
                              ) : (
                                <div className="flex flex-1 items-start gap-3 text-left min-w-0">
                                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-slate-200 bg-slate-100 text-slate-600">
                                    <FileText className="h-3.5 w-3.5" />
                                  </span>
                                  <div className="min-w-0 flex-1">
                                    <span className="block text-xs font-bold text-slate-900">
                                      {idx + 1}. {lesson.title}
                                    </span>
                                    {lesson.description && (
                                      <p className="mt-1 text-xs text-slate-600 whitespace-pre-line">
                                        {lesson.description}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              )}

                              {/* Ações laterais (Abrir link externo + Admin Editar/Excluir) */}
                              <div className="flex items-center gap-1 shrink-0">
                                {lesson.videoUrl && (
                                  <a
                                    href={lesson.videoUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 border border-slate-200 bg-white hover:bg-slate-100 px-2 py-1 text-[11px] font-bold text-slate-700"
                                    title="Abrir link em nova aba"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                    <span className="hidden sm:inline">Abrir</span>
                                  </a>
                                )}

                                {isAdmin && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => openEditModal(lesson)}
                                      className="p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer"
                                      title="Editar item"
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    {confirmDeleteId === lesson.id ? (
                                      <button
                                        type="button"
                                        onClick={() => handleDeleteLesson(lesson.id)}
                                        className="bg-red-600 px-2 py-1 text-[10px] font-black text-white cursor-pointer"
                                      >
                                        Confirmar
                                      </button>
                                    ) : (
                                      <button
                                        type="button"
                                        onClick={() => setConfirmDeleteId(lesson.id)}
                                        className="p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600 cursor-pointer"
                                        title="Excluir item"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )
                )}
              </div>
            )}
          </div>
        )}
      </main>

      {/* Modal Admin de Adicionar / Editar Item (Vídeo, Link ou Descrição) */}
      {isAdmin && showFormModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-lg border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                {editingLesson ? 'Editar Item do Módulo' : 'Adicionar ao Módulo'}
              </h3>
              <button
                type="button"
                onClick={() => setShowFormModal(false)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveLesson} className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Módulo
                </label>
                <input
                  type="text"
                  value={moduleTitle}
                  onChange={e => setModuleTitle(e.target.value)}
                  placeholder="Ex: Módulo 1 - Operação"
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                  required
                />
                {moduleNames.length > 0 && (
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {moduleNames.map(mod => (
                      <button
                        key={mod}
                        type="button"
                        onClick={() => {
                          setModuleTitle(mod);
                          setModuleDescription(getModuleDescriptionByName(mod));
                        }}
                        className={`border px-2 py-0.5 text-[10px] font-bold cursor-pointer ${
                          moduleTitle === mod
                            ? 'border-[#1769ff] bg-blue-50 text-[#1769ff]'
                            : 'border-slate-200 bg-slate-50 text-slate-600'
                        }`}
                      >
                        {mod}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Descrição do Módulo (opcional — exibida abaixo do título do módulo)
                </label>
                <input
                  type="text"
                  value={moduleDescription}
                  onChange={e => setModuleDescription(e.target.value)}
                  placeholder="Resumo ou orientação geral deste módulo..."
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                />
              </div>

              <div className="border-t border-slate-200 pt-3">
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Título da Aula / Link
                </label>
                <input
                  type="text"
                  value={lessonTitle}
                  onChange={e => setLessonTitle(e.target.value)}
                  placeholder="Ex: Planilha de Controle ou Aula 01 - Como buscar IDs"
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Link (Vídeo ou Link Externo)
                </label>
                <input
                  type="text"
                  value={videoUrl}
                  onChange={e => setVideoUrl(e.target.value)}
                  placeholder="https://... (YouTube, Drive, Planilha, Formulário, etc.)"
                  className="w-full border border-slate-300 px-3 py-2 font-mono text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Descrição (visível abaixo do título do item)
                </label>
                <textarea
                  rows={3}
                  value={lessonDescription}
                  onChange={e => setLessonDescription(e.target.value)}
                  placeholder="Instruções, observações ou detalhes sobre este vídeo/link..."
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setShowFormModal(false)}
                  className="border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="bg-[#1769ff] hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 text-xs font-bold text-white cursor-pointer"
                >
                  {saving ? 'Salvando...' : 'Salvar'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Admin para Editar Nome e Descrição do Módulo */}
      {isAdmin && editingModuleTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3">
              <h3 className="text-xs font-black uppercase tracking-wider text-slate-900">
                Editar Módulo
              </h3>
              <button
                type="button"
                onClick={() => setEditingModuleTarget(null)}
                className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <form onSubmit={handleSaveModuleMeta} className="space-y-3 p-4">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Nome do Módulo
                </label>
                <input
                  type="text"
                  value={editModuleName}
                  onChange={e => setEditModuleName(e.target.value)}
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                  required
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-bold text-slate-700">
                  Descrição do Módulo (exibida abaixo do título do módulo)
                </label>
                <textarea
                  rows={3}
                  value={editModuleDesc}
                  onChange={e => setEditModuleDesc(e.target.value)}
                  placeholder="Descrição ou instruções gerais deste módulo..."
                  className="w-full border border-slate-300 px-3 py-2 text-xs text-slate-900 outline-none focus:border-[#1769ff]"
                />
              </div>

              <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingModuleTarget(null)}
                  className="border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-600 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={savingModule}
                  className="bg-[#1769ff] hover:bg-blue-700 disabled:opacity-50 px-4 py-1.5 text-xs font-bold text-white cursor-pointer"
                >
                  {savingModule ? 'Salvando...' : 'Salvar Módulo'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
