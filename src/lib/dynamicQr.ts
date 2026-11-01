import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  increment,
  query,
  orderBy,
} from 'firebase/firestore';
import { db } from './firebase-core';

export interface DynamicQr {
  id: string;
  code: string;
  title: string;
  description?: string;
  targetUrl: string;
  category?: string;
  status: 'active' | 'paused';
  scansCount: number;
  lastScannedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  createdBy?: string;
  fgColor?: string;
  bgColor?: string;
}

const COLLECTION_NAME = 'dynamic_qrs';
const LOCAL_STORAGE_KEY = 'ecooy_dynamic_qrs_cache';

// Helper de persistência local para fallback instantâneo
function getLocalCache(): DynamicQr[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function setLocalCache(items: DynamicQr[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(items));
  } catch {}
}

// Gera um código curto amigável e único (ex: qr-7x2a)
export function generateShortCode(length = 6): string {
  const chars = '23456789abcdefghjkmnpqrstuvwxyz';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Normaliza URL garantindo protocolo se for endereço web, ou preserva links especiais
export function normalizeUrl(url: string): string {
  const trimmed = (url || '').trim();
  if (!trimmed) return '';
  if (/^(https?:\/\/|mailto:|tel:|sms:|whatsapp:\/\/)/i.test(trimmed)) {
    return trimmed;
  }
  // Se contiver ponto ou barra, assume protocolo web https://
  if (trimmed.includes('.') || trimmed.includes('/')) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

// Retorna a URL direta do QR Code (100% sem ponte / sem intermediário)
export function getDirectQrUrl(targetUrl: string): string {
  return normalizeUrl(targetUrl);
}

// Helper mantido por compatibilidade
export function getPermanentQrUrl(code: string): string {
  const origin = typeof window !== 'undefined' && window.location?.origin
    ? window.location.origin
    : 'https://ecooy.app';
  return `${origin}/qr/${code}`;
}

/**
 * Escuta em tempo real os QR codes dinâmicos cadastrados
 */
export function listenToDynamicQrs(
  onUpdate: (qrs: DynamicQr[]) => void,
  onError?: (error: Error) => void
): () => void {
  // Dispara cache local imediatamente
  const cached = getLocalCache();
  if (cached.length > 0) {
    onUpdate(cached);
  }

  try {
    const q = query(collection(db, COLLECTION_NAME), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      snapshot => {
        const items: DynamicQr[] = [];
        snapshot.forEach(docSnap => {
          const data = docSnap.data();
          items.push({
            id: docSnap.id,
            code: data.code || docSnap.id,
            title: data.title || 'Sem título',
            description: data.description || '',
            targetUrl: data.targetUrl || '',
            category: data.category || 'Geral',
            status: data.status === 'paused' ? 'paused' : 'active',
            scansCount: Number(data.scansCount) || 0,
            lastScannedAt: data.lastScannedAt || null,
            createdAt: data.createdAt || new Date().toISOString(),
            updatedAt: data.updatedAt || new Date().toISOString(),
            createdBy: data.createdBy || '',
            fgColor: data.fgColor || '#0f172a',
            bgColor: data.bgColor || '#ffffff',
          });
        });

        if (items.length === 0 && !localStorage.getItem('ecooy_qr_seeded_v1')) {
          try {
            localStorage.setItem('ecooy_qr_seeded_v1', 'true');
            createDynamicQr({
              title: 'Tabela de Rotas e Despacho',
              targetUrl: 'https://docs.google.com/spreadsheets/',
              category: 'Operação',
              description: 'QR Code dinâmico fixado no galpão. Troque o link da planilha a qualquer momento sem reimprimir o código!',
              customCode: 'rotas-galpao',
              createdBy: 'Sistema',
            }).catch(() => {});
          } catch {}
          return;
        }

        setLocalCache(items);
        onUpdate(items);
      },
      error => {
        console.warn('Erro ao sincronizar dynamic_qrs do Firestore:', error);
        if (onError) onError(error);
      }
    );
    return unsubscribe;
  } catch (err: any) {
    console.warn('Falha ao iniciar listener de dynamic_qrs:', err);
    if (onError) onError(err);
    return () => {};
  }
}

/**
 * Cria um novo QR Code Dinâmico
 */
export async function createDynamicQr(params: {
  title: string;
  targetUrl: string;
  description?: string;
  category?: string;
  customCode?: string;
  createdBy?: string;
}): Promise<DynamicQr> {
  const normalizedTarget = normalizeUrl(params.targetUrl);
  if (!normalizedTarget) {
    throw new Error('URL de destino inválida.');
  }

  let code = (params.customCode || '').trim().toLowerCase();
  if (!code) {
    code = generateShortCode(6);
  } else {
    // Sanitizar slug
    code = code.replace(/[^a-z0-9_-]/g, '-').replace(/-+/g, '-');
  }

  const id = `qr-${code}`;
  const now = new Date().toISOString();

  const newQr: DynamicQr = {
    id,
    code,
    title: params.title.trim() || 'QR Code Dinâmico',
    description: params.description?.trim() || '',
    targetUrl: normalizedTarget,
    category: params.category?.trim() || 'Geral',
    status: 'active',
    scansCount: 0,
    lastScannedAt: null,
    createdAt: now,
    updatedAt: now,
    createdBy: params.createdBy || 'Sistema',
    fgColor: '#0f172a',
    bgColor: '#ffffff',
  };

  // Salva no Firestore
  const docRef = doc(db, COLLECTION_NAME, id);
  await setDoc(docRef, newQr);

  // Atualiza cache local
  const current = getLocalCache();
  const updated = [newQr, ...current.filter(item => item.id !== id)];
  setLocalCache(updated);

  return newQr;
}

/**
 * Atualiza o link de destino de um QR Code existente.
 * O QR Code físico e o link permanente permanecem exatamente os mesmos!
 */
export async function updateDynamicQrTarget(
  id: string,
  newTargetUrl: string,
  extraUpdates?: Partial<Pick<DynamicQr, 'title' | 'description' | 'category' | 'status'>>
): Promise<void> {
  const normalized = normalizeUrl(newTargetUrl);
  if (!normalized) {
    throw new Error('O novo link de destino não pode estar vazio.');
  }

  const docRef = doc(db, COLLECTION_NAME, id);
  const now = new Date().toISOString();

  const patch: Record<string, any> = {
    targetUrl: normalized,
    updatedAt: now,
    ...(extraUpdates || {}),
  };

  await updateDoc(docRef, patch);

  // Atualiza cache local
  const current = getLocalCache();
  const updated = current.map(item => {
    if (item.id === id) {
      return { ...item, ...patch };
    }
    return item;
  });
  setLocalCache(updated);
}

/**
 * Alterna status ativo / pausado
 */
export async function toggleDynamicQrStatus(id: string, currentStatus: 'active' | 'paused'): Promise<void> {
  const nextStatus = currentStatus === 'active' ? 'paused' : 'active';
  const docRef = doc(db, COLLECTION_NAME, id);
  const now = new Date().toISOString();

  await updateDoc(docRef, {
    status: nextStatus,
    updatedAt: now,
  });

  const current = getLocalCache();
  setLocalCache(current.map(i => i.id === id ? { ...i, status: nextStatus, updatedAt: now } : i));
}

/**
 * Exclui um QR Code Dinâmico
 */
export async function deleteDynamicQr(id: string): Promise<void> {
  const docRef = doc(db, COLLECTION_NAME, id);
  await deleteDoc(docRef);

  const current = getLocalCache();
  setLocalCache(current.filter(i => i.id !== id));
}

/**
 * Busca um QR Code pelo código/slug público (utilizado na tela de redirecionamento)
 */
export async function getDynamicQrByCode(code: string): Promise<DynamicQr | null> {
  const cleanCode = code.trim().toLowerCase();

  // Verifica cache local primeiro para resposta quase instantânea
  const localList = getLocalCache();
  const localMatch = localList.find(i => i.code.toLowerCase() === cleanCode || i.id === cleanCode || i.id === `qr-${cleanCode}`);
  
  try {
    // Tenta pelo id direto (qr-<code<)
    const directDocRef = doc(db, COLLECTION_NAME, `qr-${cleanCode}`);
    const directSnap = await getDoc(directDocRef);
    if (directSnap.exists()) {
      return directSnap.data() as DynamicQr;
    }

    // Se id foi o próprio code
    const altDocRef = doc(db, COLLECTION_NAME, cleanCode);
    const altSnap = await getDoc(altDocRef);
    if (altSnap.exists()) {
      return altSnap.data() as DynamicQr;
    }

    // Caso não encontre por id direto, busca todos os docs e filtra por code
    const allSnaps = await getDocs(collection(db, COLLECTION_NAME));
    let found: DynamicQr | null = null;
    allSnaps.forEach(snap => {
      const data = snap.data() as DynamicQr;
      if (data.code?.toLowerCase() === cleanCode || snap.id === cleanCode || snap.id === `qr-${cleanCode}`) {
        found = { ...data, id: snap.id };
      }
    });

    if (found) return found;
  } catch (err) {
    console.warn('Erro ao buscar QR Code no Firestore:', err);
  }

  return localMatch || null;
}

/**
 * Registra um escaneamento/clique no QR Code
 */
export async function recordQrScan(id: string): Promise<void> {
  try {
    const docRef = doc(db, COLLECTION_NAME, id);
    const now = new Date().toISOString();
    await updateDoc(docRef, {
      scansCount: increment(1),
      lastScannedAt: now,
    });
  } catch (err) {
    // Não interrompe o fluxo de redirecionamento do usuário se houver falha de métrica
    console.warn('Falha silenciosa ao registrar scan do QR:', err);
  }
}
