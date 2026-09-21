import crypto from 'crypto';
import { readBrancas, readRotasDetails, isGoogleSheetsConfigured, BrancaRow } from '../_lib/googleSheets';
import { getDocRest, runQueryRest } from '../_lib/firestore-rest';
import { batchCommitWritesWithRetry } from '../_lib/firestore-safe-batch';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { translateRoutingPattern, buildVisaoGeral, OperationalPatternInsight } from '../_lib/operationalTranslator';

export type ResultadoBranca = 'ROTEIRIZADO' | 'NAO_ROTEIRIZADO';
export type TransicaoBranca =
  | 'NOVO_NAO_ROTEIRIZADO'
  | 'CONTINUA_NAO_ROTEIRIZADO'
  | 'RECUPERADO'
  | 'VOLTOU_A_FALHAR'
  | 'ROTEIRIZADO'
  | 'MOTIVO_ALTERADO';

export interface MudancaMotivoDetalhe {
  idPacote: string;
  motivoAnterior: string;
  motivoAtual: string;
  statusAnterior: string;
  statusAtual: string;
}

export function calculateExtractionHash(brancas: BrancaRow[], rotasIds: Set<string>): string {
  const sortedBrancasSignature = brancas
    .map(b => `${b.idPacote}|${b.motivoMacro}|${b.statusTraduzido}|${b.ciclo}|${b.etapaFluxo}|${b.detalheDescartes}`)
    .sort()
    .join(';');
  const sortedRotasSignature = Array.from(rotasIds).sort().join(',');
  const payload = `${sortedBrancasSignature}:::${sortedRotasSignature}`;
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 32);
}

export function extractDistinctCycles(brancas: BrancaRow[]): string[] {
  const cycles = new Set<string>();
  for (const b of brancas) {
    if (b.ciclo && b.ciclo.trim()) {
      cycles.add(b.ciclo.trim().toUpperCase());
    }
  }
  const arr = Array.from(cycles);
  return arr.length > 0 ? arr.sort() : ['NÃO DEFINIDO'];
}

