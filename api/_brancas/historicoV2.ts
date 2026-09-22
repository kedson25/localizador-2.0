import { getDocRest, listDocsRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';

function normalizePackageId(value: any): string {
  if (value === null || value === undefined) return '';
  let normalized = String(value).trim();
  if (normalized.endsWith('.0')) normalized = normalized.slice(0, -2);
  return normalized;
}

async function getFlowId(): Promise<string> {
  const control = await getDocRest('brancas_control/current');
  return String(control?.flowId || 'default');
}

export default async function historicoV2Handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const rawId = req.query?.id || req.query?.idPacote;
  if (!rawId) {
    return sendError(res, 400, 'INVALID_REQUEST', 'O parâmetro "id" do pacote é obrigatório.');
  }

  const idPacote = normalizePackageId(rawId);

  try {
    const flowId = await getFlowId();
    const pkgDataRaw = await getDocRest(`packages/${idPacote}`);
    const pkgData = pkgDataRaw?.flowId === flowId ? pkgDataRaw : null;
    const movRes = await listDocsRest(`packages/${idPacote}/movimentacoes`, 300);
    const movDocs = (movRes.documents || [])
      .filter((data: any) => data.flowId === flowId)
      .sort((a: any, b: any) => {
        const orderA = String(a.sequencia || '');
        const orderB = String(b.sequencia || '');
        return orderA.localeCompare(orderB) || Number(a.timestamp || 0) - Number(b.timestamp || 0);
      });

    const movimentacoes = movDocs.map((data: any) => ({
      id: data.id,
      flowId,
      sequencia: data.sequencia || '',
      dataOperacional: data.dataOperacional || '',
      cicloTentativa: data.cicloTentativa || '',
      resultado: data.resultado || '',
      transicao: data.transicao || '',
      motivo: data.motivoMacro || data.motivo || '',
      motivoAnterior: data.motivoAnterior || '',
      status: data.statusTraduzido || data.status || '',
      dataRegistro: data.dataRegistro || '',
      timestamp: data.timestamp || 0,
      snapshotId: data.snapshotId || '',
    }));

    return sendSuccess(res, {
      idPacote,
      flowId,
      found: Boolean(pkgData) || movimentacoes.length > 0,
      ultimoResultado:
        pkgData?.ultimoResultado ||
        (movimentacoes.length > 0 ? movimentacoes[movimentacoes.length - 1].resultado : null),
      ultimoCicloTentativa:
        pkgData?.ultimoCicloTentativa ||
        pkgData?.ultimoCiclo ||
        (movimentacoes.length > 0 ? movimentacoes[movimentacoes.length - 1].cicloTentativa : null),
      movimentacoes,
    });
  } catch (err: any) {
    logApi('error', 'Falha ao buscar histórico sequencial do pacote', {
      idPacote,
      error: err?.message || String(err),
    });
    return sendError(res, 500, 'HISTORICO_ERROR', `Erro ao buscar histórico do pacote: ${err?.message || String(err)}`);
  }
}
