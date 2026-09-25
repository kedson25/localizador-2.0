import {
  BRANCAS_SPREADSHEET_ID,
  BRANCAS_SHEET_NAME,
  ROTAS_SHEET_NAME,
  buildLiveBrancasReport,
} from './_lib/brancas-live';
import { requireBrancasAuth } from './_lib/brancas-auth';

function sendJson(res: any, status: number, payload: any) {
  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(status).json(payload);
  }

  res.statusCode = status;
  return res.end(JSON.stringify(payload));
}

async function getLiveReport(req: any) {
  const body = req.body && typeof req.body === 'object' ? req.body : {};

  return buildLiveBrancasReport({
    spreadsheetId: String(
      body.spreadsheetId || req.query?.spreadsheetId || BRANCAS_SPREADSHEET_ID
    ),
    sheetBrancas: String(
      body.sheetBrancas || req.query?.sheetBrancas || BRANCAS_SHEET_NAME
    ),
    sheetRotas: String(body.sheetRotas || req.query?.sheetRotas || ROTAS_SHEET_NAME),
  });
}

export default async function handler(req: any, res: any) {
  if (!(await requireBrancasAuth(req, res))) return;
  const urlPath = String(req.url || '').split('?')[0].replace(/\/+$/, '');
  const action = String(req.query?.action || '').toLowerCase();

  try {
    if (urlPath.endsWith('/historico') || action === 'historico') {
      const idPacote = String(req.query?.id || req.query?.idPacote || '').trim();
      return sendJson(res, 200, {
        ok: true,
        data: {
          idPacote,
          found: false,
          ultimoResultado: null,
          ultimoCicloTentativa: null,
          movimentacoes: [],
          message: 'Histórico detalhado temporariamente indisponível no modo de leitura ao vivo.',
        },
      });
    }

    if (urlPath.endsWith('/reset') || action === 'reset') {
      return sendJson(res, 200, {
        ok: true,
        data: {
          flowId: 'live-google-sheets',
          message: 'Modo ao vivo não mantém cache de análise para zerar.',
        },
      });
    }

    if (
      urlPath.endsWith('/check') ||
      action === 'check' ||
      action === 'cron' ||
      urlPath.endsWith('/sync') ||
      action === 'sync' ||
      urlPath.endsWith('/relatorio') ||
      action === 'relatorio' ||
      req.method === 'GET' ||
      req.method === 'POST'
    ) {
      const report = await getLiveReport(req);

      return sendJson(res, 200, {
        ok: true,
        data: {
          ...report,
          ok: true,
          changed: true,
          hasChanges: true,
          isNewRun: true,
          partialSuccess: false,
        },
      });
    }

    return sendJson(res, 405, {
      ok: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Método não permitido.',
      },
    });
  } catch (error: any) {
    console.error('[Brancas router] Falha:', error);

    return sendJson(res, 502, {
      ok: false,
      error: {
        code: 'GOOGLE_SHEETS_READ_FAILED',
        message: error?.message || 'Não foi possível ler o Google Sheets.',
      },
    });
  }
}
