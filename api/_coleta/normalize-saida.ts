import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import {
  batchCommitWritesRest,
  getDocRest,
  listDocsRest,
  patchDocRest,
} from '../_lib/firestore-rest';
import { cycleKey, resolveCanonicalListaSaida } from '../_lib/lista-saida';
import { sendError, sendSuccess } from '../_lib/response';
import { logApi } from '../_lib/logger';

async function normalizeWithAdmin(listaId: string) {
  const { db } = adminDb;
  const listaRef = db.collection('coleta_listas').doc(listaId);
  const listaSnap = await listaRef.get();

  if (!listaSnap.exists) {
    throw new Error('LISTA_NOT_FOUND');
  }

  const listaData = listaSnap.data() || {};
  const targetSaida = resolveCanonicalListaSaida(listaData);
  const targetKey = cycleKey(targetSaida);
  const knownTotal = Number(listaData.totalItens || 0);
  const syncedValue = String(listaData.saidaItensSincronizadaValor || '').trim();
  const syncedTotal = Number(listaData.saidaItensSincronizadaTotal ?? -1);
  const metadataNeedsRepair = cycleKey(listaData.saidaPadrao) !== targetKey;

  // Se tudo já está sincronizado e o metadado também está correto, não relê milhares de itens.
  if (
    !metadataNeedsRepair &&
    cycleKey(syncedValue) === targetKey &&
    syncedTotal === knownTotal &&
    knownTotal >= 0
  ) {
    return {
      listaId,
      saida: targetSaida,
      corrected: 0,
      total: knownTotal,
      skipped: true,
      metadataRepaired: false,
    };
  }

  const itemsSnap = await listaRef.collection('itens').get();
  const mismatched = itemsSnap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return cycleKey(data.saida) !== targetKey;
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < mismatched.length; i += CHUNK_SIZE) {
    const chunk = mismatched.slice(i, i + CHUNK_SIZE);
    const batch = db.batch();
    chunk.forEach((docSnap) => {
      batch.set(
        docSnap.ref,
        {
          saida: targetSaida,
          updatedAt: FieldValue.serverTimestamp(),
        },
        { merge: true }
      );
    });
    await batch.commit();
  }

  const total = itemsSnap.size;
  await listaRef.set(
    {
      saidaPadrao: targetSaida,
      totalItens: total,
      saidasCount: total > 0 ? { [targetSaida]: total } : {},
      saidaItensSincronizadaValor: targetSaida,
      saidaItensSincronizadaTotal: total,
      saidaItensSincronizadaAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    },
    { merge: true }
  );

  return {
    listaId,
    saida: targetSaida,
    corrected: mismatched.length,
    total,
    skipped: false,
    metadataRepaired: metadataNeedsRepair,
  };
}

async function normalizeWithRest(listaId: string) {
  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (!listaData) {
    throw new Error('LISTA_NOT_FOUND');
  }

  const targetSaida = resolveCanonicalListaSaida(listaData);
  const targetKey = cycleKey(targetSaida);
  const knownTotal = Number(listaData.totalItens || 0);
  const syncedValue = String(listaData.saidaItensSincronizadaValor || '').trim();
  const syncedTotal = Number(listaData.saidaItensSincronizadaTotal ?? -1);
  const metadataNeedsRepair = cycleKey(listaData.saidaPadrao) !== targetKey;

  if (
    !metadataNeedsRepair &&
    cycleKey(syncedValue) === targetKey &&
    syncedTotal === knownTotal &&
    knownTotal >= 0
  ) {
    return {
      listaId,
      saida: targetSaida,
      corrected: 0,
      total: knownTotal,
      skipped: true,
      metadataRepaired: false,
    };
  }

  const allItems: Array<{ id: string; [key: string]: any }> = [];
  let pageToken: string | undefined;
  do {
    const page = await listDocsRest(`coleta_listas/${listaId}/itens`, 300, pageToken);
    allItems.push(...page.documents);
    pageToken = page.nextPageToken;
  } while (pageToken);

  const mismatched = allItems.filter((item) => cycleKey(item.saida) !== targetKey);
  const writes = mismatched.map((item) => ({
    type: 'update' as const,
    docPath: `coleta_listas/${listaId}/itens/${item.id}`,
    data: {
      saida: targetSaida,
      updatedAt: new Date().toISOString(),
    },
    updateMask: ['saida', 'updatedAt'],
  }));

  if (writes.length > 0) {
    const ok = await batchCommitWritesRest(writes);
    if (!ok) {
      throw new Error('Falha ao normalizar saída dos itens via REST');
    }
  }

  const total = allItems.length;
  await patchDocRest(
    `coleta_listas/${listaId}`,
    {
      saidaPadrao: targetSaida,
      totalItens: total,
      saidasCount: total > 0 ? { [targetSaida]: total } : {},
      saidaItensSincronizadaValor: targetSaida,
      saidaItensSincronizadaTotal: total,
      saidaItensSincronizadaAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    [
      'saidaPadrao',
      'totalItens',
      'saidasCount',
      'saidaItensSincronizadaValor',
      'saidaItensSincronizadaTotal',
      'saidaItensSincronizadaAt',
      'updatedAt',
    ]
  );

  return {
    listaId,
    saida: targetSaida,
    corrected: mismatched.length,
    total,
    skipped: false,
    metadataRepaired: metadataNeedsRepair,
  };
}

export default async function handler(req: any, res: any) {
  const startTime = Date.now();

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const listaId = String(req.body?.listaId || '').trim();
  if (!listaId) {
    return sendError(res, 400, 'INVALID_LISTA_ID', 'listaId é obrigatório');
  }

  try {
    const result = isFirebaseAdminConfigured()
      ? await normalizeWithAdmin(listaId)
      : await normalizeWithRest(listaId);

    logApi('info', 'Saída da lista normalizada', {
      endpoint: '/api/coleta/normalize-saida',
      listaId,
      corrected: result.corrected,
      total: result.total,
      saida: result.saida,
      metadataRepaired: result.metadataRepaired,
      durationMs: Date.now() - startTime,
    });

    return sendSuccess(res, result);
  } catch (error: any) {
    if (error?.message === 'LISTA_NOT_FOUND') {
      return sendError(res, 404, 'LISTA_NOT_FOUND', 'Lista de coleta não encontrada');
    }

    logApi('error', 'Falha ao normalizar saída da lista', {
      endpoint: '/api/coleta/normalize-saida',
      listaId,
      error: error?.message,
      durationMs: Date.now() - startTime,
    });

    return sendError(
      res,
      500,
      'NORMALIZE_SAIDA_FAILED',
      'Erro ao corrigir a saída dos itens da lista',
      error?.message
    );
  }
}
