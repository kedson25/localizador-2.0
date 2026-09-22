import { getDocRest, runQueryRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { buildVisaoGeral } from '../_lib/operationalTranslator';

async function getFlowId(): Promise<string> {
  const control = await getDocRest('brancas_control/current');
  return String(control?.flowId || 'default');
}

export default async function relatorioV2Handler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const { runId: requestedRunId, snapshotId: requestedSnapshotId } = req.query || {};
  const targetId = requestedSnapshotId || requestedRunId;

  try {
    const flowId = await getFlowId();
    let snapshotDoc: any = null;

    if (targetId) {
      snapshotDoc = await getDocRest(`routing_snapshots/${String(targetId)}`);
      if (!snapshotDoc) snapshotDoc = await getDocRest(`routing_runs/${String(targetId)}`);
      if (snapshotDoc && snapshotDoc.flowId !== flowId) snapshotDoc = null;
    }

    let recentSnapshotsDocs = await runQueryRest('routing_snapshots', {
      orderByField: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 30,
    });
    if (recentSnapshotsDocs.length === 0) {
      recentSnapshotsDocs = await runQueryRest('routing_runs', {
        orderByField: 'timestamp',
        orderDirection: 'DESCENDING',
        limit: 30,
      });
    }

    recentSnapshotsDocs = recentSnapshotsDocs.filter((doc: any) => doc.flowId === flowId);

    const recentRuns = recentSnapshotsDocs.slice(0, 10).map((d: any) => ({
      runId: d.id,
      snapshotId: d.id,
      ciclosDetectados: d.ciclosDetectados || (d.attemptCycle ? [d.attemptCycle] : []),
      createdAt: d.createdAt || '',
      timestamp: d.timestamp || 0,
      totalBrancas: d.totalBrancas || 0,
      roteirizados: d.totalRoteirizados || d.roteirizados || 0,
      naoRoteirizados: d.totalNaoRoteirizados || d.naoRoteirizados || 0,
      recuperados: d.totalRecuperados || d.recuperados || 0,
      taxaRoteirizacao: d.taxaRoteirizacao || 0,
      attemptDate: d.attemptDate || '',
      attemptCycle: d.attemptCycle || '',
      attemptKey: d.attemptKey || '',
    }));

    if (!snapshotDoc && recentSnapshotsDocs.length > 0) snapshotDoc = recentSnapshotsDocs[0];

    if (!snapshotDoc) {
      return sendSuccess(res, {
        hasData: false,
        flowId,
        message: 'Fluxo zerado ou ainda sem análise. Use Atualizar ou carregue os 2 CSVs.',
        recentRuns: [],
        lastCheckTime: new Date().toISOString(),
      });
    }

    const totalBrancas = Number(snapshotDoc.totalBrancas || 0);
    const totalRotas = Number(snapshotDoc.totalRotas || snapshotDoc.extRotasCount || 0);
    const totalRoteirizados = Number(snapshotDoc.totalRoteirizados || snapshotDoc.roteirizados || 0);
    const totalNaoRoteirizados = Number(snapshotDoc.totalNaoRoteirizados || snapshotDoc.naoRoteirizados || 0);
    const totalRecuperados = Number(snapshotDoc.totalRecuperados || snapshotDoc.recuperados || 0);
    const totalContinuamFalhando = Number(snapshotDoc.totalContinuamFalhando || snapshotDoc.continuamFalhando || 0);
    const totalMudaramMotivo = Number(snapshotDoc.totalMudaramMotivo || snapshotDoc.motivoAlteradoCount || 0);
    const novosNaoRoteirizadosCount = Number(snapshotDoc.novosNaoRoteirizadosCount || 0);
    const itemsNaoRoteirizados = Array.isArray(snapshotDoc.itemsNaoRoteirizados) ? snapshotDoc.itemsNaoRoteirizados : [];
    const itemsRecuperados = Array.isArray(snapshotDoc.itemsRecuperados) ? snapshotDoc.itemsRecuperados : [];
    const itemsAll = Array.isArray(snapshotDoc.itemsAll) && snapshotDoc.itemsAll.length > 0
      ? snapshotDoc.itemsAll
      : [...itemsNaoRoteirizados, ...itemsRecuperados];
    const writeSyncStatus = snapshotDoc.writeSyncStatus || 'COMPLETE';
    const failedPackageWrites = Number(snapshotDoc.failedPackageWrites || 0);
    const partialSuccess = writeSyncStatus === 'PARTIAL' || failedPackageWrites > 0;

    return sendSuccess(res, {
      hasData: true,
      flowId,
      snapshotId: snapshotDoc.id,
      runId: snapshotDoc.id,
      attemptDate: snapshotDoc.attemptDate,
      attemptCycle: snapshotDoc.attemptCycle,
      attemptKey: snapshotDoc.attemptKey,
      ciclosDetectados: snapshotDoc.ciclosDetectados || (snapshotDoc.attemptCycle ? [snapshotDoc.attemptCycle] : []),
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
      mudancasMotivoDetalhes: snapshotDoc.mudancasMotivoDetalhes || [],
      taxaRoteirizacao: Number(snapshotDoc.taxaRoteirizacao || 0),
      extBrancasCount: snapshotDoc.extBrancasCount || 0,
      extRotasCount: snapshotDoc.extRotasCount || 0,
      writeSyncStatus,
      partialSuccess,
      totalPackageWrites: Number(snapshotDoc.totalPackageWrites || 0),
      successfulPackageWrites: Number(snapshotDoc.successfulPackageWrites || snapshotDoc.totalPackageWrites || 0),
      failedPackageWrites,
      quotaLimited: Boolean(snapshotDoc.quotaLimited),
      failedWriteChunks: snapshotDoc.failedWriteChunks || [],
      writeSyncUpdatedAt: snapshotDoc.writeSyncUpdatedAt || snapshotDoc.createdAt,
      lastComparisonTime: snapshotDoc.createdAt,
      lastCheckTime: new Date().toISOString(),
      statusBanner: partialSuccess
        ? `${snapshotDoc.attemptDate || ''} ${snapshotDoc.attemptCycle || ''}: sincronização parcial.`.trim()
        : `${snapshotDoc.attemptDate || ''} ${snapshotDoc.attemptCycle || ''}: fluxo sequencial carregado.`.trim(),
      motivos: snapshotDoc.motivos || {},
      statusCounts: snapshotDoc.statusCounts || {},
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      visaoGeralSistema: snapshotDoc.visaoGeralSistema || buildVisaoGeral(itemsNaoRoteirizados),
      padroesDetectados: snapshotDoc.padroesDetectados || [],
      recentRuns,
    });
  } catch (err: any) {
    logApi('error', 'Falha ao buscar relatório sequencial de brancas', {
      error: err?.message || String(err),
    });
    return sendError(res, 500, 'RELATORIO_ERROR', `Erro ao carregar relatório: ${err?.message || String(err)}`);
  }
}
