import {
  collection,
  doc,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase-core';

export interface SavedCode {
  id: string;
  title: string;
  code: string;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
}

const COLLECTION_NAME = 'saved_codes';
const LOCAL_STORAGE_KEY = 'ecooy_saved_codes_cache';

// Helper de persistência local para carregamento instantâneo (0ms)
export function getLocalCodesCache(): SavedCode[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed: SavedCode[] = JSON.parse(raw);
    // Remove qualquer exemplo anterior
    return parsed.filter(i => i.createdBy !== 'Sistema' && i.title !== 'Template Tabela Operacional' && i.title !== 'Card de Aviso Galpão');
  } catch {
    return [];
  }
}

export function setLocalCodesCache(items: SavedCode[]) {
  try {
    const cleanItems = items.filter(i => i.createdBy !== 'Sistema' && i.title !== 'Template Tabela Operacional' && i.title !== 'Card de Aviso Galpão');
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(cleanItems));
  } catch {}
}

/**
 * Escuta em tempo real apenas os códigos criados pelo usuário (sem exemplos)
 */
export function listenToSavedCodes(
  onUpdate: (codes: SavedCode[]) => void,
  onError?: (error: Error) => void
): () => void {
  // Limpa qualquer cache de seed anterior
  try {
    localStorage.removeItem('ecooy_codes_seeded_v1');
  } catch {}

  const cached = getLocalCodesCache();
  if (cached.length > 0) {
    onUpdate(cached);
  } else {
    onUpdate([]);
  }

  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const items: SavedCode[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          // Ignora códigos que eram exemplos automáticos
          if (data.createdBy === 'Sistema' || data.title === 'Template Tabela Operacional' || data.title === 'Card de Aviso Galpão') {
            // Se existir no Firestore, tenta deletar em segundo plano
            try {
              deleteDoc(doc(db, COLLECTION_NAME, docSnap.id)).catch(() => {});
            } catch {}
            return;
          }

          items.push({
            id: docSnap.id,
            title: data.title || 'Código',
            code: data.code || '',
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            createdBy: data.createdBy || '',
          });
        });

        setLocalCodesCache(items);
        onUpdate(items);
      },
      error => {
        console.warn('Erro ao sincronizar saved_codes do Firestore:', error);
        if (onError) onError(error);
      }
    );
    return unsubscribe;
  } catch (err: any) {
    console.warn('Falha ao iniciar listener de saved_codes:', err);
    if (onError) onError(err);
    return () => {};
  }
}

/**
 * Salva um novo código criado pelo usuário
 */
export async function createSavedCode(params: {
  title: string;
  code: string;
  createdBy?: string;
}): Promise<SavedCode> {
  const code = (params.code || '').trim();
  if (!code) {
    throw new Error('O código não pode estar vazio.');
  }

  const title = (params.title || '').trim() || 'Código';
  const id = `code-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const now = new Date().toISOString();

  const newCodeItem: SavedCode = {
    id,
    title,
    code,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy || 'Usuário',
  };

  const docRef = doc(db, COLLECTION_NAME, id);
  await setDoc(docRef, newCodeItem);

  const current = getLocalCodesCache();
  const updated = [newCodeItem, ...current.filter(i => i.id !== id)];
  setLocalCodesCache(updated);

  return newCodeItem;
}

/**
 * Atualiza um código existente
 */
export async function updateSavedCode(
  id: string,
  updates: Partial<Pick<SavedCode, 'title' | 'code'>>
): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  const now = new Date().toISOString();

  const patch: Record<string, any> = {
    ...updates,
    updatedAt: now,
  };

  await updateDoc(docRef, patch);

  const current = getLocalCodesCache();
  const updated = current.map(item => {
    if (item.id === id) {
      return { ...item, ...patch };
    }
    return item;
  });
  setLocalCodesCache(updated);
}

/**
 * Exclui um código
 */
export async function deleteSavedCode(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);

  const current = getLocalCodesCache();
  setLocalCodesCache(current.filter(i => i.id !== id));
}
