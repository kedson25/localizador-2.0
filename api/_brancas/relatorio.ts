import { getDocRest, runQueryRest } from '../_lib/firestore-rest';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { buildVisaoGeral } from '../_lib/operationalTranslator';

export default async function relatorioHandler(req: any, res: any) {
  if (req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const { runId: requestedRunId, snapshotId: requestedSnapshotId } = req.query || {};
  const targetId = requestedSnapshotId || requestedRunId;

  try {
    // O relatório deve ser somente leitura. Não dispara sincronização pesada aqui.
    // Isso evita que a abertura da tela fique bloqueada por Google Sheets/Firestore.
    let snapshotDoc: any = null;

    if (targetId) {
      snapshotDoc = await getDocRest(`routing_snapshots/${String(targetId)}`);
      if (!snapshotDoc) {
        snapshotDoc = await getDocRest(`routing_runs/${String(targetId)}`);
      }
    }

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
      writeSyncStatus: d.writeSyncStatus || 'COMPLETE',
      failedPackageWrites: d.failedPackageWrites || 0,
    }));

    if (!snapshotDoc && recentSnapshotsDocs.length > 0) {
      snapshotDoc = recentSnapshotsDocs[0];
    }

    if (!snapshotDoc) {
      return sendSuccess(res, {
        hasData: false,
        message: 'Nenhum snapshot registrado ainda. Use Atualizar para processar as planilhas.',
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

    const writeSyncStatus = snapshotDoc.writeSyncStatus || 'COMPLETE';
    const totalPackageWrites = Number(snapshotDoc.totalPackageWrites || 0);
    const successfulPackageWrites = Number(
      snapshotDoc.successfulPackageWrites ?? totalPackageWrites
    );
    const failedPackageWrites = Number(snapshotDoc.failedPackageWrites || 0);
    const quotaLimited = Boolean(snapshotDoc.quotaLimited);
    const partialSuccess = writeSyncStatus === 'PARTIAL' || failedPackageWrites > 0;

    const formattedTime = new Date(snapshotDoc.createdAt || Date.now()).toLocaleTimeString('pt-BR', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });

    const statusBanner = partialSuccess
      ? `Sincronização parcial: ${successfulPackageWrites}/${totalPackageWrites} gravações concluídas. ${failedPackageWrites} pendente(s) de nova tentativa.`
      : `Última análise registrada às ${formattedTime}.`;

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
      writeSyncStatus,
      partialSuccess,
      totalPackageWrites,
      successfulPackageWrites,
      failedPackageWrites,
      quotaLimited,
      failedWriteChunks: snapshotDoc.failedWriteChunks || [],
      writeSyncUpdatedAt: snapshotDoc.writeSyncUpdatedAt || snapshotDoc.createdAt,
      lastComparisonTime: snapshotDoc.createdAt,
      lastCheckTime: new Date().toISOString(),
      statusBanner,
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
    logApi('error', 'Falha ao buscar relatório/snapshot de brancas', { error: err?.message || String(err) });
    return sendError(res, 500, 'RELATORIO_ERROR', `Erro ao carregar relatório: ${err?.message || String(err)}`);
  }
}
