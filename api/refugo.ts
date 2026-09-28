import refugoScansHandler from './_refugo/scans';
import refugoHistoricoHandler from './_refugo/historico';
import { AuthError, requireApprovedUser } from './_lib/auth';
import { sendError } from './_lib/response';

export default async function handler(req: any, res: any) {
  try {
    await requireApprovedUser(req);
  } catch (error: any) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    return sendError(res, status, error?.code || 'UNAUTHORIZED', error?.message || 'Não autorizado.');
  }

  const { action } = req.query || {};
  switch (action) {
    case 'scans': return refugoScansHandler(req, res);
    case 'historico': return refugoHistoricoHandler(req, res);
    default: return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em refugo');
  }
}
