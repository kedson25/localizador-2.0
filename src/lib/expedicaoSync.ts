import {
  collection,
  doc,
  getDocs,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase-core';
import type {
  BaseDespachoRow,
  ExpedicaoDocaChange,
  ExpedicaoEncerramento,
  ExpedicaoImportacao,
  ExpedicaoRow,
  ExpedicaoStore,
  FonteImportacaoExpedicao,
} from './expedicao';

const META_COLLECTION = 'expedicao_sync';
const META_DOC_ID = 'current';
const SOURCE_COLLECTION = 'expedicao_sync_sources';
const CHUNK_SIZE = 250;
const BATCH_LIMIT = 400;

const metaRef = doc(db, META_COLLECTION, META_DOC_ID);

type SourceName = FonteImportacaoExpedicao;
type SourceRows = BaseDespachoRow[] | ExpedicaoRow[];

type SharedMeta = {
  version?: number;
  baseRevision?: string | null;
  aduanaRevision?: string | null;
  auditoriaRevision?: string | null;
  localizados?: Record<string, boolean>;
  ultimaComparacao?: ExpedicaoDocaChange[];
  ultimaImportacao?: ExpedicaoImportacao;
  filenames?: Partial<Record<SourceName, string>>;
  encerramentos?: ExpedicaoEncerramento[];
  updatedAtIso?: string;
};

export type ExpedicaoSharedStore = Pick<
  ExpedicaoStore,
  | 'base'
  | 'aduana'
  | 'auditoria'
  | 'localizados'
  | 'ultimaComparacao'
  | 'ultimaImportacao'
  | 'filenames'
  | 'encerramentos'
  | 'updatedAt'
>;

function safeJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function revisionFor(source: SourceName) {
  return `${source}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function compactRows(source: SourceName, rows: SourceRows): SourceRows {
  if (source === 'base') {
    return (rows as BaseDespachoRow[]).map(row => ({
      pacote: row.pacote,
      onda: row.onda,
      rotaOtimizada: row.rotaOtimizada,
      rotaOriginal: row.rotaOriginal,
      doca: row.doca,
      placa: row.placa,
    }));
  }

  return (rows as ExpedicaoRow[]).map(row => ({
    pacote: row.pacote,
    rotaInformada: row.rotaInformada,
    placaInformada: row.placaInformada,
    estado: row.estado,
    detalhe: row.detalhe,
    dataRegistro: row.dataRegistro,
    origem: row.origem,
    raw: {},
  }));
}

async function writeSource(source: SourceName, rows: SourceRows) {
  const revision = revisionFor(source);
  const compact = compactRows(source, rows);
  const chunks: SourceRows[] = [];

  for (let index = 0; index < compact.length; index += CHUNK_SIZE) {
    chunks.push(compact.slice(index, index + CHUNK_SIZE) as SourceRows);
  }

  const chunksRef = collection(db, SOURCE_COLLECTION, revision, 'chunks');
  let batch = writeBatch(db);
  let operations = 0;

  for (let index = 0; index < chunks.length; index += 1) {
    batch.set(doc(chunksRef, String(index).padStart(5, '0')), {
      index,
      rows: safeJson(chunks[index]),
    });
    operations += 1;

    if (operations >= BATCH_LIMIT) {
      await batch.commit();
      batch = writeBatch(db);
      operations = 0;
    }
  }

  if (operations > 0) {
    await batch.commit();
  }

  return revision;
}

async function readSource(source: SourceName, revision: string): Promise<SourceRows> {
  const snapshot = await getDocs(collection(db, SOURCE_COLLECTION, revision, 'chunks'));
  const chunks = snapshot.docs
    .map(item => item.data() as { index?: number; rows?: unknown[] })
    .sort((a, b) => Number(a.index || 0) - Number(b.index || 0));

  const rows = chunks.flatMap(chunk => Array.isArray(chunk.rows) ? chunk.rows : []);

  if (source === 'base') {
    return rows as BaseDespachoRow[];
  }

  return rows.map(row => ({
    ...(row as ExpedicaoRow),
    raw: (row as ExpedicaoRow).raw || {},
  })) as ExpedicaoRow[];
}

function sharedMetaPayload(store: ExpedicaoStore) {
  const payload: Record<string, unknown> = {
    version: 1,
    ultimaComparacao: safeJson((store.ultimaComparacao || []).slice(-500)),
    encerramentos: safeJson((store.encerramentos || []).slice(0, 20)),
    filenames: safeJson(store.filenames || {}),
    modifiedAt: serverTimestamp(),
  };

  if (store.ultimaImportacao) {
    payload.ultimaImportacao = safeJson(store.ultimaImportacao);
  }

  return payload;
}

export async function syncExpedicaoImport(store: ExpedicaoStore, source: SourceName): Promise<void> {
  const rows = store[source] as SourceRows;
  const revision = await writeSource(source, rows);
  const revisionField = `${source}Revision`;

  await setDoc(metaRef, {
    ...sharedMetaPayload(store),
    [revisionField]: revision,
    updatedAtIso: store.updatedAt || new Date().toISOString(),
  }, { merge: true });
}

export async function syncExpedicaoMeta(store: ExpedicaoStore): Promise<void> {
  await setDoc(metaRef, sharedMetaPayload(store), { merge: true });
}

export async function setExpedicaoSharedLocated(pacote: string, value: boolean): Promise<void> {
  const field = `localizados.${pacote}`;

  try {
    await updateDoc(metaRef, {
      [field]: value,
      modifiedAt: serverTimestamp(),
    });
  } catch {
    await setDoc(metaRef, {
      version: 1,
      localizados: { [pacote]: value },
      modifiedAt: serverTimestamp(),
    }, { merge: true });
  }
}

export async function resetExpedicaoShared(): Promise<void> {
  const now = new Date().toISOString();

  await setDoc(metaRef, {
    version: 1,
    baseRevision: null,
    aduanaRevision: null,
    auditoriaRevision: null,
    localizados: {},
    ultimaComparacao: [],
    filenames: {},
    encerramentos: [],
    updatedAtIso: now,
    modifiedAt: serverTimestamp(),
  });
}

export function listenExpedicaoShared(
  callback: (store: ExpedicaoSharedStore | null) => void,
  onError?: (error: unknown) => void,
): () => void {
  let active = true;
  let generation = 0;
  const revisions: Partial<Record<SourceName, string | null>> = {};
  const cache: {
    base: BaseDespachoRow[];
    aduana: ExpedicaoRow[];
    auditoria: ExpedicaoRow[];
  } = {
    base: [],
    aduana: [],
    auditoria: [],
  };

  const unsubscribe = onSnapshot(metaRef, async snapshot => {
    const currentGeneration = ++generation;

    if (!snapshot.exists()) {
      callback(null);
      return;
    }

    const data = snapshot.data() as SharedMeta;

    try {
      for (const source of ['base', 'aduana', 'auditoria'] as const) {
        const revision = data[`${source}Revision` as keyof SharedMeta] as string | null | undefined;
        const normalizedRevision = revision || null;

        if (revisions[source] === normalizedRevision) continue;

        if (!normalizedRevision) {
          cache[source] = [] as never;
          revisions[source] = null;
          continue;
        }

        const rows = await readSource(source, normalizedRevision);
        if (!active || currentGeneration !== generation) return;

        if (source === 'base') cache.base = rows as BaseDespachoRow[];
        if (source === 'aduana') cache.aduana = rows as ExpedicaoRow[];
        if (source === 'auditoria') cache.auditoria = rows as ExpedicaoRow[];
        revisions[source] = normalizedRevision;
      }

      if (!active || currentGeneration !== generation) return;

      callback({
        base: cache.base,
        aduana: cache.aduana,
        auditoria: cache.auditoria,
        localizados: data.localizados || {},
        ultimaComparacao: data.ultimaComparacao || [],
        ultimaImportacao: data.ultimaImportacao,
        filenames: data.filenames || {},
        encerramentos: data.encerramentos || [],
        updatedAt: data.updatedAtIso || '',
      });
    } catch (error) {
      console.error('[Expedição Sync] falha ao carregar estado compartilhado:', error);
      onError?.(error);
    }
  }, error => {
    console.error('[Expedição Sync] listener indisponível:', error);
    onError?.(error);
  });

  return () => {
    active = false;
    generation += 1;
    unsubscribe();
  };
}
