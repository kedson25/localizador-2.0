import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase-core';

export interface GuiaLesson {
  id: string;
  moduleTitle: string;
  moduleDescription?: string;
  title: string;
  videoUrl: string;
  description?: string;
  order?: number;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

const COLLECTION_NAME = 'guia_aulas';
const LOCAL_STORAGE_KEY = 'ecooy_guia_aulas_cache_v1';

export function normalizeUrl(raw: string): string {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getLocalGuiaCache(): GuiaLesson[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function setLocalGuiaCache(items: GuiaLesson[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

export function listenToGuiaLessons(
  onUpdate: (lessons: GuiaLesson[]) => void,
  onError?: (error: Error) => void
): () => void {
  const cached = getLocalGuiaCache();
  onUpdate(cached);

  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('createdAt', 'asc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const items: GuiaLesson[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            moduleTitle: String(data.moduleTitle || 'Módulo Geral').trim(),
            moduleDescription: data.moduleDescription
              ? String(data.moduleDescription).trim()
              : '',
            title: String(data.title || 'Item').trim(),
            videoUrl: String(data.videoUrl || '').trim(),
            description: data.description ? String(data.description).trim() : '',
            order: typeof data.order === 'number' ? data.order : 0,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            createdBy: data.createdBy || '',
          });
        });

        setLocalGuiaCache(items);
        onUpdate(items);
      },
      error => {
        console.warn('Erro ao sincronizar guia_aulas do Firestore:', error);
        if (onError) onError(error);
      }
    );
    return unsubscribe;
  } catch (err: any) {
    console.warn('Falha ao iniciar listener de guia_aulas:', err);
    if (onError) onError(err);
    return () => {};
  }
}

