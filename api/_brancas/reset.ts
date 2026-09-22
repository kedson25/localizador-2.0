import crypto from 'crypto';
import { setDocRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

export default async function resetBrancasHandler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  try {
    const nowIso = new Date().toISOString();
    const flowId = `flow_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

    await setDocRest('brancas_control/current', {
      flowId,
      resetAt: nowIso,
      timestamp: Date.now(),
    });

    logApi('info', 'Fluxo de brancas zerado', { flowId, resetAt: nowIso });

    return sendSuccess(res, {
      ok: true,
      flowId,
      resetAt: nowIso,
      message: 'Fluxo de Brancas zerado. A próxima análise começará uma sequência nova.',
    });
  } catch (err: any) {
    logApi('error', 'Falha ao zerar fluxo de brancas', {
      error: err?.message || String(err),
    });
    return sendError(res, 500, 'RESET_ERROR', `Erro ao zerar fluxo de Brancas: ${err?.message || String(err)}`);
  }
}
