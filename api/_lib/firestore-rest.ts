import { cleanDigits, getDeterministicItemId, normalizeCodigo } from './id';

const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'ecooy-5b791';

const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  'AIzaSyCfpBmn3cdKP9vaGrDzKCB7oRPMSMx02tA';

const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export function toFirestoreValue(val: any): any {
  if (val === null || val === undefined) return { nullValue: null };
  if (typeof val === 'string') return { stringValue: val };
  if (typeof val === 'boolean') return { booleanValue: val };
  if (typeof val === 'number') {
    if (Number.isInteger(val)) return { integerValue: String(val) };
    return { doubleValue: val };
  }
  if (Array.isArray(val)) {
    return { arrayValue: { values: val.map(toFirestoreValue) } };
  }
  if (typeof val === 'object') {
    const fields: Record<string, any> = {};
    for (const [k, v] of Object.entries(val)) {
      if (v !== undefined) {
        fields[k] = toFirestoreValue(v);
      }
    }
    return { mapValue: { fields } };
  }
  return { stringValue: String(val) };
}

export function fromFirestoreValue(val: any): any {
  if (!val) return null;
  if (val.stringValue !== undefined) return val.stringValue;
  if (val.booleanValue !== undefined) return val.booleanValue;
  if (val.integerValue !== undefined) return parseInt(val.integerValue, 10);
  if (val.doubleValue !== undefined) return val.doubleValue;
  if (val.timestampValue !== undefined) return val.timestampValue;
  if (val.nullValue !== undefined) return null;
  if (val.arrayValue) {
    return (val.arrayValue.values || []).map(fromFirestoreValue);
  }
  if (val.mapValue) {
    const res: Record<string, any> = {};
    for (const [k, v] of Object.entries(val.mapValue.fields || {})) {
      res[k] = fromFirestoreValue(v);
    }
    return res;
  }
  return null;
}

export function toFirestoreFields(obj: Record<string, any>): Record<string, any> {
  const fields: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined) {
      fields[key] = toFirestoreValue(value);
    }
  }
  return fields;
}

export function fromFirestoreFields(fields: Record<string, any>): Record<string, any> {
  const result: Record<string, any> = {};
  for (const [key, value] of Object.entries(fields || {})) {
    result[key] = fromFirestoreValue(value);
  }
  return result;
}

export async function getDocRest(docPath: string): Promise<Record<string, any> | null> {
  try {
    const url = `${BASE_URL}/${docPath}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Firestore REST] Erro GET ${docPath}: ${res.status}`, errText);
      return null;
    }
    const data = await res.json();
    const parsed = fromFirestoreFields(data.fields || {});
    const parts = (data.name || '').split('/');
    parsed.id = parts[parts.length - 1];
    return parsed;
  } catch (err) {
    console.error(`[Firestore REST] Falha na requisição GET ${docPath}:`, err);
    return null;
  }
}