export async function createGuiaLesson(params: {
  moduleTitle: string;
  moduleDescription?: string;
  title: string;
  videoUrl?: string;
  description?: string;
  createdBy?: string;
}): Promise<GuiaLesson> {
  const moduleTitle = (params.moduleTitle || '').trim() || 'Módulo 1';
  const moduleDescription = (params.moduleDescription || '').trim();
  const title = (params.title || '').trim() || 'Novo Item';
  const videoUrl = normalizeUrl(params.videoUrl || '');
  const description = (params.description || '').trim();

  if (!videoUrl && !description) {
    throw new Error('Informe um link ou uma descrição para o item.');
  }

  const id = `aula-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newLesson: GuiaLesson = {
    id,
    moduleTitle,
    moduleDescription,
    title,
    videoUrl,
    description,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy || 'Admin',
  };

  const docRef = doc(db, COLLECTION_NAME, id);
  await setDoc(docRef, newLesson);

  const current = getLocalGuiaCache();
  // Se uma descrição de módulo foi informada, sincroniza nos demais itens do mesmo módulo
  const sameModuleItems = current.filter(i => i.moduleTitle === moduleTitle && i.id !== id);
  if (sameModuleItems.length > 0 && moduleDescription !== undefined) {
    try {
      const batch = writeBatch(db);
      sameModuleItems.forEach(item => {
        batch.update(doc(db, COLLECTION_NAME, item.id), {
          moduleDescription,
          updatedAt: now,
        });
      });
      await batch.commit();
    } catch (err) {
      console.warn('Falha ao sincronizar descrição do módulo:', err);
    }
  }

  const updated = [
    ...current
      .filter(i => i.id !== id)
      .map(i =>
        i.moduleTitle === moduleTitle ? { ...i, moduleDescription } : i
      ),
    newLesson,
  ];
  setLocalGuiaCache(updated);

  return newLesson;
}

export async function updateGuiaLesson(
  id: string,
  updates: Partial<
    Pick<GuiaLesson, 'moduleTitle' | 'moduleDescription' | 'title' | 'videoUrl' | 'description'>
  >
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const now = new Date().toISOString();

  const patch: Record<string, any> = {
    ...updates,
    updatedAt: now,
  };
  if (typeof patch.videoUrl === 'string') {
    patch.videoUrl = normalizeUrl(patch.videoUrl);
  }

  await updateDoc(docRef, patch);

  const current = getLocalGuiaCache();
  const targetModuleTitle = patch.moduleTitle;
  const targetModuleDesc = patch.moduleDescription;

  if (targetModuleTitle && typeof targetModuleDesc === 'string') {
    const othersInModule = current.filter(
      i => i.moduleTitle === targetModuleTitle && i.id !== id
    );
    if (othersInModule.length > 0) {
      try {
        const batch = writeBatch(db);
        othersInModule.forEach(item => {
          batch.update(doc(db, COLLECTION_NAME, item.id), {
            moduleDescription: targetModuleDesc,
            updatedAt: now,
          });
        });
        await batch.commit();
      } catch (err) {
        console.warn('Falha ao sincronizar descrição do módulo:', err);
      }
    }
  }

  const updated = current.map(item => {
    if (item.id === id) return { ...item, ...patch };
    if (
      targetModuleTitle &&
      typeof targetModuleDesc === 'string' &&
      item.moduleTitle === targetModuleTitle
    ) {
      return { ...item, moduleDescription: targetModuleDesc, updatedAt: now };
    }
    return item;
  });
  setLocalGuiaCache(updated);
}

export async function updateGuiaModule(
  oldModuleTitle: string,
  updates: { moduleTitle: string; moduleDescription: string }
): Promise<void> {
  const newTitle = (updates.moduleTitle || '').trim() || oldModuleTitle;
  const newDesc = (updates.moduleDescription || '').trim();
  const now = new Date().toISOString();

  const current = getLocalGuiaCache();
  const moduleItems = current.filter(i => i.moduleTitle === oldModuleTitle);

  if (moduleItems.length > 0) {
    const batch = writeBatch(db);
    moduleItems.forEach(item => {
      batch.update(doc(db, COLLECTION_NAME, item.id), {
        moduleTitle: newTitle,
        moduleDescription: newDesc,
        updatedAt: now,
      });
    });
    await batch.commit();
  }

  const updated = current.map(item =>
    item.moduleTitle === oldModuleTitle
      ? {
          ...item,
          moduleTitle: newTitle,
          moduleDescription: newDesc,
          updatedAt: now,
        }
      : item
  );
  setLocalGuiaCache(updated);
}

export async function deleteGuiaLesson(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);

  const current = getLocalGuiaCache();
  setLocalGuiaCache(current.filter(i => i.id !== id));
}

/**
 * Converte links do YouTube, Vimeo, Google Drive ou Loom em URLs de embed quando possível
 */
export function getVideoEmbedInfo(rawUrl: string): {
  type: 'iframe' | 'video' | 'external' | 'none';
  embedUrl: string;
  originalUrl: string;
} {
  const url = String(rawUrl || '').trim();
  if (!url) {
    return { type: 'none', embedUrl: '', originalUrl: '' };
  }

  // YouTube watch?v= / youtu.be / shorts / embed
  const ytMatch = url.match(
    /(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/
  );
  if (ytMatch && ytMatch[1]) {
    return {
      type: 'iframe',
      embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}`,
      originalUrl: url,
    };
  }

  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch && vimeoMatch[1]) {
    return {
      type: 'iframe',
      embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}`,
      originalUrl: url,
    };
  }

  // Google Drive file/d/ID (somente se não for /spreadsheets/ ou /document/ ou /forms/)
  const driveMatch = url.match(/drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/);
  if (driveMatch && driveMatch[1]) {
    return {
      type: 'iframe',
      embedUrl: `https://drive.google.com/file/d/${driveMatch[1]}/preview`,
      originalUrl: url,
    };
  }

  // Loom share/ID
  const loomMatch = url.match(/loom\.com\/share\/([a-zA-Z0-9_-]+)/);
  if (loomMatch && loomMatch[1]) {
    return {
      type: 'iframe',
      embedUrl: `https://www.loom.com/embed/${loomMatch[1]}`,
      originalUrl: url,
    };
  }

  // Direct video file (.mp4, .webm, .ogg)
  if (/\.(mp4|webm|ogg)(\?.*)?$/i.test(url)) {
    return {
      type: 'video',
      embedUrl: url,
      originalUrl: url,
    };
  }

  return {
    type: 'external',
    embedUrl: url,
    originalUrl: url,
  };
}
