import refugoScansHandler from './_refugo/scans';
import refugoHistoricoHandler from './_refugo/historico';
import { sendError } from './_lib/response';

export default async function handler(req: any, res: any) {
  const { action } = req.query || {};
  switch (action) {
    case 'scans': return refugoScansHandler(req, res);
    case 'historico': return refugoHistoricoHandler(req, res);
    default: return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em refugo');
  }
}
