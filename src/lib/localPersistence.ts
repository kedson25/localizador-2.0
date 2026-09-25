const DB_NAME = 'ecooy-local-cache';
const DB_VERSION = 1;
const STORE_NAME = 'cache';

const memoryFallback = new Map<string, unknown>();
const mutationChains = new Map<string, Promise<void>>();

function canUseIndexedDb(): boolean {
  return typeof window !== 'undefined' && typeof window.indexedDB !== 'undefined';
}

function safeClone<T>(value: T): T {
  try {
    return JSON.parse(JSON.stringify(value)) as T;
  } catch {
    return value;
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseIndexedDb()) {
      reject(new Error('IndexedDB indisponível'));
      return;
    }

    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Falha ao abrir IndexedDB'));
  });
}

export async function getLocalValue<T>(key: string): Promise<T | null> {
  if (!canUseIndexedDb()) {
    return (memoryFallback.get(key) as T | undefined) ?? null;
  }

  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);

      request.onsuccess = () => resolve((request.result as T | undefined) ?? null);
      request.onerror = () => reject(request.error || new Error('Falha ao ler cache local'));
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
      tx.onabort = () => db.close();
    });
  } catch (error) {
    console.warn('[LocalPersistence] leitura IndexedDB falhou, usando memória:', error);
    return (memoryFallback.get(key) as T | undefined) ?? null;
  }
}

export async function setLocalValue<T>(key: string, value: T): Promise<void> {
  const cloned = safeClone(value);
  memoryFallback.set(key, cloned);

  if (!canUseIndexedDb()) return;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(cloned, key);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Falha ao salvar cache local'));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Gravação local abortada'));
      };
    });
  } catch (error) {
    console.warn('[LocalPersistence] gravação IndexedDB falhou; cópia em memória preservada:', error);
  }
}

export async function deleteLocalValue(key: string): Promise<void> {
  memoryFallback.delete(key);

  if (!canUseIndexedDb()) return;

  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.delete(key);

      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        reject(tx.error || new Error('Falha ao remover cache local'));
      };
      tx.onabort = () => {
        db.close();
        reject(tx.error || new Error('Remoção local abortada'));
      };
    });
  } catch (error) {
    console.warn('[LocalPersistence] remoção IndexedDB falhou:', error);
  }
}

export async function mutateLocalValue<T>(
  key: string,
  mutator: (current: T | null) => T
): Promise<T> {
  const previous = mutationChains.get(key) || Promise.resolve();
  let nextValue!: T;

  const next = previous
    .catch(() => undefined)
    .then(async () => {
      const current = await getLocalValue<T>(key);
      nextValue = mutator(current);
      await setLocalValue(key, nextValue);
    });

  mutationChains.set(key, next);

  try {
    await next;
    return nextValue;
  } finally {
    if (mutationChains.get(key) === next) {
      mutationChains.delete(key);
    }
  }
}
