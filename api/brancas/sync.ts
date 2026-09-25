import {
  BRANCAS_SPREADSHEET_ID,
  BRANCAS_SHEET_NAME,
  ROTAS_SHEET_NAME,
  buildLiveBrancasReport,
} from '../_lib/brancas-live';
import { requireBrancasAuth } from '../_lib/brancas-auth';

function sendJson(res: any, status: number, payload: any) {
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }

  res.statusCode = status;
  return res.end(JSON.stringify(payload));
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendJson(res, 405, {
      ok: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Método não permitido.' },
    });
  }
  if (!(await requireBrancasAuth(req, res))) return;

  const body = req.body && typeof req.body === 'object' ? req.body : {};

  try {
    const report = await buildLiveBrancasReport({
      spreadsheetId: String(
        body.spreadsheetId || req.query?.spreadsheetId || BRANCAS_SPREADSHEET_ID
      ),
      sheetBrancas: String(
        body.sheetBrancas || req.query?.sheetBrancas || BRANCAS_SHEET_NAME
      ),
      sheetRotas: String(body.sheetRotas || req.query?.sheetRotas || ROTAS_SHEET_NAME),
    });

    return sendJson(res, 200, {
      ok: true,
      data: {
        ...report,
        ok: true,
        changed: true,
        hasChanges: true,
        isNewRun: true,
        partialSuccess: false,
        message: 'Google Sheets atualizado e analisado com sucesso.',
      },
    });
  } catch (error: any) {
    console.error('[Brancas sync] Falha na leitura ao vivo:', error);

    return sendJson(res, 502, {
      ok: false,
      error: {
        code: 'GOOGLE_SHEETS_READ_FAILED',
        message: error?.message || 'Não foi possível atualizar a análise de Brancas.',
      },
    });
  }
}
