import { getDocRest, runQueryRest } from '../_lib/firestore-rest';
import { isGoogleSheetsConfigured } from '../_lib/googleSheets';
import syncHandler from './sync';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { buildVisaoGeral } from '../_lib/operationalTranslator';

export default async function relatorioHandler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const { runId: requestedRunId, snapshotId: requestedSnapshotId, autoCheck } = req.query || {};
  const targetId = requestedSnapshotId || requestedRunId;

  try {
    // Se autoCheck estiver ativo ou se nenhum ID foi passado, dispara verificação leve
    if ((autoCheck === 'true' || autoCheck === true || !targetId) && isGoogleSheetsConfigured()) {
      try {
        let syncExecuted = false;
        const mockReq = {
          method: 'POST',
          query: {},
          body: { forceManual: false },
          headers: req.headers || {},
        };
        const mockRes = {
          statusCode: 200,
          setHeader: () => {},
          end: () => {},
        };
        await syncHandler(mockReq, mockRes);
      } catch (autoErr) {
        console.warn('[Relatorio AutoCheck Warn]:', autoErr);
      }
    }

    let snapshotDoc: any = null;

    if (targetId) {
      snapshotDoc = await getDocRest(`routing_snapshots/${String(targetId)}`);
      if (!snapshotDoc) {
        snapshotDoc = await getDocRest(`routing_runs/${String(targetId)}`);
      }
    }

    // Busca os snapshots mais recentes
    let recentSnapshotsDocs = await runQueryRest('routing_snapshots', {
      orderByField: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 10,
    });

    if (recentSnapshotsDocs.length === 0) {
      recentSnapshotsDocs = await runQueryRest('routing_runs', {
        orderByField: 'timestamp',
        orderDirection: 'DESCENDING',
        limit: 10,
      });
    }

    const recentRuns = recentSnapshotsDocs.map((d: any) => ({
      runId: d.id,
      snapshotId: d.id,
      ciclosDetectados: d.ciclosDetectados || (d.cicloTentativa ? [d.cicloTentativa] : []),
      createdAt: d.createdAt || '',
      timestamp: d.timestamp || 0,
      totalBrancas: d.totalBrancas || 0,
      roteirizados: d.totalRoteirizados || d.roteirizados || 0,
      naoRoteirizados: d.totalNaoRoteirizados || d.naoRoteirizados || 0,
      recuperados: d.totalRecuperados || d.recuperados || 0,
      taxaRoteirizacao: d.taxaRoteirizacao || 0,
    }));

    if (!snapshotDoc && recentSnapshotsDocs.length > 0) {
      snapshotDoc = recentSnapshotsDocs[0];
    }

    if (!snapshotDoc) {
      return sendSuccess(res, {
        hasData: false,
        message: 'Nenhum snapshot de roteirização registrado ainda. O sistema verificará automaticamente assim que as planilhas estiverem acessíveis.',
        recentRuns: [],
        lastCheckTime: new Date().toISOString(),
      });
    }

    const totalBrancas = snapshotDoc.totalBrancas || 0;
    const totalRotas = snapshotDoc.totalRotas || snapshotDoc.extRotasCount || 0;
    const totalRoteirizados = snapshotDoc.totalRoteirizados || snapshotDoc.roteirizados || 0;
    const totalNaoRoteirizados = snapshotDoc.totalNaoRoteirizados || snapshotDoc.naoRoteirizados || 0;
    const totalRecuperados = snapshotDoc.totalRecuperados || snapshotDoc.recuperados || 0;
    const totalContinuamFalhando = snapshotDoc.totalContinuamFalhando || snapshotDoc.continuamFalhando || 0;
    const totalMudaramMotivo = snapshotDoc.totalMudaramMotivo || snapshotDoc.motivoAlteradoCount || 0;
    const novosNaoRoteirizadosCount = snapshotDoc.novosNaoRoteirizadosCount || 0;
    const mudancasMotivoDetalhes = snapshotDoc.mudancasMotivoDetalhes || [];
    const ciclosDetectados = snapshotDoc.ciclosDetectados || (snapshotDoc.cicloTentativa ? [snapshotDoc.cicloTentativa] : ['TODOS']);

    const itemsNaoRoteirizados = Array.isArray(snapshotDoc.itemsNaoRoteirizados) ? snapshotDoc.itemsNaoRoteirizados : [];
    const itemsRecuperados = Array.isArray(snapshotDoc.itemsRecuperados) ? snapshotDoc.itemsRecuperados : [];
    const itemsAll = Array.isArray(snapshotDoc.itemsAll) && snapshotDoc.itemsAll.length > 0
      ? snapshotDoc.itemsAll
      : [...itemsNaoRoteirizados, ...itemsRecuperados];
    const motivos = snapshotDoc.motivos || {};
    const statusCounts = snapshotDoc.statusCounts || {};
    const padroesDetectados = snapshotDoc.padroesDetectados || [];
    const visaoGeralSistema = snapshotDoc.visaoGeralSistema || buildVisaoGeral(itemsNaoRoteirizados);

    const taxaRoteirizacao = totalBrancas > 0
      ? Number(((totalRoteirizados / totalBrancas) * 100).toFixed(1))
      : 0;

    const formattedTime = new Date(snapshotDoc.createdAt || Date.now()).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    return sendSuccess(res, {
      hasData: true,
      snapshotId: snapshotDoc.id,
      runId: snapshotDoc.id,
      ciclosDetectados,
      createdAt: snapshotDoc.createdAt,
      timestamp: snapshotDoc.timestamp,
      totalBrancas,
      totalRotas,
      totalRoteirizados,
      totalNaoRoteirizados,
      totalRecuperados,
      totalContinuamFalhando,
      totalMudaramMotivo,
      roteirizados: totalRoteirizados,
      naoRoteirizados: totalNaoRoteirizados,
      recuperados: totalRecuperados,
      continuamFalhando: totalContinuamFalhando,
      motivoAlteradoCount: totalMudaramMotivo,
      novosNaoRoteirizadosCount,
      mudancasMotivoDetalhes,
      taxaRoteirizacao,
      extBrancasCount: snapshotDoc.extBrancasCount || totalBrancas,
      extRotasCount: snapshotDoc.extRotasCount || totalRotas,
      lastComparisonTime: snapshotDoc.createdAt,
      lastCheckTime: new Date().toISOString(),
      statusBanner: `Nenhuma alteração encontrada desde ${formattedTime}.`,
      motivos,
      statusCounts,
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      visaoGeralSistema,
      padroesDetectados,
      recentRuns,
    });
  } catch (err: any) {
    logApi('error', 'Falha ao buscar relatório/snapshot de brancas', { error: err.message });
    return sendError(res, 500, 'RELATORIO_ERROR', `Erro ao carregar relatório: ${err.message}`);
  }
}
