import { FieldValue } from 'firebase-admin/firestore';
import { adminDb, isFirebaseAdminConfigured } from '../_lib/firebase-admin';
import { AuthError, requireAdmin } from '../_lib/auth';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

export default async function handler(req: any, res: any) {
  if (!isFirebaseAdminConfigured()) {
    return sendError(
      res,
      503,
      'ADMIN_NOT_CONFIGURED',
      'Administração de usuários indisponível no servidor.'
    );
  }

  let currentUser;
  try {
    currentUser = await requireAdmin(req);
  } catch (error: any) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    return sendError(res, status, error?.code || 'UNAUTHORIZED', error?.message || 'Não autorizado.');
  }
  const { auth, db } = adminDb;

  if (req.method === 'GET') {
    try {
      const snap = await db.collection('users').get();
      const users = snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          username: data.username,
          email: data.email,
          isAdmin: Boolean(data.isAdmin),
          isApproved: Boolean(data.isApproved),
          allowedGroups: data.allowedGroups || [],
          createdAt: data.createdAt,
        };
      });
      return sendSuccess(res, { users });
    } catch (err: any) {
      return sendError(res, 500, 'FETCH_FAILED', 'Erro ao listar usuários', err.message);
    }
  }

  if (req.method === 'PATCH') {
    try {
      const { userId, updates } = req.body || {};
      if (typeof userId !== 'string' || !userId || userId.includes('/') || !updates || typeof updates !== 'object' || Array.isArray(updates)) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'userId e updates são obrigatórios');
      }

      const allowedKeys = ['isAdmin', 'isApproved', 'allowedGroups'];
      if (!Object.keys(updates).length || Object.keys(updates).some(key => !allowedKeys.includes(key)) ||
          (updates.isAdmin !== undefined && typeof updates.isAdmin !== 'boolean') ||
          (updates.isApproved !== undefined && typeof updates.isApproved !== 'boolean') ||
          (updates.allowedGroups !== undefined && (!Array.isArray(updates.allowedGroups) || updates.allowedGroups.some((group: unknown) => typeof group !== 'string')))) {
        return sendError(res, 400, 'INVALID_UPDATES', 'Use somente permissões válidas: isAdmin, isApproved e allowedGroups.');
      }
      const safeUpdates: Record<string, any> = {
        updatedAt: FieldValue.serverTimestamp(),
      };
      for (const key of allowedKeys) {
        if (updates[key] !== undefined) {
          safeUpdates[key] = updates[key];
        }
      }

      const target = db.collection('users').doc(userId);
      if (!(await target.get()).exists) return sendError(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
      await target.update(safeUpdates);

      logApi('info', 'Usuário atualizado por admin', {
        endpoint: '/api/auth/users',
        targetUserId: userId,
        updatedBy: currentUser?.uid,
      });

      return sendSuccess(res, { updated: true, userId });
    } catch (err: any) {
      return sendError(res, 500, 'UPDATE_FAILED', 'Erro ao atualizar usuário', err.message);
    }
  }

  if (req.method === 'DELETE') {
    try {
      const { userId } = req.body || {};
      if (typeof userId !== 'string' || !userId || userId.includes('/')) {
        return sendError(res, 400, 'INVALID_PAYLOAD', 'userId é obrigatório');
      }

      const target = db.collection('users').doc(userId);
      const snapshot = await target.get();
      if (!snapshot.exists) return sendError(res, 404, 'USER_NOT_FOUND', 'Usuário não encontrado.');
      const authUid = snapshot.data()?.authUid || userId;
      try { await auth.deleteUser(authUid); }
      catch (error: any) { if (error?.code !== 'auth/user-not-found') throw error; }
      await target.delete();

      logApi('info', 'Usuário excluído por admin', {
        endpoint: '/api/auth/users',
        targetUserId: userId,
        deletedBy: currentUser?.uid,
      });

      return sendSuccess(res, { deleted: true, userId });
    } catch (err: any) {
      return sendError(res, 500, 'DELETE_FAILED', 'Erro ao excluir usuário', err.message);
    }
  }

  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
}
