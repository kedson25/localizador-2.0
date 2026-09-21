import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { listDocsRest, patchDocRest, deleteDocRest } from '../_lib/firestore-rest';
import { normalizeCodigo, getDeterministicItemId } from '../_lib/id';
import { sendSuccess, sendError } from '../_lib/response';

export default async function handler(req: any, res: any) {
  if (req.method === 'GET') {
    try {
      if (!isFirebaseAdminConfigured()) {
        const { documents } = await listDocsRest('refugo_scans_items', 100);
        return sendSuccess(res, { scans: documents });
      }

      const { db } = adminDb;
      const scansCol = db.collection('refugo_scans_items');
      const snap = await scansCol.orderBy('timestamp', 'desc').limit(500).get();
      const scans = snap.docs.map((d) => ({
        ...d.data(),
        id: d.id,
      }));
      return sendSuccess(res, { scans });
    } catch (err: any) {
      return sendError(res, 500, 'FETCH_FAILED', 'Erro ao obter scans de refugo', err.message);
    }
  }

  if (req.method === 'POST') {
    try {
      const { id, rota, status, foundBy } = req.body || {};
      if (!id) {
        return sendError(res, 400, 'MISSING_ID', 'ID é obrigatório');
      }

      const cleanId = normalizeCodigo(id);
      const docId = getDeterministicItemId(cleanId);

      const scanItem = {
        id: cleanId,
        rota: rota || 'Sem Rota',
        status: status || 'found',
        foundBy: foundBy || 'Operador',
        scannedAt: new Date().toISOString(),
        timestamp: Date.now(),
        updatedAt: new Date().toISOString(),
      };

      if (!isFirebaseAdminConfigured()) {
        await patchDocRest(`refugo_scans_items/${docId}`, scanItem);
        return sendSuccess(res, scanItem, 201);
      }

      const { db } = adminDb;
      const scansCol = db.collection('refugo_scans_items');
      await scansCol.doc(docId).set({ ...scanItem, updatedAt: FieldValue.serverTimestamp() }, { merge: true });

      return sendSuccess(res, scanItem, 201);
    } catch (err: any) {
      return sendError(res, 500, 'SAVE_FAILED', 'Erro ao salvar scan de refugo', err.message);
    }
  }

  if (req.method === 'DELETE') {
    try {
      if (!isFirebaseAdminConfigured()) {
        const { documents } = await listDocsRest('refugo_scans_items', 100);
        for (const doc of documents) {
          await deleteDocRest(`refugo_scans_items/${doc.id}`);
        }
        return sendSuccess(res, { cleared: true });
      }

      const { db } = adminDb;
      const scansCol = db.collection('refugo_scans_items');
      // Excluir em lotes de 400
      while (true) {
        const snap = await scansCol.limit(400).get();
        if (snap.empty) break;

        const batch = db.batch();
        snap.docs.forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }

      return sendSuccess(res, { cleared: true });
    } catch (err: any) {
      return sendError(res, 500, 'CLEAR_FAILED', 'Erro ao limpar scans de refugo', err.message);
    }
  }

  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
}