export async function patchDocRest(
  docPath: string,
  fields: Record<string, any>,
  updateMaskFieldPaths?: string[]
): Promise<Record<string, any>> {
  let url = `${BASE_URL}/${docPath}?key=${FIREBASE_API_KEY}`;
  if (updateMaskFieldPaths && updateMaskFieldPaths.length > 0) {
    const maskParams = updateMaskFieldPaths
      .map((p) => `updateMask.fieldPaths=${encodeURIComponent(p)}`)
      .join('&');
    url += `&${maskParams}`;
  }

  const payload = {
    fields: toFirestoreFields(fields),
  };

  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Firestore REST PATCH ${docPath} falhou (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const parsed = fromFirestoreFields(data.fields || {});
  const parts = (data.name || '').split('/');
  parsed.id = parts[parts.length - 1];
  return parsed;
}

export async function deleteDocRest(docPath: string): Promise<boolean> {
  const url = `${BASE_URL}/${docPath}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, { method: 'DELETE' });
  return res.ok;
}

export async function listDocsRest(
  collectionPath: string,
  pageSize = 100,
  pageToken?: string
): Promise<{ documents: Array<{ id: string; [key: string]: any }>; nextPageToken?: string }> {
  let url = `${BASE_URL}/${collectionPath}?pageSize=${pageSize}&key=${FIREBASE_API_KEY}`;
  if (pageToken) {
    url += `&pageToken=${encodeURIComponent(pageToken)}`;
  }

  const res = await fetch(url);
  if (!res.ok) return { documents: [] };
  const data = await res.json();

  const documents = (data.documents || []).map((doc: any) => {
    const parsed = fromFirestoreFields(doc.fields || {});
    const parts = (doc.name || '').split('/');
    parsed.id = parts[parts.length - 1];
    return parsed;
  });

  return {
    documents,
    nextPageToken: data.nextPageToken,
  };
}

export interface BipParams {
  listaId: string;
  codigo: string;
  saida?: string;
  motivo?: string;
  rota?: string;
  responsavel?: string;
  grupoId?: string;
}

/**
 * Executa o Bip via REST com consistência e sem necessidade de credenciais de Service Account
 */
export async function processBipRest(params: BipParams): Promise<{ item: any; isNew: boolean }> {
  const { listaId, codigo, saida, motivo, rota, responsavel, grupoId } = params;

  const cleanCode = normalizeCodigo(codigo);
  if (!cleanCode) {
    throw new Error('EMPTY_CODE');
  }

  const docId = getDeterministicItemId(cleanCode);
  const digitsOnly = cleanDigits(cleanCode);
  const operante = responsavel || 'Operador';
  const nowMs = Date.now();
  const nowBR = new Date().toLocaleString('pt-BR');

  // 1. Obter a lista pai
  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (!listaData) {
    throw new Error('LISTA_NOT_FOUND');
  }

  const targetSaida = saida || listaData.saidaPadrao || 'Ciclo 2 - Saída PM';
  const targetMotivo = motivo || listaData.motivoPadrao || 'Pendente';
  const targetRota = rota || listaData.rota || 'Sem Rota';

  // 2. Verificar se o item já existe
  const existingItem = await getDocRest(`coleta_listas/${listaId}/itens/${docId}`);

  if (existingItem) {
    // Atualização de item existente
    const prevSaida = existingItem.saida;
    const prevMotivo = existingItem.motivo;
    const prevOp = existingItem.responsavel;

    const updatedItem = {
      ...existingItem,
      codigo: cleanCode,
      codigoClean: digitsOnly,
      saida: targetSaida,
      motivo: targetMotivo,
      rota: targetRota,
      responsavel: operante,
      grupoId: grupoId !== undefined ? grupoId : existingItem.grupoId,
      scannedAt: nowBR,
      timestamp: nowMs,
      updatedAt: new Date().toISOString(),
    };

    // Grava item atualizado
    await patchDocRest(`coleta_listas/${listaId}/itens/${docId}`, updatedItem);

    // Ajusta contadores da lista pai se necessário
    const saidasCount = { ...(listaData.saidasCount || {}) };
    const motivosCount = { ...(listaData.motivosCount || {}) };
    const bipsPorOperador = { ...(listaData.bipsPorOperador || {}) };

    let countsChanged = false;

    if (prevSaida && prevSaida !== targetSaida) {
      saidasCount[prevSaida] = Math.max(0, (saidasCount[prevSaida] || 0) - 1);
      saidasCount[targetSaida] = (saidasCount[targetSaida] || 0) + 1;
      countsChanged = true;
    }
    if (prevMotivo && prevMotivo !== targetMotivo) {
      motivosCount[prevMotivo] = Math.max(0, (motivosCount[prevMotivo] || 0) - 1);
      motivosCount[targetMotivo] = (motivosCount[targetMotivo] || 0) + 1;
      countsChanged = true;
    }
    if (prevOp && prevOp !== operante) {
      bipsPorOperador[prevOp] = Math.max(0, (bipsPorOperador[prevOp] || 0) - 1);
      bipsPorOperador[operante] = (bipsPorOperador[operante] || 0) + 1;
      countsChanged = true;
    }

    const listaUpdates: Record<string, any> = {
      updatedAt: new Date().toISOString(),
    };
    const updateMask = ['updatedAt'];

    if (countsChanged) {
      listaUpdates.saidasCount = saidasCount;
      listaUpdates.motivosCount = motivosCount;
      listaUpdates.bipsPorOperador = bipsPorOperador;
      updateMask.push('saidasCount', 'motivosCount', 'bipsPorOperador');
    }

    patchDocRest(`coleta_listas/${listaId}`, listaUpdates, updateMask).catch((err) => {
      console.warn('[Bip REST] Falha ao atualizar contadores da lista pai:', err);
    });

    return {
      item: { ...updatedItem, id: docId },
      isNew: false,
    };
  } else {
    // Inserção de novo item
    const newItem = {
      id: docId,
      codigo: cleanCode,
      codigoClean: digitsOnly,
      rota: targetRota,
      saida: targetSaida,
      motivo: targetMotivo,
      scannedAt: nowBR,
      responsavel: operante,
      grupoId: grupoId || undefined,
      validado: false,
      timestamp: nowMs,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Grava novo item
    await patchDocRest(`coleta_listas/${listaId}/itens/${docId}`, newItem);

    // Incrementa contadores da lista pai
    const totalItens = (Number(listaData.totalItens) || 0) + 1;
    const saidasCount = { ...(listaData.saidasCount || {}) };
    saidasCount[targetSaida] = (saidasCount[targetSaida] || 0) + 1;

    const motivosCount = { ...(listaData.motivosCount || {}) };
    motivosCount[targetMotivo] = (motivosCount[targetMotivo] || 0) + 1;

    const bipsPorOperador = { ...(listaData.bipsPorOperador || {}) };
    bipsPorOperador[operante] = (bipsPorOperador[operante] || 0) + 1;

    const listaUpdates = {
      totalItens,
      saidasCount,
      motivosCount,
      bipsPorOperador,
      updatedAt: new Date().toISOString(),
    };

    patchDocRest(`coleta_listas/${listaId}`, listaUpdates, [
      'totalItens',
      'saidasCount',
      'motivosCount',
      'bipsPorOperador',
      'updatedAt',
    ]).catch((err) => {
      console.warn('[Bip REST] Falha ao incrementar contadores da lista pai:', err);
    });

    return {
      item: newItem,
      isNew: true,
    };
  }
}

/**
 * Atualiza item na lista via REST
 */
export async function updateItemRest(
  listaId: string,
  itemId: string,
  changes: Record<string, any>
): Promise<any> {
  const existing = await getDocRest(`coleta_listas/${listaId}/itens/${itemId}`);
  if (!existing) {
    throw new Error('ITEM_NOT_FOUND');
  }

  const updated = {
    ...existing,
    ...changes,
    updatedAt: new Date().toISOString(),
  };

  await patchDocRest(`coleta_listas/${listaId}/itens/${itemId}`, updated);

  // Atualizar métricas pai se necessário
  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (listaData) {
    const listaUpdates: Record<string, any> = { updatedAt: new Date().toISOString() };
    const mask = ['updatedAt'];

    if (changes.validado !== undefined && existing.validado !== changes.validado) {
      const currentValidados = Number(listaData.totalValidados) || 0;
      listaUpdates.totalValidados = Math.max(0, currentValidados + (changes.validado ? 1 : -1));
      mask.push('totalValidados');
    }

    if (changes.motivo && existing.motivo && existing.motivo !== changes.motivo) {
      const motivos = { ...(listaData.motivosCount || {}) };
      motivos[existing.motivo] = Math.max(0, (motivos[existing.motivo] || 0) - 1);
      motivos[changes.motivo] = (motivos[changes.motivo] || 0) + 1;
      listaUpdates.motivosCount = motivos;
      mask.push('motivosCount');
    }

    if (changes.saida && existing.saida && existing.saida !== changes.saida) {
      const saidas = { ...(listaData.saidasCount || {}) };
      saidas[existing.saida] = Math.max(0, (saidas[existing.saida] || 0) - 1);
      saidas[changes.saida] = (saidas[changes.saida] || 0) + 1;
      listaUpdates.saidasCount = saidas;
      mask.push('saidasCount');
    }

    if (mask.length > 1) {
      patchDocRest(`coleta_listas/${listaId}`, listaUpdates, mask).catch(() => {});
    }
  }

  return { ...updated, id: itemId };
}

/**
 * Exclui item na lista via REST
 */
export async function deleteItemRest(
  listaId: string,
  itemId: string
): Promise<{ deleted: boolean; itemId: string }> {
  const existing = await getDocRest(`coleta_listas/${listaId}/itens/${itemId}`);
  if (!existing) {
    return { deleted: true, itemId };
  }

  await deleteDocRest(`coleta_listas/${listaId}/itens/${itemId}`);

  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (listaData) {
    const totalItens = Math.max(0, (Number(listaData.totalItens) || 0) - 1);
    const listaUpdates: Record<string, any> = {
      totalItens,
      updatedAt: new Date().toISOString(),
    };
    const mask = ['totalItens', 'updatedAt'];

    if (existing.validado) {
      listaUpdates.totalValidados = Math.max(0, (Number(listaData.totalValidados) || 0) - 1);
      mask.push('totalValidados');
    }
    if (existing.responsavel && listaData.bipsPorOperador?.[existing.responsavel]) {
      const bips = { ...(listaData.bipsPorOperador || {}) };
      bips[existing.responsavel] = Math.max(0, (bips[existing.responsavel] || 0) - 1);
      listaUpdates.bipsPorOperador = bips;
      mask.push('bipsPorOperador');
    }
    if (existing.saida && listaData.saidasCount?.[existing.saida]) {
      const saidas = { ...(listaData.saidasCount || {}) };
      saidas[existing.saida] = Math.max(0, (saidas[existing.saida] || 0) - 1);
      listaUpdates.saidasCount = saidas;
      mask.push('saidasCount');
    }
    if (existing.motivo && listaData.motivosCount?.[existing.motivo]) {
      const motivos = { ...(listaData.motivosCount || {}) };
      motivos[existing.motivo] = Math.max(0, (motivos[existing.motivo] || 0) - 1);
      listaUpdates.motivosCount = motivos;
      mask.push('motivosCount');
    }

    patchDocRest(`coleta_listas/${listaId}`, listaUpdates, mask).catch(() => {});
  }

  return { deleted: true, itemId };
}
