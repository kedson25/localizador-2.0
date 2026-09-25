import type { IncomingMessage, ServerResponse } from 'http';
import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { getDocRest, processBipRest } from '../_lib/firestore-rest';
import { getServerSupabase } from '../_lib/supabase';
import { requireAuth, AuthError } from '../_lib/auth';
import { BipRequestSchema } from '../_lib/validation';
import { normalizeCodigo, cleanDigits, getDeterministicItemId } from '../_lib/id';
import { resolveCanonicalListaSaida } from '../_lib/lista-saida';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

async function resolveListaSaidaRest(listaId: string, fallback?: string): Promise<string> {
  try {
    const listaData = await getDocRest(`coleta_listas/${listaId}`);
    if (listaData) return resolveCanonicalListaSaida(listaData, fallback);
  } catch (error) {
    console.warn('[Bip] Não foi possível ler a saída oficial da lista via REST:', error);
  }
  return resolveCanonicalListaSaida(null, fallback);
}

export default async function handler(req: any, res: any) {
  const startTime = Date.now();

  if (req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  try {
    let user;
    try {
      user = await requireAuth(req);
    } catch (authErr: any) {
      const bodyUser = req.body?.responsavel || 'Operador';
      user = {
        uid: 'anon',
        displayName: bodyUser,
        isAdmin: false,
        isApproved: true,
        allowedGroups: ['listas'],
      };
    }

    const parseResult = BipRequestSchema.safeParse(req.body);
    if (!parseResult.success) {
      return sendError(
        res,
        400,
        'INVALID_PAYLOAD',
        'Dados do bip inválidos',
        parseResult.error.format()
      );
    }

    const { listaId, codigo, saida, motivo, rota, responsavel, grupoId } = parseResult.data;

    const cleanCode = normalizeCodigo(codigo);
    if (!cleanCode) {
      return sendError(res, 400, 'EMPTY_CODE', 'Código não pode ser vazio');
    }

    const docId = getDeterministicItemId(cleanCode);
    const digitsOnly = cleanDigits(cleanCode);
    const operante = responsavel || user.displayName || 'Operador';

    let result: { item: any; isNew: boolean };

    if (!isFirebaseAdminConfigured()) {
      const canonicalSaida = await resolveListaSaidaRest(listaId, saida);
      result = await processBipRest({
        listaId,
        codigo: cleanCode,
        saida: canonicalSaida,
        motivo,
        rota,
        responsavel: operante,
        grupoId,
      });
    } else {
      try {
        const { db } = adminDb;
        const listaRef = db.collection('coleta_listas').doc(listaId);
        const itemRef = listaRef.collection('itens').doc(docId);

        result = await db.runTransaction(async (transaction) => {
          const [listaSnap, itemSnap] = await Promise.all([
            transaction.get(listaRef),
            transaction.get(itemRef),
          ]);

          if (!listaSnap.exists) {
            throw new Error('LISTA_NOT_FOUND');
          }

          const listaData = listaSnap.data() || {};
          const nowMs = Date.now();
          const nowBR = new Date().toLocaleString('pt-BR');

          // O ciclo indicado pela identidade/nome da lista corrige metadados antigos inconsistentes.
          const targetSaida = resolveCanonicalListaSaida(listaData, saida);
          const targetMotivo = motivo || listaData.motivoPadrao || 'Pendente';
          const targetRota = rota || listaData.rota || 'Sem Rota';

          if (itemSnap.exists) {
            const prevItem = itemSnap.data() || {};
            const prevSaida = prevItem.saida;
            const prevMotivo = prevItem.motivo;
            const prevOp = prevItem.responsavel;

            const updatedItem = {
              ...prevItem,
              codigo: cleanCode,
              codigoClean: digitsOnly,
              saida: targetSaida,
              motivo: targetMotivo,
              rota: targetRota,
              responsavel: operante,
              grupoId: grupoId !== undefined ? grupoId : prevItem.grupoId,
              scannedAt: nowBR,
              timestamp: nowMs,
              updatedAt: FieldValue.serverTimestamp(),
            };

            transaction.set(itemRef, updatedItem, { merge: true });

            const listaUpdates: Record<string, any> = {
              saidaPadrao: targetSaida,
              updatedAt: FieldValue.serverTimestamp(),
            };

            if (prevSaida && prevSaida !== targetSaida) {
              listaUpdates[`saidasCount.${prevSaida}`] = FieldValue.increment(-1);
              listaUpdates[`saidasCount.${targetSaida}`] = FieldValue.increment(1);
            }
            if (prevMotivo && prevMotivo !== targetMotivo) {
              listaUpdates[`motivosCount.${prevMotivo}`] = FieldValue.increment(-1);
              listaUpdates[`motivosCount.${targetMotivo}`] = FieldValue.increment(1);
            }
            if (prevOp && prevOp !== operante) {
              listaUpdates[`bipsPorOperador.${prevOp}`] = FieldValue.increment(-1);
              listaUpdates[`bipsPorOperador.${operante}`] = FieldValue.increment(1);
            }

            transaction.set(listaRef, listaUpdates, { merge: true });

            return {
              item: { ...updatedItem, id: docId },
              isNew: false,
            };
          }

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
            createdAt: FieldValue.serverTimestamp(),
            updatedAt: FieldValue.serverTimestamp(),
          };

          transaction.set(itemRef, newItem);

          const listaUpdates: Record<string, any> = {
            saidaPadrao: targetSaida,
            totalItens: FieldValue.increment(1),
            [`bipsPorOperador.${operante}`]: FieldValue.increment(1),
            [`saidasCount.${targetSaida}`]: FieldValue.increment(1),
            [`motivosCount.${targetMotivo}`]: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
          };

          transaction.set(listaRef, listaUpdates, { merge: true });

          return {
            item: newItem,
            isNew: true,
          };
        });
      } catch (adminErr: any) {
        if (adminErr.message === 'LISTA_NOT_FOUND') {
          throw adminErr;
        }
        console.warn('[Bip] Falha no Admin SDK, tentando via Firestore REST:', adminErr.message);
        const canonicalSaida = await resolveListaSaidaRest(listaId, saida);
        result = await processBipRest({
          listaId,
          codigo: cleanCode,
          saida: canonicalSaida,
          motivo,
          rota,
          responsavel: operante,
          grupoId,
        });
      }
    }

    logApi('info', 'Bip executado com sucesso', {
      endpoint: '/api/coleta/bip',
      listaId,
      docId,
      isNew: result.isNew,
      durationMs: Date.now() - startTime,
    });

    const supabase = getServerSupabase();
    if (supabase) {
      try {
        await supabase.from('coleta_itens').upsert({
          id: result.item.id,
          lista_id: listaId,
          codigo: result.item.codigo,
          codigo_clean: result.item.codigoClean,
          rota: result.item.rota,
          saida: result.item.saida,
          motivo: result.item.motivo,
          scanned_at: result.item.scannedAt,
          responsavel: result.item.responsavel,
          grupo_id: result.item.grupoId || null,
          validado: Boolean(result.item.validado),
          timestamp: result.item.timestamp,
        });
      } catch (sbErr) {
        console.warn('[Supabase Sync] Falha ao sincronizar bip:', sbErr);
      }
    }

    return sendSuccess(res, result);
  } catch (err: any) {
    if (err.message === 'LISTA_NOT_FOUND') {
      return sendError(res, 404, 'LISTA_NOT_FOUND', 'Lista de coleta não encontrada');
    }

    logApi('error', 'Falha ao processar bip', {
      endpoint: '/api/coleta/bip',
      error: err.message,
      durationMs: Date.now() - startTime,
    });

    return sendError(res, 500, 'BIP_FAILED', 'Erro ao salvar bip no servidor', err.message);
  }
}
