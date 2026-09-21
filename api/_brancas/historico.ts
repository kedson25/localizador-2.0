import { getDocRest, listDocsRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';
import { normalizePackageId } from '../_lib/googleSheets';
import { logApi } from '../_lib/logger';

export default async function historicoHandler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const rawId = req.query?.id || req.query?.idPacote;
  if (!rawId) {
    return sendError(res, 400, 'INVALID_REQUEST', 'O parâmetro "id" do pacote é obrigatório.');
  }

  const idPacote = normalizePackageId(rawId);

  try {
    const pkgData = await getDocRest(`packages/${idPacote}`);

    // Busca todas as movimentações do pacote na subcoleção
    const movRes = await listDocsRest(`packages/${idPacote}/movimentacoes`, 100);
    const movDocs = movRes.documents || [];

    // Ordena cronologicamente por timestamp
    movDocs.sort((a: any, b: any) => (a.timestamp || 0) - (b.timestamp || 0));

    const movimentacoes = movDocs.map((data: any) => ({
      id: data.id,
      cicloTentativa: data.cicloTentativa || '',
      resultado: data.resultado || '',
      transicao: data.transicao || '',
      motivo: data.motivoMacro || '',
      status: data.statusTraduzido || '',
      dataRegistro: data.dataRegistro || '',
      timestamp: data.timestamp || 0,
    }));

    return sendSuccess(res, {
      idPacote,
      found: Boolean(pkgData) || movimentacoes.length > 0,
      ultimoResultado: pkgData?.ultimoResultado || (movimentacoes.length > 0 ? movimentacoes[movimentacoes.length - 1].resultado : null),
      ultimoCicloTentativa: pkgData?.ultimoCicloTentativa || (movimentacoes.length > 0 ? movimentacoes[movimentacoes.length - 1].cicloTentativa : null),
      movimentacoes,
    });
  } catch (err: any) {
    logApi('error', 'Falha ao buscar histórico do pacote', { idPacote, error: err.message });
    return sendError(res, 500, 'HISTORICO_ERROR', `Erro ao buscar histórico do pacote: ${err.message}`);
  }
}
