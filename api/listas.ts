import listasIndexHandler from './_listas/index';
import listaIdHandler from './_listas/[id]';
import reconcileHandler from './_listas/reconcile';
import { AuthError, requireAdmin, requireGroup } from './_lib/auth';
import { sendError } from './_lib/response';

export default async function handler(req: any, res: any) {
  const { action, id } = req.query || {};

  try {
    if (action === 'reconcile') await requireAdmin(req);
    else await requireGroup(req, 'listas');
  } catch (error: any) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    return sendError(res, status, error?.code || 'UNAUTHORIZED', error?.message || 'Não autorizado.');
  }

  if (!action || action === 'index') return listasIndexHandler(req, res);
  switch (action) {
    case 'id': return listaIdHandler(req, res);
    case 'reconcile': return reconcileHandler(req, res);
    default:
      if (id) return listaIdHandler(req, res);
      return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em listas');
  }
}
