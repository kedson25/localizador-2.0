import fs from 'fs';
import path from 'path';
import { cleanDigits, getDeterministicItemId, normalizeCodigo } from './id';

function getAppletConfig(): Record<string, any> | null {
  try {
    const configPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
    if (fs.existsSync(configPath)) {
      const raw = fs.readFileSync(configPath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (_) {}
  return null;
}

const appletConfig = getAppletConfig();

export const FIREBASE_PROJECT_ID =
  process.env.FIREBASE_PROJECT_ID ||
  process.env.GOOGLE_PROJECT_ID ||
  appletConfig?.projectId ||
  process.env.VITE_FIREBASE_PROJECT_ID ||
  'gen-lang-client-0559227827';

export const FIRESTORE_DATABASE_ID =
  process.env.FIRESTORE_DATABASE_ID ||
  appletConfig?.firestoreDatabaseId ||
  'ai-studio-localizador20-a047a96e-6aee-4898-bd0c-4a2179a78d15';

export const FIREBASE_API_KEY =
  process.env.FIREBASE_API_KEY ||
  process.env.VITE_FIREBASE_API_KEY ||
  appletConfig?.apiKey ||
  'AIzaSyDehI2KaCf1zfRuBrfAlMdX8BPcCc7hX1Q';

export const BASE_URL = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents`;

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
    const cleanPath = docPath.replace(/^\/+/, '');
    const url = `${BASE_URL}/${cleanPath}?key=${FIREBASE_API_KEY}`;
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Firestore REST] Erro GET ${cleanPath}: ${res.status}`, errText);
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
  const cleanPath = docPath.replace(/^\/+/, '');
  let url = `${BASE_URL}/${cleanPath}?key=${FIREBASE_API_KEY}`;
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
    throw new Error(`Firestore REST PATCH ${cleanPath} falhou (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const parsed = fromFirestoreFields(data.fields || {});
  const parts = (data.name || '').split('/');
  parsed.id = parts[parts.length - 1];
  return parsed;
}

export async function setDocRest(
  docPath: string,
  fields: Record<string, any>
): Promise<Record<string, any>> {
  return patchDocRest(docPath, fields);
}

export async function deleteDocRest(docPath: string): Promise<boolean> {
  const cleanPath = docPath.replace(/^\/+/, '');
  const url = `${BASE_URL}/${cleanPath}?key=${FIREBASE_API_KEY}`;
  const res = await fetch(url, { method: 'DELETE' });
  return res.ok;
}

export async function listDocsRest(
  collectionPath: string,
  pageSize = 300,
  pageToken?: string
): Promise<{ documents: Array<{ id: string; [key: string]: any }>; nextPageToken?: string }> {
  try {
    const cleanPath = collectionPath.replace(/^\/+/, '');
    let url = `${BASE_URL}/${cleanPath}?pageSize=${pageSize}&key=${FIREBASE_API_KEY}`;
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
  } catch (err) {
    console.error(`[Firestore REST] Erro listDocsRest ${collectionPath}:`, err);
    return { documents: [] };
  }
}

export async function runQueryRest(
  collectionId: string,
  options: {
    parent?: string;
    orderByField?: string;
    orderDirection?: 'ASCENDING' | 'DESCENDING';
    limit?: number;
    filters?: Array<{ field: string; op: 'EQUAL' | 'GREATER_THAN' | 'LESS_THAN'; value: any }>;
  } = {}
): Promise<Array<{ id: string; [key: string]: any }>> {
  try {
    const parentPath = options.parent ? `${BASE_URL}/${options.parent.replace(/^\/+/, '')}` : BASE_URL;
    const url = `${parentPath}:runQuery?key=${FIREBASE_API_KEY}`;

    const structuredQuery: any = {
      from: [{ collectionId }],
    };

    if (options.orderByField) {
      structuredQuery.orderBy = [
        {
          field: { fieldPath: options.orderByField },
          direction: options.orderDirection || 'ASCENDING',
        },
      ];
    }

    if (options.limit) {
      structuredQuery.limit = options.limit;
    }

    if (options.filters && options.filters.length > 0) {
      if (options.filters.length === 1) {
        const f = options.filters[0];
        structuredQuery.where = {
          fieldFilter: {
            field: { fieldPath: f.field },
            op: f.op,
            value: toFirestoreValue(f.value),
          },
        };
      } else {
        structuredQuery.where = {
          compositeFilter: {
            op: 'AND',
            filters: options.filters.map((f) => ({
              fieldFilter: {
                field: { fieldPath: f.field },
                op: f.op,
                value: toFirestoreValue(f.value),
              },
            })),
          },
        };
      }
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ structuredQuery }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.warn(`[Firestore REST] Erro runQuery ${collectionId}:`, errText);
      return [];
    }

    const rows = await res.json();
    if (!Array.isArray(rows)) return [];

    const documents: any[] = [];
    for (const row of rows) {
      if (row.document && row.document.fields) {
        const parsed = fromFirestoreFields(row.document.fields);
        const parts = (row.document.name || '').split('/');
        parsed.id = parts[parts.length - 1];
        documents.push(parsed);
      }
    }

    return documents;
  } catch (err) {
    console.error(`[Firestore REST] runQueryRest falhou para ${collectionId}:`, err);
    return [];
  }
}

export async function batchCommitWritesRest(
  writes: Array<{
    type: 'set' | 'update' | 'delete';
    docPath: string;
    data?: Record<string, any>;
    updateMask?: string[];
  }>
): Promise<boolean> {
  if (writes.length === 0) return true;

  const url = `${BASE_URL}:commit?key=${FIREBASE_API_KEY}`;
  const writePayloads = writes.map((w) => {
    const cleanPath = w.docPath.replace(/^\/+/, '');
    const docName = `projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${cleanPath}`;

    if (w.type === 'delete') {
      return { delete: docName };
    }

    const payload: any = {
      update: {
        name: docName,
        fields: toFirestoreFields(w.data || {}),
      },
    };

    if (w.updateMask && w.updateMask.length > 0) {
      payload.updateMask = { fieldPaths: w.updateMask };
    }

    return payload;
  });

  // Executa em lotes de no máximo 250 writes por requisição
  const CHUNK_SIZE = 250;
  for (let i = 0; i < writePayloads.length; i += CHUNK_SIZE) {
    const chunk = writePayloads.slice(i, i + CHUNK_SIZE);
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ writes: chunk }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error(`[Firestore REST] Commit batch falhou (${res.status}):`, errText);
      throw new Error(`Erro ao salvar dados no Firestore: ${errText}`);
    }
  }

  return true;
}

// Helpers para Coleta de Bip
export interface BipParams {
  listaId: string;
  codigo: string;
  saida?: string;
  motivo?: string;
  rota?: string;
  responsavel?: string;
  grupoId?: string;
}

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

  const listaData = await getDocRest(`coleta_listas/${listaId}`);
  if (!listaData) {
    throw new Error('LISTA_NOT_FOUND');
  }

  const targetSaida = saida || listaData.saidaPadrao || 'Ciclo 2 - Saída PM';
  const targetMotivo = motivo || listaData.motivoPadrao || 'Pendente';
  const targetRota = rota || listaData.rota || 'Sem Rota';

  const existingItem = await getDocRest(`coleta_listas/${listaId}/itens/${docId}`);

  if (existingItem) {
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

    await patchDocRest(`coleta_listas/${listaId}/itens/${docId}`, updatedItem);

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

    await patchDocRest(`coleta_listas/${listaId}/itens/${docId}`, newItem);

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
