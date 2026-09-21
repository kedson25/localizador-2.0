import syncHandler from './sync';
import { isGoogleSheetsConfigured } from '../_lib/googleSheets';
import { sendSuccess, sendError } from '../_lib/response';

export default async function checkHandler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  if (!isGoogleSheetsConfigured()) {
    return sendError(res, 503, 'SHEETS_NOT_CONFIGURED', 'Google Sheets não configurado.');
  }

  // Executa sync automático leve (forceManual: false)
  const syntheticReq = {
    method: 'POST',
    query: req.query || {},
    body: { forceManual: false },
    headers: req.headers || {},
  };

  return syncHandler(syntheticReq, res);
}
