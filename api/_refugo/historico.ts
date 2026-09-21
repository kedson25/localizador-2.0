import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { listDocsRest, patchDocRest, deleteDocRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      if (!isFirebaseAdminConfigured()) {
        const { documents } = await listDocsRest('refugo_historico_metricas', 100);
        documents.sort((a, b) => (b.timestamp || 0) - (a.timestamp || 0));
        return sendSuccess(res, { metricas: documents });
      }

      const { db } = adminDb;
      const col = db.collection('refugo_historico_metricas');
      const snap = await col.orderBy('timestamp', 'desc').limit(500).get();
      const metricas = snap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }));
      return sendSuccess(res, { metricas });
    } catch (err: any) {
      return sendError(res, 500, 'FETCH_FAILED', 'Erro ao obter histórico de métricas do refugo', err.message);
    }
  }

  if (req.method === 'POST') {
    try {
      const data = req.body || {};
      const id = data.id || `refugo_metricas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      const toSave = {
        ...data,
        id,
        timestamp: typeof data.timestamp === 'number' ? data.timestamp : Date.now(),
        updatedAt: new Date().toISOString(),
      };

      if (!isFirebaseAdminConfigured()) {
        await patchDocRest(`refugo_historico_metricas/${id}`, toSave);
        return sendSuccess(res, toSave, 201);
      }

      const { db } = adminDb;
      const col = db.collection('refugo_historico_metricas');
      await col.doc(id).set({
        ...toSave,
        updatedAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      return sendSuccess(res, toSave, 201);
    } catch (err: any) {
      return sendError(res, 500, 'SAVE_FAILED', 'Erro ao salvar histórico de métricas do refugo', err.message);
    }
  }

  if (req.method === 'DELETE') {
    try {
      const id = req.query?.id || req.body?.id;
      if (!id) {
        return sendError(res, 400, 'MISSING_ID', 'ID do registro histórico é obrigatório');
      }

      if (!isFirebaseAdminConfigured()) {
        await deleteDocRest(`refugo_historico_metricas/${id}`);
        return sendSuccess(res, { deleted: true, id });
      }

      const { db } = adminDb;
      await db.collection('refugo_historico_metricas').doc(id).delete();
      return sendSuccess(res, { deleted: true, id });
    } catch (err: any) {
      return sendError(res, 500, 'DELETE_FAILED', 'Erro ao excluir registro histórico', err.message);
    }
  }

  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
}
