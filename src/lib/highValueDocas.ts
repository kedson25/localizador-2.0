import { collection, doc, getDocs, onSnapshot, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore';
import { db } from './firebase-core';
import type { HighValuePackage } from './highValueParser';

const COLLECTION = 'expedicao_alto_valor';
const CHUNK_SIZE = 200;
const metaRef = doc(db, COLLECTION, 'current');

export interface HighValueSnapshot {
  items: HighValuePackage[];
  filename: string;
  updatedAt: string;
}

export async function saveHighValuePackages(items: HighValuePackage[], filename: string): Promise<void> {
  const revision = `valores-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const chunks = collection(db, COLLECTION, revision, 'chunks');
  // Grava todos os chunks antes de publicar a revisão, sem expor importações parciais.
  let batch = writeBatch(db);
  let written = 0;
  for (let index = 0; index < items.length; index += CHUNK_SIZE) {
    batch.set(doc(chunks, String(index / CHUNK_SIZE).padStart(5, '0')), {
      index: index / CHUNK_SIZE, rows: items.slice(index, index + CHUNK_SIZE),
    });
    written += 1;
    if (written === 400) {
      await batch.commit();
      batch = writeBatch(db);
      written = 0;
    }
  }
  if (written) await batch.commit();
  await setDoc(metaRef, { revision, filename, count: items.length, updatedAt: new Date().toISOString(), modifiedAt: serverTimestamp() });
}

export function listenHighValuePackages(
  callback: (snapshot: HighValueSnapshot) => void,
  onError: (error: unknown) => void,
): () => void {
  let active = true;
  let generation = 0;
  const unsubscribe = onSnapshot(metaRef, async snapshot => {
    const request = ++generation;
    const data = snapshot.data();
    const revision = String(data?.revision || '');
    if (!revision) {
      callback({ items: [], filename: '', updatedAt: '' });
      return;
    }
    try {
      const result = await getDocs(collection(db, COLLECTION, revision, 'chunks'));
      if (!active || request !== generation) return;
      const items = result.docs
        .map(item => item.data() as { index: number; rows: HighValuePackage[] })
        .sort((a, b) => a.index - b.index)
        .flatMap(chunk => chunk.rows || []);
      if (data?.count !== items.length) throw new Error('CSV de alto valor incompleto na sincronização.');
      callback({ items, filename: String(data?.filename || ''), updatedAt: String(data?.updatedAt || '') });
    } catch (error) {
      if (active && request === generation) onError(error);
    }
  }, onError);
  return () => { active = false; generation += 1; unsubscribe(); };
}

export async function clearHighValuePackages(): Promise<void> {
  await setDoc(metaRef, { revision: null, filename: '', count: 0, updatedAt: new Date().toISOString(), modifiedAt: serverTimestamp() });
}