export default async function syncHandler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const queryParams = req.query || {};
  const bodyParams = req.body || {};
  const forceManual = bodyParams.forceManual === true || queryParams.forceManual === 'true';
  const observacao = bodyParams.observacao || queryParams.observacao;
  const spreadsheetId = bodyParams.spreadsheetId || queryParams.spreadsheetId;
  const sheetBrancas = bodyParams.sheetBrancas || queryParams.sheetBrancas;
  const sheetRotas = bodyParams.sheetRotas || queryParams.sheetRotas;

  if (!isGoogleSheetsConfigured()) {
    return sendError(
      res,
      503,
      'SHEETS_NOT_CONFIGURED',
      'Credenciais do Google Sheets não encontradas. Configure as variáveis de Service Account.'
    );
  }

  const startTime = Date.now();

  try {
    // 1. Ler ext_brancas e ext_rotas via Google Sheets API no backend
    const [brancas, rotasDetails] = await Promise.all([
      readBrancas(spreadsheetId, sheetBrancas),
      readRotasDetails(spreadsheetId, sheetRotas),
    ]);
    const { rotasIds, rotasMap, ciclosRotas } = rotasDetails;

    if (brancas.length === 0) {
      return sendError(
        res,
        400,
        'EMPTY_BRANCAS',
        'A aba ext_brancas não contém registros de pacotes para análise.'
      );
    }

    const ciclosDetectados = extractDistinctCycles(brancas);
    if (ciclosRotas.length > 0) {
      for (const cr of ciclosRotas) {
        if (!ciclosDetectados.includes(cr)) {
          ciclosDetectados.push(cr);
        }
      }
    }

    // 2. Calcular hash de extração com normalização e ordenação
    const currentHash = calculateExtractionHash(brancas, rotasIds);

    // 3. Buscar o último snapshot salvo no Firebase (routing_snapshots ou routing_runs)
    let latestSnapshots = await runQueryRest('routing_snapshots', {
      orderByField: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 1,
    });
    if (latestSnapshots.length === 0) {
      latestSnapshots = await runQueryRest('routing_runs', {
        orderByField: 'timestamp',
        orderDirection: 'DESCENDING',
        limit: 1,
      });
    }

    const latestSnapshot = latestSnapshots.length > 0 ? latestSnapshots[0] : null;
    const latestWriteComplete =
      !latestSnapshot ||
      ((latestSnapshot.writeSyncStatus === undefined || latestSnapshot.writeSyncStatus === 'COMPLETE') &&
        Number(latestSnapshot.failedPackageWrites || 0) === 0);

    // Só reutiliza snapshot idêntico se a persistência anterior realmente terminou.
    // Snapshot parcial deve ser reprocessado para que os writes pendentes sejam tentados novamente.
    if (
      latestSnapshot &&
      latestSnapshot.hash === currentHash &&
      latestWriteComplete &&
      !forceManual &&
      Array.isArray(latestSnapshot.itemsNaoRoteirizados) &&
      latestSnapshot.itemsNaoRoteirizados.length > 0
    ) {
      return sendSuccess(res, {
        ok: true,
        changed: false,
        isNewRun: false,
        hasChanges: false,
        partialSuccess: false,
        runId: latestSnapshot.id,
        snapshotId: latestSnapshot.id,
        ciclosDetectados: latestSnapshot.ciclosDetectados || ciclosDetectados,
        totalBrancas: latestSnapshot.totalBrancas || brancas.length,
        totalRotas: latestSnapshot.totalRotas || rotasIds.size,
        totalRoteirizados: latestSnapshot.totalRoteirizados || latestSnapshot.roteirizados || 0,
        totalNaoRoteirizados: latestSnapshot.totalNaoRoteirizados || latestSnapshot.naoRoteirizados || 0,
        totalRecuperados: latestSnapshot.totalRecuperados || latestSnapshot.recuperados || 0,
        totalContinuamFalhando: latestSnapshot.totalContinuamFalhando || latestSnapshot.continuamFalhando || 0,
        totalMudaramMotivo: latestSnapshot.totalMudaramMotivo || latestSnapshot.motivoAlteradoCount || 0,
        roteirizados: latestSnapshot.totalRoteirizados || latestSnapshot.roteirizados || 0,
        naoRoteirizados: latestSnapshot.totalNaoRoteirizados || latestSnapshot.naoRoteirizados || 0,
        recuperados: latestSnapshot.totalRecuperados || latestSnapshot.recuperados || 0,
        continuamFalhando: latestSnapshot.totalContinuamFalhando || latestSnapshot.continuamFalhando || 0,
        motivoAlteradoCount: latestSnapshot.totalMudaramMotivo || latestSnapshot.motivoAlteradoCount || 0,
        novosNaoRoteirizadosCount: latestSnapshot.novosNaoRoteirizadosCount || 0,
        mudancasMotivoDetalhes: latestSnapshot.mudancasMotivoDetalhes || [],
        itemsNaoRoteirizados: latestSnapshot.itemsNaoRoteirizados || [],
        itemsRecuperados: latestSnapshot.itemsRecuperados || [],
        itemsAll: latestSnapshot.itemsAll || [
          ...(latestSnapshot.itemsNaoRoteirizados || []),
          ...(latestSnapshot.itemsRecuperados || []),
        ],
        motivos: latestSnapshot.motivos || {},
        statusCounts: latestSnapshot.statusCounts || {},
        taxaRoteirizacao: latestSnapshot.taxaRoteirizacao || 0,
        extBrancasCount: brancas.length,
        extRotasCount: rotasIds.size,
        visaoGeralSistema: latestSnapshot.visaoGeralSistema || buildVisaoGeral(latestSnapshot.itemsNaoRoteirizados || []),
        padroesDetectados: latestSnapshot.padroesDetectados || [],
        totalPackageWrites: latestSnapshot.totalPackageWrites || 0,
        successfulPackageWrites: latestSnapshot.successfulPackageWrites || latestSnapshot.totalPackageWrites || 0,
        failedPackageWrites: 0,
        quotaLimited: false,
        lastComparisonTime: latestSnapshot.createdAt,
        lastCheckTime: new Date().toISOString(),
        statusBanner: 'Nenhuma alteração encontrada.',
        message: 'Nenhuma alteração detectada nas planilhas operacionais.',
      });
    }

    // 4. SE MUDOU (ou houve sync parcial anterior): Comparação, Classificação e Snapshot
    const snapshotId = `snap_${Date.now()}_${currentHash.slice(0, 8)}`;
    const naoRoteirizadasRows = brancas.filter(b => !rotasIds.has(b.idPacote));
    const roteirizadasRows = brancas.filter(b => rotasIds.has(b.idPacote));
    const roteirizadasCount = roteirizadasRows.length;

    // Buscar histórico anterior de pacotes não roteirizados para calcular transições
    const existingPackagesMap = new Map<string, any>();
    const CONCURRENCY = 25;
    for (let i = 0; i < naoRoteirizadasRows.length; i += CONCURRENCY) {
      const slice = naoRoteirizadasRows.slice(i, i + CONCURRENCY);
      const results = await Promise.all(
        slice.map(async (b) => {
          const doc = await getDocRest(`packages/${b.idPacote}`);
          return { id: b.idPacote, doc };
        })
      );
      for (const { id, doc } of results) {
        if (doc) {
          existingPackagesMap.set(id, doc);
        }
      }
    }

    // 5. Analisar cada pacote e classificar transições
    let recuperados = 0;
    let continuamFalhando = 0;
    let totalMudaramMotivo = 0;
    let novosNaoRoteirizadosCount = 0;

    const itemsNaoRoteirizados: any[] = [];
    const itemsRecuperados: any[] = [];
    const motivosMap: Record<string, number> = {};
    const statusMap: Record<string, number> = {};
    const mudancasMotivoDetalhes: MudancaMotivoDetalhe[] = [];
    const packageWrites: Array<{ type: 'set' | 'update' | 'delete'; docPath: string; data?: any }> = [];

    const nowIso = new Date().toISOString();
    const nowTimestamp = Date.now();

    // Contadores para padrões de histórico
    let countPossivelTrava = 0;
    const packagesWithPotentialLock: string[] = [];

    for (const b of naoRoteirizadasRows) {
      const prev = existingPackagesMap.get(b.idPacote);
      const previousMovs = Array.isArray(prev?.movimentacoes) ? prev.movimentacoes : [];
      const tentativasCount = previousMovs.length + 1;

      let transicao: TransicaoBranca = 'NOVO_NAO_ROTEIRIZADO';
      const motivoAnterior = prev?.ultimoMotivo || prev?.motivoMacro || '';
      const statusAnterior = prev?.ultimoStatus || prev?.statusTraduzido || '';

      if (!prev) {
        transicao = 'NOVO_NAO_ROTEIRIZADO';
        novosNaoRoteirizadosCount++;
      } else if (prev.ultimoResultado === 'NAO_ROTEIRIZADO') {
        const motivoMudou = (motivoAnterior && motivoAnterior !== b.motivoMacro) ||
                            (statusAnterior && statusAnterior !== b.statusTraduzido);
        if (motivoMudou) {
          transicao = 'MOTIVO_ALTERADO';
          totalMudaramMotivo++;
          if (mudancasMotivoDetalhes.length < 20) {
            mudancasMotivoDetalhes.push({
              idPacote: b.idPacote,
              motivoAnterior: motivoAnterior || 'Sem motivo anterior',
              motivoAtual: b.motivoMacro || 'Não informado',
              statusAnterior: statusAnterior || '',
              statusAtual: b.statusTraduzido || '',
            });
          }
        } else {
          transicao = 'CONTINUA_NAO_ROTEIRIZADO';
        }
        continuamFalhando++;

        // Checar suspeita de trava de ciclo anterior (ROUTED_IN_OTHER_CYCLE em tentativas consecutivas)
        if (
          (b.motivoMacro?.includes('ROUTED_IN_OTHER_CYCLE') || b.statusTraduzido?.toLowerCase().includes('outro ciclo')) &&
          (motivoAnterior?.includes('ROUTED_IN_OTHER_CYCLE') || statusAnterior?.toLowerCase().includes('outro ciclo'))
        ) {
          countPossivelTrava++;
          if (packagesWithPotentialLock.length < 5) {
            packagesWithPotentialLock.push(b.idPacote);
          }
        }
      } else if (prev.ultimoResultado === 'ROTEIRIZADO') {
        transicao = 'VOLTOU_A_FALHAR';
        continuamFalhando++;
      }

      const translation = translateRoutingPattern(
        b.etapaFluxo,
        b.motivoMacro,
        b.detalheDescartes,
        b.statusTraduzido
      );

      const itemProcessed = {
        idPacote: b.idPacote,
        dataBranca: b.data,
        base: b.base,
        cicloOrigem: b.ciclo || 'AM1',
        etapaFluxo: b.etapaFluxo,
        motivoMacro: b.motivoMacro || 'NÃO INFORMADO',
        motivoAnterior,
        detalheDescartes: b.detalheDescartes,
        statusTraduzido: b.statusTraduzido || 'Sem rota',
        statusAnterior,
        transicao,
        tentativasCount,
        categoria: translation.categoria,
        categoriaLabel: translation.categoriaLabel,
        tituloOperacional: translation.titulo,
        explicacaoOperacional: translation.explicacao,
        badgeTipo: translation.badgeTipo,
        timestamp: nowTimestamp,
      };

      itemsNaoRoteirizados.push(itemProcessed);

      const motivoKey = (b.motivoMacro || 'NÃO INFORMADO').trim();
      motivosMap[motivoKey] = (motivosMap[motivoKey] || 0) + 1;

      const statusKey = (b.statusTraduzido || 'Sem rota').trim();
      statusMap[statusKey] = (statusMap[statusKey] || 0) + 1;

      // Evento histórico individual apenas se houve alteração ou primeira vez
      const hasChanged = !prev || prev.ultimoResultado !== 'NAO_ROTEIRIZADO' || prev.ultimoMotivo !== b.motivoMacro || prev.ultimoStatus !== b.statusTraduzido;

      if (hasChanged) {
        const eventId = `ev_${snapshotId}_${nowTimestamp}`;
        const novaMovimentacao = {
          id: eventId,
          cicloTentativa: b.ciclo || 'N/D',
          resultado: 'NAO_ROTEIRIZADO',
          transicao,
          motivo: b.motivoMacro || '',
          motivoAnterior,
          status: b.statusTraduzido || '',
          dataRegistro: nowIso,
          timestamp: nowTimestamp,
          snapshotId,
        };

        packageWrites.push({
          type: 'set',
          docPath: `packages/${b.idPacote}`,
          data: {
            idPacote: b.idPacote,
            ultimoResultado: 'NAO_ROTEIRIZADO',
            ultimoCiclo: b.ciclo || 'N/D',
            ultimoMotivo: b.motivoMacro || '',
            ultimoStatus: b.statusTraduzido || '',
            ultimaTransicao: transicao,
            totalTentativas: tentativasCount,
            movimentacoes: [...previousMovs, novaMovimentacao],
            updatedAt: nowIso,
            timestamp: nowTimestamp,
          },
        });

        packageWrites.push({
          type: 'set',
          docPath: `packages/${b.idPacote}/movimentacoes/${eventId}`,
          data: novaMovimentacao,
        });
      }
    }

    // Identificar pacotes que estavam em ext_brancas e agora estão em ext_rotas (ROTEIRIZOU E RECUPEROU)
    for (const b of roteirizadasRows) {
      const rotaInfo = rotasMap.get(b.idPacote);
      const cicloDestino = (rotaInfo?.ciclo && rotaInfo.ciclo.trim()) || 'PM1';
      const cicloOrigem = (b.ciclo && b.ciclo.trim()) || 'AM1';

      recuperados++;
      const itemRecuperado = {
        idPacote: b.idPacote,
        dataBranca: b.data,
        base: b.base,
        cicloOrigem,
        cicloDestino,
        etapaFluxo: b.etapaFluxo,
        motivoMacro: b.motivoMacro || 'ROTEIRIZADO',
        motivoAnterior: b.motivoMacro || '',
        detalheDescartes: b.detalheDescartes,
        statusTraduzido: `Roteirizou e recuperou no ${cicloDestino}`,
        transicao: 'RECUPERADO',
        tentativasCount: 1,
        categoria: 'RECUPERADO',
        categoriaLabel: 'Recuperado',
        tituloOperacional: `Roteirizou e recuperou (${cicloOrigem} ➔ ${cicloDestino})`,
        explicacaoOperacional: `O pacote originado no ciclo ${cicloOrigem} recebeu rota com sucesso no ciclo ${cicloDestino}.`,
        badgeTipo: 'FATO',
        timestamp: nowTimestamp,
      };
      itemsRecuperados.push(itemRecuperado);

      const eventId = `ev_${snapshotId}_rec_${nowTimestamp}`;
      packageWrites.push({
        type: 'set',
        docPath: `packages/${b.idPacote}`,
        data: {
          idPacote: b.idPacote,
          ultimoResultado: 'ROTEIRIZADO',
          ultimoCiclo: cicloDestino,
          cicloOrigem,
          ultimoMotivo: b.motivoMacro || 'ROTEIRIZADO',
          ultimoStatus: `Roteirizado e recuperado no ${cicloDestino}`,
          ultimaTransicao: 'RECUPERADO',
          updatedAt: nowIso,
          timestamp: nowTimestamp,
        },
      });
      packageWrites.push({
        type: 'set',
        docPath: `packages/${b.idPacote}/movimentacoes/${eventId}`,
        data: {
          id: eventId,
          cicloTentativa: cicloDestino,
          resultado: 'ROTEIRIZADO',
          transicao: 'RECUPERADO',
          motivo: b.motivoMacro || '',
          status: `Roteirizado e recuperado no ${cicloDestino}`,
          dataRegistro: nowIso,
          timestamp: nowTimestamp,
          snapshotId,
        },
      });
    }

    // Também verificar pacotes que eram NÃO ROTEIRIZADOS no snapshot anterior e agora estão em ext_rotas
    if (latestSnapshot && Array.isArray(latestSnapshot.itemsNaoRoteirizados)) {
      for (const prevItem of latestSnapshot.itemsNaoRoteirizados) {
        if (rotasIds.has(prevItem.idPacote) && !itemsRecuperados.some(it => it.idPacote === prevItem.idPacote)) {
          recuperados++;
          const rotaInfo = rotasMap.get(prevItem.idPacote);
          const cicloDestino = (rotaInfo?.ciclo && rotaInfo.ciclo.trim()) || 'PM1';
          const cicloOrigem = (prevItem.cicloOrigem && prevItem.cicloOrigem.trim()) || 'AM1';

          const itemRec = {
            idPacote: prevItem.idPacote,
            dataBranca: prevItem.dataBranca || '',
            base: prevItem.base || '',
            cicloOrigem,
            cicloDestino,
            etapaFluxo: prevItem.etapaFluxo || '',
            motivoMacro: prevItem.motivoMacro || '',
            motivoAnterior: prevItem.motivoMacro || '',
            detalheDescartes: prevItem.detalheDescartes || '',
            statusTraduzido: `Roteirizou e recuperou no ${cicloDestino}`,
            transicao: 'RECUPERADO',
            tentativasCount: (prevItem.tentativasCount || 1) + 1,
            categoria: 'RECUPERADO',
            categoriaLabel: 'Recuperado',
            tituloOperacional: `Roteirizou e recuperou (${cicloOrigem} ➔ ${cicloDestino})`,
            explicacaoOperacional: `O pacote originado no ciclo ${cicloOrigem} recebeu rota com sucesso no ciclo ${cicloDestino}.`,
            badgeTipo: 'FATO',
            timestamp: nowTimestamp,
          };
          itemsRecuperados.push(itemRec);
        }
      }
    }

    const itemsAll = [...itemsNaoRoteirizados, ...itemsRecuperados];

    // 6. Descobrir padrões e percepções operacionais
    const padroesDetectados: OperationalPatternInsight[] = [];
    const visaoGeralSistema = buildVisaoGeral(itemsNaoRoteirizados);

    // Padrão: Suspeita de trava de ciclo anterior
    if (countPossivelTrava > 0) {
      padroesDetectados.push({
        tipo: 'POSSIVEL_TRAVA_CICLO_ANTERIOR',
        titulo: 'Possível vínculo persistente com ciclo anterior',
        descricao: 'Pacotes apresentaram referência ou rota associada a outro ciclo em tentativas consecutivas.',
        amostraTexto: `Observado em ${countPossivelTrava} de ${itemsNaoRoteirizados.length} pacotes sem rota.`,
        badgeTipo: 'HIPOTESE',
        badgeLabel: 'HIPÓTESE',
        relevancia: 'alta',
        categoria: 'OUTRO_CICLO',
        quantidadeAfetada: countPossivelTrava,
      });
    }

    // Padrão: Tendência de recuperação
    if (latestSnapshot && (latestSnapshot.totalNaoRoteirizados || latestSnapshot.naoRoteirizados) > 0) {
      const prevTotalNao = latestSnapshot.totalNaoRoteirizados || latestSnapshot.naoRoteirizados || 0;
      if (prevTotalNao >= 5) {
        const taxaRecup = Number(((recuperados / prevTotalNao) * 100).toFixed(1));
        padroesDetectados.push({
          tipo: 'TENDENCIA_RECUPERACAO',
          titulo: 'Tendência de recuperação de pacotes',
          descricao: `${taxaRecup}% dos pacotes que estavam sem rota no snapshot anterior foram recuperados nesta extração.`,
          amostraTexto: `Observado em ${recuperados} de ${prevTotalNao} casos anteriores.`,
          badgeTipo: 'PADRAO',
          badgeLabel: 'PADRÃO OBSERVADO',
          relevancia: 'media',
          quantidadeAfetada: recuperados,
        });
      } else if (prevTotalNao > 0) {
        padroesDetectados.push({
          tipo: 'TENDENCIA_RECUPERACAO',
          titulo: 'Tendência de recuperação',
          descricao: `${recuperados} pacotes recuperados desde a última extração.`,
          amostraTexto: 'Amostra ainda pequena para conclusão (< 5 casos).',
          badgeTipo: 'PADRAO',
          badgeLabel: 'PADRÃO OBSERVADO',
          relevancia: 'baixa',
          quantidadeAfetada: recuperados,
        });
      }
    }

    // Padrão: Recorrência em regra logística (NO_CHEAPEST)
    const noCheapestCount = motivosMap['NO_CHEAPEST'] || 0;
    if (noCheapestCount >= 5) {
      padroesDetectados.push({
        tipo: 'RECUPERACAO_POR_CICLO',
        titulo: 'Recorrência de condição logística de menor custo',
        descricao: 'Há concentração de pacotes retidos pela regra de menor custo. Acompanhar se haverá recuperação nos ciclos seguintes.',
        amostraTexto: `Observado em ${noCheapestCount} de ${itemsNaoRoteirizados.length} pacotes sem rota.`,
        badgeTipo: 'PADRAO',
        badgeLabel: 'PADRÃO OBSERVADO',
        relevancia: 'media',
        categoria: 'REGRA_LOGISTICA',
        quantidadeAfetada: noCheapestCount,
      });
    }

    const totalBrancas = brancas.length;
    const taxaRoteirizacao = totalBrancas > 0
      ? Number(((roteirizadasCount / totalBrancas) * 100).toFixed(1))
      : 0;

    // 7. Primeiro persiste os históricos. A resposta só é concluída depois de sabermos
    // quantos writes foram realmente aceitos pelo Firestore.
    const packageWriteResult = await batchCommitWritesWithRetry(packageWrites, {
      chunkSize: 250,
      maxAttempts: 4,
      baseDelayMs: 400,
      maxDelayMs: 4_000,
      delayBetweenChunksMs: 80,
    });

    const packageSyncPartial = packageWriteResult.failedWrites > 0;
    const writeSyncStatus = packageSyncPartial ? 'PARTIAL' : 'COMPLETE';

    // 8. Salvar snapshot completo somente depois da tentativa dos históricos,
    // registrando a situação real da persistência.
    const snapshotPayload = {
      snapshotId,
      id: snapshotId,
      hash: currentHash,
      ciclosDetectados,
      totalBrancas,
      totalRotas: rotasIds.size,
      totalRoteirizados: roteirizadasCount,
      totalNaoRoteirizados: naoRoteirizadasRows.length,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo,
      roteirizados: roteirizadasCount,
      naoRoteirizados: naoRoteirizadasRows.length,
      recuperados,
      continuamFalhando,
      motivoAlteradoCount: totalMudaramMotivo,
      novosNaoRoteirizadosCount,
      mudancasMotivoDetalhes,
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      motivos: motivosMap,
      statusCounts: statusMap,
      taxaRoteirizacao,
      extBrancasCount: brancas.length,
      extRotasCount: rotasIds.size,
      visaoGeralSistema,
      padroesDetectados,
      observacao: observacao ? String(observacao).trim() : '',
      writeSyncStatus,
      totalPackageWrites: packageWriteResult.totalWrites,
      successfulPackageWrites: packageWriteResult.successfulWrites,
      failedPackageWrites: packageWriteResult.failedWrites,
      quotaLimited: packageWriteResult.quotaLimited,
      failedWriteChunks: packageWriteResult.failedChunks.map((chunk) => ({
        chunkIndex: chunk.chunkIndex,
        startIndex: chunk.startIndex,
        writeCount: chunk.writeCount,
        attempts: chunk.attempts,
        status: chunk.status || null,
        quotaLimited: chunk.quotaLimited,
      })),
      writeSyncUpdatedAt: nowIso,
      createdAt: nowIso,
      timestamp: nowTimestamp,
    };

    const snapshotWriteResult = await batchCommitWritesWithRetry(
      [
        { type: 'set', docPath: `routing_snapshots/${snapshotId}`, data: snapshotPayload },
        { type: 'set', docPath: `routing_runs/${snapshotId}`, data: snapshotPayload },
      ],
      {
        chunkSize: 2,
        maxAttempts: 4,
        baseDelayMs: 400,
        maxDelayMs: 4_000,
        delayBetweenChunksMs: 0,
      }
    );

    const snapshotPersisted = snapshotWriteResult.failedWrites === 0;
    const partialSuccess = packageSyncPartial || !snapshotPersisted;
    const duration = Date.now() - startTime;

    if (partialSuccess) {
      logApi('warn', 'Sincronização de brancas concluída parcialmente', {
        snapshotId,
        totalBrancas,
        totalRotas: rotasIds.size,
        totalPackageWrites: packageWriteResult.totalWrites,
        successfulPackageWrites: packageWriteResult.successfulWrites,
        failedPackageWrites: packageWriteResult.failedWrites,
        quotaLimited: packageWriteResult.quotaLimited || snapshotWriteResult.quotaLimited,
        snapshotPersisted,
        durationMs: duration,
      });
    } else {
      logApi('info', 'Nova extração detectada e snapshot salvo com sucesso', {
        snapshotId,
        totalBrancas,
        totalRotas: rotasIds.size,
        roteirizados: roteirizadasCount,
        naoRoteirizados: naoRoteirizadasRows.length,
        recuperados,
        totalPackageWrites: packageWriteResult.totalWrites,
        durationMs: duration,
      });
    }

    const statusBanner = partialSuccess
      ? packageWriteResult.failedWrites > 0
        ? `Sincronização parcial: ${packageWriteResult.successfulWrites}/${packageWriteResult.totalWrites} gravações concluídas. ${packageWriteResult.failedWrites} serão tentadas novamente automaticamente.`
        : 'Dados processados, mas o snapshot não pôde ser confirmado no Firestore. O sistema tentará novamente automaticamente.'
      : 'Nova extração detectada. Análise atualizada automaticamente.';

    const message = partialSuccess
      ? 'A análise foi concluída sem interromper a operação, porém existem gravações pendentes no Firestore.'
      : 'Nova extração detectada nas planilhas e análise atualizada automaticamente.';

    return sendSuccess(res, {
      ok: true,
      changed: true,
      isNewRun: true,
      hasChanges: true,
      partialSuccess,
      snapshotPersisted,
      snapshotId,
      runId: snapshotId,
      ciclosDetectados,
      totalBrancas,
      totalRotas: rotasIds.size,
      totalRoteirizados: roteirizadasCount,
      totalNaoRoteirizados: naoRoteirizadasRows.length,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo,
      roteirizados: roteirizadasCount,
      naoRoteirizados: naoRoteirizadasRows.length,
      recuperados,
      continuamFalhando,
      motivoAlteradoCount: totalMudaramMotivo,
      novosNaoRoteirizadosCount,
      mudancasMotivoDetalhes,
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      motivos: motivosMap,
      statusCounts: statusMap,
      taxaRoteirizacao,
      extBrancasCount: brancas.length,
      extRotasCount: rotasIds.size,
      visaoGeralSistema,
      padroesDetectados,
      writeSyncStatus,
      totalPackageWrites: packageWriteResult.totalWrites,
      successfulPackageWrites: packageWriteResult.successfulWrites,
      failedPackageWrites: packageWriteResult.failedWrites,
      quotaLimited: packageWriteResult.quotaLimited || snapshotWriteResult.quotaLimited,
      failedWriteChunks: packageWriteResult.failedChunks,
      lastComparisonTime: nowIso,
      lastCheckTime: nowIso,
      statusBanner,
      message,
      durationMs: duration,
    });
  } catch (err: any) {
    logApi('error', 'Falha ao sincronizar e processar snapshot de brancas', { error: err.message, stack: err.stack });
    return sendError(res, 500, 'SYNC_ERROR', `Erro durante o processamento automático: ${err.message}`);
  }
}
