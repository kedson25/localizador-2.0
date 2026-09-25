import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import {
  batchCommitWritesRest,
  getDocRest,
  listDocsRest,
  patchDocRest,
} from '../_lib/firestore-rest';
import {
  canonicalSaidaForCycle,
  cycleKey,
  resolveCanonicalListaSaida,
  rewriteListaNameCycle,
} from '../_lib/lista-saida';
import { sendError, sendSuccess } from '../_lib/response';
import { logApi } from '../_lib/logger';

function resolveRequestedSaida(value: unknown): string {
  const cycle = cycleKey(value);
  return cycle ? canonicalSaidaForCycle(cycle) : '';
}

async function normalizeWithAdmin(
  listaId: string,
  force = false,
  requestedSaida = '',
  updateName = false
) {
  const { db } = adminDb;
  const listaRef = db.collection('coleta_listas').doc(listaId);
  const listaSnap = await listaRef.get();

  if (!listaSnap.exists) throw new Error('LISTA_NOT_FOUND');

  const listaData = listaSnap.data() || {};
  const targetSaida = requestedSaida || resolveCanonicalListaSaida(listaData);
  const targetKey = cycleKey(targetSaida);
  const knownTotal = Number(listaData.totalItens || 0);
  const syncedValue = String(listaData.saidaItensSincronizadaValor || '').trim();
  const syncedTotal = Number(listaData.saidaItensSincronizadaTotal ?? -1);
  const metadataNeedsRepair = cycleKey(listaData.saidaPadrao) !== targetKey;

  const currentName = String(listaData.nome || '').trim();
  const nextName = updateName && targetKey
    ? rewriteListaNameCycle(currentName, targetKey)
    : currentName;
  const nameNeedsRepair = Boolean(updateName && nextName && nextName !== currentName);

  if (
    !force &&
    !metadataNeedsRepair &&
    !nameNeedsRepair &&
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
      nameRepaired: false,
    };
  }

  const itemsSnap = await listaRef.collection('itens').get();
  const mismatched = itemsSnap.docs.filter((docSnap) => {
    const data = docSnap.data() || {};
    return cycleKey(data.saida) !== targetKey;
  });

  const CHUNK_SIZE = 400;
  for (let i = 0; i < mismatched.length; i += CHUNK_SIZE) {
    const batch = db.batch();
    mismatched.slice(i, i + CHUNK_SIZE).forEach((docSnap) => {
      batch.set(
        docSnap.ref,
        { saida: targetSaida, updatedAt: FieldValue.serverTimestamp() },
        { merge: true }
      );
    });
    await batch.commit();
  }

  const total = itemsSnap.size;
  await listaRef.set(
    {
      saidaPadrao: targetSaida,
      ...(nameNeedsRepair ? { nome: nextName } : {}),
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
    nameRepaired: nameNeedsRepair,
  };
}

async function normalizeWithRest(
  listaId: string,
  force = false,
  requestedSaida = '',
  updateName = false
) {
  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (!listaData) throw new Error('LISTA_NOT_FOUND');

  const targetSaida = requestedSaida || resolveCanonicalListaSaida(listaData);
  const targetKey = cycleKey(targetSaida);
  const knownTotal = Number(listaData.totalItens || 0);
  const syncedValue = String(listaData.saidaItensSincronizadaValor || '').trim();
  const syncedTotal = Number(listaData.saidaItensSincronizadaTotal ?? -1);
  const metadataNeedsRepair = cycleKey(listaData.saidaPadrao) !== targetKey;

  const currentName = String(listaData.nome || '').trim();
  const nextName = updateName && targetKey
    ? rewriteListaNameCycle(currentName, targetKey)
    : currentName;
  const nameNeedsRepair = Boolean(updateName && nextName && nextName !== currentName);

  if (
    !force &&
    !metadataNeedsRepair &&
    !nameNeedsRepair &&
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
      nameRepaired: false,
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
    data: { saida: targetSaida, updatedAt: new Date().toISOString() },
    updateMask: ['saida', 'updatedAt'],
  }));

  if (writes.length > 0) {
    const ok = await batchCommitWritesRest(writes);
    if (!ok) throw new Error('Falha ao normalizar saída dos itens via REST');
  }

  const total = allItems.length;
  const parentData = {
    saidaPadrao: targetSaida,
    ...(nameNeedsRepair ? { nome: nextName } : {}),
    totalItens: total,
    saidasCount: total > 0 ? { [targetSaida]: total } : {},
    saidaItensSincronizadaValor: targetSaida,
    saidaItensSincronizadaTotal: total,
    saidaItensSincronizadaAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const updateMask = [
    'saidaPadrao',
    ...(nameNeedsRepair ? ['nome'] : []),
    'totalItens',
    'saidasCount',
    'saidaItensSincronizadaValor',
    'saidaItensSincronizadaTotal',
    'saidaItensSincronizadaAt',
    'updatedAt',
  ];

  await patchDocRest(`coleta_listas/${listaId}`, parentData, updateMask);

  return {
    listaId,
    saida: targetSaida,
    corrected: mismatched.length,
    total,
    skipped: false,
    metadataRepaired: metadataNeedsRepair,
    nameRepaired: nameNeedsRepair,
  };
}

export default async function handler(req: any, res: any) {
  const startTime = Date.now();

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const listaId = String(req.body?.listaId || '').trim();
  const force = req.body?.force === true;
  const updateName = req.body?.updateName === true;
  const rawTargetSaida = String(req.body?.targetSaida || '').trim();
  const requestedSaida = resolveRequestedSaida(rawTargetSaida);

  if (!listaId) {
    return sendError(res, 400, 'INVALID_LISTA_ID', 'listaId é obrigatório');
  }

  if (rawTargetSaida && !requestedSaida) {
    return sendError(res, 400, 'INVALID_SAIDA', 'targetSaida deve ser AM, PM ou SD');
  }

  try {
    const result = isFirebaseAdminConfigured()
      ? await normalizeWithAdmin(listaId, force, requestedSaida, updateName)
      : await normalizeWithRest(listaId, force, requestedSaida, updateName);

    logApi('info', 'Saída da lista normalizada', {
      endpoint: '/api/coleta/normalize-saida',
      listaId,
      corrected: result.corrected,
      total: result.total,
      saida: result.saida,
      metadataRepaired: result.metadataRepaired,
      nameRepaired: result.nameRepaired,
      force,
      requestedSaida: requestedSaida || undefined,
      updateName,
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
