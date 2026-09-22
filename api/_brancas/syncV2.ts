import crypto from 'crypto';
import {
  readBrancas,
  readRotasDetails,
  isGoogleSheetsConfigured,
  BrancaRow,
} from '../_lib/googleSheets';
import { getDocRest, runQueryRest } from '../_lib/firestore-rest';
import { batchCommitWritesWithRetry } from '../_lib/firestore-safe-batch';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import {
  translateRoutingPattern,
  buildVisaoGeral,
  OperationalPatternInsight,
} from '../_lib/operationalTranslator';

export type ResultadoBranca = 'ROTEIRIZADO' | 'NAO_ROTEIRIZADO';
export type TransicaoBranca =
  | 'NOVO_NAO_ROTEIRIZADO'
  | 'CONTINUA_NAO_ROTEIRIZADO'
  | 'RECUPERADO'
  | 'VOLTOU_A_FALHAR'
  | 'ROTEIRIZADO'
  | 'MOTIVO_ALTERADO';

type SnapshotItem = {
  idPacote: string;
  dataBranca?: string;
  base?: string;
  cicloOrigem?: string;
  cicloDestino?: string;
  cicloTentativa?: string;
  etapaFluxo?: string;
  motivoMacro?: string;
  motivoAnterior?: string;
  detalheDescartes?: string;
  statusTraduzido?: string;
  statusAnterior?: string;
  transicao?: TransicaoBranca;
  tentativasCount?: number;
  [key: string]: any;
};

function normalizeCycle(raw: string | undefined | null): string {
  const value = String(raw || '').trim().toUpperCase();
  if (!value) return '';

  const am = value.match(/\bAM\s*[-_ ]?(\d+)?\b/i);
  if (am) return `AM${am[1] || '1'}`;

  const pm = value.match(/\bPM\s*[-_ ]?(\d+)?\b/i);
  if (pm) return `PM${pm[1] || '1'}`;

  return value.replace(/\s+/g, ' ');
}

function cycleRank(raw: string): number {
  const value = normalizeCycle(raw);
  const suffix = Number(value.match(/(\d+)$/)?.[1] || 1);
  if (value.startsWith('AM')) return 100 + suffix;
  if (value.startsWith('PM')) return 200 + suffix;
  return 50;
}

function saoPauloDateKey(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const map = Object.fromEntries(parts.map((p) => [p.type, p.value]));
  return `${map.year}-${map.month}-${map.day}`;
}

function parseDateKey(raw: string | undefined | null): string {
  const value = String(raw || '').trim();
  if (!value) return '';

  const iso = value.match(/(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (iso) {
    return `${iso[1]}-${String(Number(iso[2])).padStart(2, '0')}-${String(Number(iso[3])).padStart(2, '0')}`;
  }

  const br = value.match(/(\d{1,2})[-/.](\d{1,2})[-/.](20\d{2})/);
  if (br) {
    return `${br[3]}-${String(Number(br[2])).padStart(2, '0')}-${String(Number(br[1])).padStart(2, '0')}`;
  }

  const parsed = new Date(value);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString().slice(0, 10);
  }

  return '';
}

function attemptOrder(dateKey: string, cycle: string): number {
  const numericDate = Number(dateKey.replace(/-/g, '')) || 0;
  return numericDate * 1000 + cycleRank(cycle);
}

function detectAttemptContext(
  brancas: BrancaRow[],
  ciclosRotas: string[]
): { attemptDate: string; attemptCycle: string; attemptKey: string; attemptOrder: number } {
  const datedRows = brancas
    .map((row) => ({ row, dateKey: parseDateKey(row.data) }))
    .filter((entry) => Boolean(entry.dateKey));

  const attemptDate = datedRows.length > 0
    ? datedRows.map((entry) => entry.dateKey).sort().at(-1)!
    : saoPauloDateKey();

  const cyclesForDate = datedRows
    .filter((entry) => entry.dateKey === attemptDate)
    .map((entry) => normalizeCycle(entry.row.ciclo))
    .filter(Boolean);

  const allCycles = [
    ...cyclesForDate,
    ...brancas.map((row) => normalizeCycle(row.ciclo)).filter(Boolean),
    ...ciclosRotas.map(normalizeCycle).filter(Boolean),
  ];

  const attemptCycle = allCycles.length > 0
    ? allCycles.sort((a, b) => cycleRank(a) - cycleRank(b)).at(-1)!
    : 'AM1';

  const key = `${attemptDate}|${attemptCycle}`;
  return {
    attemptDate,
    attemptCycle,
    attemptKey: key,
    attemptOrder: attemptOrder(attemptDate, attemptCycle),
  };
}

function calculateExtractionHash(brancas: BrancaRow[], rotasIds: Set<string>): string {
  const sortedBrancasSignature = brancas
    .map((b) => `${b.idPacote}|${b.data}|${b.motivoMacro}|${b.statusTraduzido}|${b.ciclo}|${b.etapaFluxo}|${b.detalheDescartes}`)
    .sort()
    .join(';');
  const sortedRotasSignature = Array.from(rotasIds).sort().join(',');
  return crypto
    .createHash('sha256')
    .update(`${sortedBrancasSignature}:::${sortedRotasSignature}`)
    .digest('hex')
    .slice(0, 32);
}

function eventId(flowId: string, attemptKey: string, idPacote: string): string {
  return `seq_${crypto
    .createHash('sha1')
    .update(`${flowId}|${attemptKey}|${idPacote}`)
    .digest('hex')
    .slice(0, 28)}`;
}

function rowFromPrevious(item: SnapshotItem, attemptDate: string, attemptCycle: string): BrancaRow {
  return {
    idPacote: item.idPacote,
    data: attemptDate,
    base: item.base || '',
    ciclo: attemptCycle,
    etapaFluxo: item.etapaFluxo || '',
    motivoMacro: item.motivoMacro || 'NÃO INFORMADO',
    detalheDescartes: item.detalheDescartes || '',
    statusTraduzido: item.statusTraduzido || 'Sem rota',
  };
}

async function getFlowId(): Promise<string> {
  const control = await getDocRest('brancas_control/current');
  return String(control?.flowId || 'default');
}

function buildCachedResponse(snapshot: any, nowIso: string) {
  return {
    ok: true,
    changed: false,
    isNewRun: false,
    hasChanges: false,
    partialSuccess: false,
    runId: snapshot.id,
    snapshotId: snapshot.id,
    flowId: snapshot.flowId,
    attemptDate: snapshot.attemptDate,
    attemptCycle: snapshot.attemptCycle,
    attemptKey: snapshot.attemptKey,
    ciclosDetectados: snapshot.ciclosDetectados || [],
    totalBrancas: snapshot.totalBrancas || 0,
    totalRotas: snapshot.totalRotas || 0,
    totalRoteirizados: snapshot.totalRoteirizados || 0,
    totalNaoRoteirizados: snapshot.totalNaoRoteirizados || 0,
    totalRecuperados: snapshot.totalRecuperados || 0,
    totalContinuamFalhando: snapshot.totalContinuamFalhando || 0,
    totalMudaramMotivo: snapshot.totalMudaramMotivo || 0,
    roteirizados: snapshot.totalRoteirizados || 0,
    naoRoteirizados: snapshot.totalNaoRoteirizados || 0,
    recuperados: snapshot.totalRecuperados || 0,
    continuamFalhando: snapshot.totalContinuamFalhando || 0,
    motivoAlteradoCount: snapshot.totalMudaramMotivo || 0,
    novosNaoRoteirizadosCount: snapshot.novosNaoRoteirizadosCount || 0,
    mudancasMotivoDetalhes: snapshot.mudancasMotivoDetalhes || [],
    itemsNaoRoteirizados: snapshot.itemsNaoRoteirizados || [],
    itemsRecuperados: snapshot.itemsRecuperados || [],
    itemsAll: snapshot.itemsAll || [],
    motivos: snapshot.motivos || {},
    statusCounts: snapshot.statusCounts || {},
    taxaRoteirizacao: snapshot.taxaRoteirizacao || 0,
    extBrancasCount: snapshot.extBrancasCount || 0,
    extRotasCount: snapshot.extRotasCount || 0,
    visaoGeralSistema: snapshot.visaoGeralSistema || [],
    padroesDetectados: snapshot.padroesDetectados || [],
    totalPackageWrites: snapshot.totalPackageWrites || 0,
    successfulPackageWrites: snapshot.successfulPackageWrites || snapshot.totalPackageWrites || 0,
    failedPackageWrites: 0,
    quotaLimited: false,
    lastComparisonTime: snapshot.createdAt,
    lastCheckTime: nowIso,
    statusBanner: `${snapshot.attemptDate || ''} ${snapshot.attemptCycle || ''}: nenhuma alteração encontrada.`.trim(),
    message: 'Essa mesma extração já foi processada. Nenhuma tentativa foi duplicada.',
  };
}

export default async function syncV2Handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  const queryParams = req.query || {};
  const bodyParams = req.body || {};
  const observacao = bodyParams.observacao || queryParams.observacao;
  const spreadsheetId = bodyParams.spreadsheetId || queryParams.spreadsheetId;
  const sheetBrancas = bodyParams.sheetBrancas || queryParams.sheetBrancas;
  const sheetRotas = bodyParams.sheetRotas || queryParams.sheetRotas;

  if (!isGoogleSheetsConfigured()) {
    return sendError(
      res,
      503,
      'SHEETS_NOT_CONFIGURED',
      'Credenciais do Google Sheets não encontradas. Use o modo CSV ou configure a Service Account.'
    );
  }

  const startedAt = Date.now();

  try {
    const flowId = await getFlowId();
    const [brancas, rotasDetails] = await Promise.all([
      readBrancas(spreadsheetId, sheetBrancas),
      readRotasDetails(spreadsheetId, sheetRotas),
    ]);

    const { rotasIds, rotasMap, ciclosRotas } = rotasDetails;
    if (brancas.length === 0) {
      return sendError(res, 400, 'EMPTY_BRANCAS', 'A aba ext_brancas não possui registros válidos.');
    }

    const attempt = detectAttemptContext(brancas, ciclosRotas);
    const currentHash = calculateExtractionHash(brancas, rotasIds);
    const nowIso = new Date().toISOString();
    const nowTimestamp = Date.now();

    let snapshots = await runQueryRest('routing_snapshots', {
      orderByField: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 20,
    });
    if (snapshots.length === 0) {
      snapshots = await runQueryRest('routing_runs', {
        orderByField: 'timestamp',
        orderDirection: 'DESCENDING',
        limit: 20,
      });
    }

    const latestCandidate = snapshots[0] || null;
    const latestSnapshot = latestCandidate && latestCandidate.flowId === flowId
      ? latestCandidate
      : null;

    if (
      latestSnapshot &&
      Number(latestSnapshot.attemptOrder || 0) > attempt.attemptOrder
    ) {
      return sendError(
        res,
        409,
        'OLDER_SEQUENCE',
        `A extração ${attempt.attemptDate} ${attempt.attemptCycle} é anterior ao último ciclo salvo (${latestSnapshot.attemptDate} ${latestSnapshot.attemptCycle}). Use “Zerar fluxo” se quiser recomeçar.`
      );
    }

    if (
      latestSnapshot &&
      latestSnapshot.hash === currentHash &&
      latestSnapshot.attemptKey === attempt.attemptKey &&
      Number(latestSnapshot.failedPackageWrites || 0) === 0
    ) {
      return sendSuccess(res, buildCachedResponse(latestSnapshot, nowIso));
    }

    const previousUnresolved: SnapshotItem[] = Array.isArray(latestSnapshot?.itemsNaoRoteirizados)
      ? latestSnapshot.itemsNaoRoteirizados
      : [];
    const previousUnresolvedMap = new Map(previousUnresolved.map((item) => [item.idPacote, item]));

    // O conjunto efetivo inclui as brancas atuais e as pendências do ciclo anterior.
    // Se uma pendência antiga não aparece nas rotas atuais, ela continua sendo acompanhada.
    const effectiveMap = new Map<string, BrancaRow>();
    for (const row of brancas) effectiveMap.set(row.idPacote, row);
    for (const item of previousUnresolved) {
      if (!effectiveMap.has(item.idPacote)) {
        effectiveMap.set(item.idPacote, rowFromPrevious(item, attempt.attemptDate, attempt.attemptCycle));
      }
    }

    const effectiveRows = Array.from(effectiveMap.values());
    const unresolvedRows = effectiveRows.filter((row) => !rotasIds.has(row.idPacote));
    const routedRows = effectiveRows.filter((row) => rotasIds.has(row.idPacote));

    const existingPackages = new Map<string, any>();
    const idsToLoad = effectiveRows.map((row) => row.idPacote);
    const CONCURRENCY = 25;
    for (let i = 0; i < idsToLoad.length; i += CONCURRENCY) {
      const slice = idsToLoad.slice(i, i + CONCURRENCY);
      const docs = await Promise.all(
        slice.map(async (id) => ({ id, doc: await getDocRest(`packages/${id}`) }))
      );
      for (const { id, doc } of docs) {
        if (doc && doc.flowId === flowId) existingPackages.set(id, doc);
      }
    }

    let recuperados = 0;
    let continuamFalhando = 0;
    let totalMudaramMotivo = 0;
    let novosNaoRoteirizadosCount = 0;

    const itemsNaoRoteirizados: SnapshotItem[] = [];
    const itemsRecuperados: SnapshotItem[] = [];
    const motivosMap: Record<string, number> = {};
    const statusMap: Record<string, number> = {};
    const mudancasMotivoDetalhes: any[] = [];
    const packageWrites: Array<{ type: 'set' | 'update' | 'delete'; docPath: string; data?: any }> = [];

    for (const row of unresolvedRows) {
      const prevDoc = existingPackages.get(row.idPacote);
      const prevItem = previousUnresolvedMap.get(row.idPacote);
      const hadPrevious = Boolean(prevDoc || prevItem);
      const previousResult = prevDoc?.ultimoResultado || (prevItem ? 'NAO_ROTEIRIZADO' : '');
      const previousReason = prevDoc?.ultimoMotivo || prevItem?.motivoMacro || '';
      const previousStatus = prevDoc?.ultimoStatus || prevItem?.statusTraduzido || '';
      const sameSequence = prevDoc?.ultimaSequencia === attempt.attemptKey;

      let transicao: TransicaoBranca = 'NOVO_NAO_ROTEIRIZADO';
      if (!hadPrevious) {
        novosNaoRoteirizadosCount++;
      } else if (previousResult === 'ROTEIRIZADO') {
        transicao = 'VOLTOU_A_FALHAR';
        continuamFalhando++;
      } else {
        const reasonChanged = Boolean(
          (previousReason && previousReason !== row.motivoMacro) ||
          (previousStatus && previousStatus !== row.statusTraduzido)
        );
        if (reasonChanged) {
          transicao = 'MOTIVO_ALTERADO';
          totalMudaramMotivo++;
          if (mudancasMotivoDetalhes.length < 20) {
            mudancasMotivoDetalhes.push({
              idPacote: row.idPacote,
              motivoAnterior: previousReason || 'Sem motivo anterior',
              motivoAtual: row.motivoMacro || 'Não informado',
              statusAnterior: previousStatus || '',
              statusAtual: row.statusTraduzido || '',
            });
          }
        } else {
          transicao = 'CONTINUA_NAO_ROTEIRIZADO';
        }
        continuamFalhando++;
      }

      // Atualização do mesmo AM/PM não cria uma nova tentativa.
      if (sameSequence && prevItem?.transicao) {
        transicao = prevItem.transicao;
      }

      const previousCount = Number(prevDoc?.totalTentativas || prevItem?.tentativasCount || 0);
      const tentativasCount = sameSequence
        ? Math.max(1, previousCount)
        : Math.max(1, previousCount + 1);
      const cicloOrigem = prevDoc?.cicloOrigem || prevItem?.cicloOrigem || normalizeCycle(row.ciclo) || attempt.attemptCycle;
      const translation = translateRoutingPattern(
        row.etapaFluxo,
        row.motivoMacro,
        row.detalheDescartes,
        row.statusTraduzido
      );

      const item: SnapshotItem = {
        idPacote: row.idPacote,
        dataBranca: row.data || attempt.attemptDate,
        base: row.base || prevItem?.base || '',
        cicloOrigem,
        cicloTentativa: attempt.attemptCycle,
        etapaFluxo: row.etapaFluxo || prevItem?.etapaFluxo || '',
        motivoMacro: row.motivoMacro || prevItem?.motivoMacro || 'NÃO INFORMADO',
        motivoAnterior: previousReason,
        detalheDescartes: row.detalheDescartes || prevItem?.detalheDescartes || '',
        statusTraduzido: row.statusTraduzido || prevItem?.statusTraduzido || 'Sem rota',
        statusAnterior: previousStatus,
        transicao,
        tentativasCount,
        categoria: translation.categoria,
        categoriaLabel: translation.categoriaLabel,
        tituloOperacional: translation.titulo,
        explicacaoOperacional: translation.explicacao,
        badgeTipo: translation.badgeTipo,
        timestamp: nowTimestamp,
      };
      itemsNaoRoteirizados.push(item);

      const motivoKey = String(item.motivoMacro || 'NÃO INFORMADO').trim();
      const statusKey = String(item.statusTraduzido || 'Sem rota').trim();
      motivosMap[motivoKey] = (motivosMap[motivoKey] || 0) + 1;
      statusMap[statusKey] = (statusMap[statusKey] || 0) + 1;

      const movementId = eventId(flowId, attempt.attemptKey, row.idPacote);
      const movement = {
        id: movementId,
        flowId,
        sequencia: attempt.attemptKey,
        dataOperacional: attempt.attemptDate,
        cicloTentativa: attempt.attemptCycle,
        resultado: 'NAO_ROTEIRIZADO',
        transicao,
        motivo: item.motivoMacro || '',
        motivoAnterior: previousReason,
        status: item.statusTraduzido || '',
        dataRegistro: nowIso,
        timestamp: nowTimestamp,
      };

      packageWrites.push({
        type: 'set',
        docPath: `packages/${row.idPacote}`,
        data: {
          idPacote: row.idPacote,
          flowId,
          cicloOrigem,
          ultimoResultado: 'NAO_ROTEIRIZADO',
          ultimoCiclo: attempt.attemptCycle,
          ultimoCicloTentativa: attempt.attemptCycle,
          ultimaSequencia: attempt.attemptKey,
          ultimaDataOperacional: attempt.attemptDate,
          ultimoMotivo: item.motivoMacro || '',
          ultimoStatus: item.statusTraduzido || '',
          ultimaTransicao: transicao,
          totalTentativas: tentativasCount,
          updatedAt: nowIso,
          timestamp: nowTimestamp,
        },
      });
      packageWrites.push({
        type: 'set',
        docPath: `packages/${row.idPacote}/movimentacoes/${movementId}`,
        data: movement,
      });
    }

    for (const row of routedRows) {
      const prevDoc = existingPackages.get(row.idPacote);
      const prevItem = previousUnresolvedMap.get(row.idPacote);
      const wasUnresolved = prevDoc?.ultimoResultado === 'NAO_ROTEIRIZADO' || Boolean(prevItem);
      const sameSequence = prevDoc?.ultimaSequencia === attempt.attemptKey;
      const previousCount = Number(prevDoc?.totalTentativas || prevItem?.tentativasCount || 0);
      const tentativasCount = sameSequence
        ? Math.max(1, previousCount)
        : Math.max(1, previousCount + 1);
      const rotaInfo = rotasMap.get(row.idPacote);
      const cicloOrigem = prevDoc?.cicloOrigem || prevItem?.cicloOrigem || normalizeCycle(row.ciclo) || attempt.attemptCycle;
      const cicloDestino = normalizeCycle(rotaInfo?.ciclo) || attempt.attemptCycle;
      const transicao: TransicaoBranca = wasUnresolved ? 'RECUPERADO' : 'ROTEIRIZADO';

      if (wasUnresolved) recuperados++;

      const item: SnapshotItem = {
        idPacote: row.idPacote,
        dataBranca: row.data || attempt.attemptDate,
        base: row.base || prevItem?.base || '',
        cicloOrigem,
        cicloDestino,
        cicloTentativa: cicloDestino,
        etapaFluxo: row.etapaFluxo || prevItem?.etapaFluxo || '',
        motivoMacro: row.motivoMacro || prevItem?.motivoMacro || 'ROTEIRIZADO',
        motivoAnterior: prevDoc?.ultimoMotivo || prevItem?.motivoMacro || '',
        detalheDescartes: row.detalheDescartes || prevItem?.detalheDescartes || '',
        statusTraduzido: wasUnresolved
          ? `Roteirizou no ${cicloDestino}`
          : `Roteirizado no ${cicloDestino}`,
        statusAnterior: prevDoc?.ultimoStatus || prevItem?.statusTraduzido || '',
        transicao,
        tentativasCount,
        categoria: wasUnresolved ? 'RECUPERADO' : 'ROTEIRIZADO',
        categoriaLabel: wasUnresolved ? 'Recuperado' : 'Roteirizado',
        tituloOperacional: wasUnresolved
          ? `Roteirizou (${cicloOrigem} ➔ ${cicloDestino})`
          : `Roteirizado no ${cicloDestino}`,
        explicacaoOperacional: wasUnresolved
          ? `O pacote estava sem rota no ciclo ${cicloOrigem} e apareceu nas rotas do ciclo ${cicloDestino}.`
          : `O pacote está presente na extração de rotas do ciclo ${cicloDestino}.`,
        badgeTipo: 'FATO',
        timestamp: nowTimestamp,
      };
      itemsRecuperados.push(item);

      const movementId = eventId(flowId, attempt.attemptKey, row.idPacote);
      packageWrites.push({
        type: 'set',
        docPath: `packages/${row.idPacote}`,
        data: {
          idPacote: row.idPacote,
          flowId,
          cicloOrigem,
          ultimoResultado: 'ROTEIRIZADO',
          ultimoCiclo: cicloDestino,
          ultimoCicloTentativa: cicloDestino,
          ultimaSequencia: attempt.attemptKey,
          ultimaDataOperacional: attempt.attemptDate,
          ultimoMotivo: item.motivoMacro || 'ROTEIRIZADO',
          ultimoStatus: item.statusTraduzido,
          ultimaTransicao: transicao,
          totalTentativas: tentativasCount,
          updatedAt: nowIso,
          timestamp: nowTimestamp,
        },
      });
      packageWrites.push({
        type: 'set',
        docPath: `packages/${row.idPacote}/movimentacoes/${movementId}`,
        data: {
          id: movementId,
          flowId,
          sequencia: attempt.attemptKey,
          dataOperacional: attempt.attemptDate,
          cicloTentativa: cicloDestino,
          resultado: 'ROTEIRIZADO',
          transicao,
          motivo: item.motivoMacro || '',
          status: item.statusTraduzido,
          dataRegistro: nowIso,
          timestamp: nowTimestamp,
        },
      });
    }

    const itemsAll = [...itemsNaoRoteirizados, ...itemsRecuperados];
    const totalBrancas = effectiveRows.length;
    const totalRoteirizados = routedRows.length;
    const totalNaoRoteirizados = unresolvedRows.length;
    const taxaRoteirizacao = totalBrancas > 0
      ? Number(((totalRoteirizados / totalBrancas) * 100).toFixed(1))
      : 0;

    const visaoGeralSistema = buildVisaoGeral(itemsNaoRoteirizados as any);
    const padroesDetectados: OperationalPatternInsight[] = [];
    if (continuamFalhando > 0) {
      padroesDetectados.push({
        tipo: 'TENDENCIA_RECUPERACAO',
        titulo: 'Persistência entre ciclos',
        descricao: `${continuamFalhando} pacote(s) continuam sem rota no ciclo ${attempt.attemptCycle}.`,
        amostraTexto: `Comparação sequencial em ${attempt.attemptDate}.`,
        badgeTipo: 'PADRAO',
        badgeLabel: 'PADRÃO OBSERVADO',
        relevancia: 'media',
        quantidadeAfetada: continuamFalhando,
      });
    }

    const packageWriteResult = await batchCommitWritesWithRetry(packageWrites, {
      chunkSize: 250,
      maxAttempts: 4,
      baseDelayMs: 450,
      maxDelayMs: 4_000,
      delayBetweenChunksMs: 80,
    });

    const packageSyncPartial = packageWriteResult.failedWrites > 0;
    const writeSyncStatus = packageSyncPartial ? 'PARTIAL' : 'COMPLETE';
    const snapshotId = `snap_${Date.now()}_${currentHash.slice(0, 8)}`;

    const snapshotPayload = {
      id: snapshotId,
      snapshotId,
      flowId,
      hash: currentHash,
      attemptDate: attempt.attemptDate,
      attemptCycle: attempt.attemptCycle,
      attemptKey: attempt.attemptKey,
      attemptOrder: attempt.attemptOrder,
      ciclosDetectados: [attempt.attemptCycle],
      totalBrancas,
      totalRotas: rotasIds.size,
      totalRoteirizados,
      totalNaoRoteirizados,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo,
      roteirizados: totalRoteirizados,
      naoRoteirizados: totalNaoRoteirizados,
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
    const durationMs = Date.now() - startedAt;

    logApi(partialSuccess ? 'warn' : 'info', 'Fluxo sequencial de brancas processado', {
      flowId,
      attemptKey: attempt.attemptKey,
      totalBrancas,
      totalNaoRoteirizados,
      recuperados,
      continuamFalhando,
      durationMs,
    });

    const statusBanner = partialSuccess
      ? `${attempt.attemptDate} ${attempt.attemptCycle}: análise concluída com gravações pendentes.`
      : `${attempt.attemptDate} ${attempt.attemptCycle}: ${recuperados} recuperado(s), ${continuamFalhando} persistente(s), ${novosNaoRoteirizadosCount} novo(s) sem rota.`;

    return sendSuccess(res, {
      ok: true,
      changed: true,
      isNewRun: true,
      hasChanges: true,
      partialSuccess,
      snapshotPersisted,
      snapshotId,
      runId: snapshotId,
      flowId,
      attemptDate: attempt.attemptDate,
      attemptCycle: attempt.attemptCycle,
      attemptKey: attempt.attemptKey,
      ciclosDetectados: [attempt.attemptCycle],
      totalBrancas,
      totalRotas: rotasIds.size,
      totalRoteirizados,
      totalNaoRoteirizados,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo,
      roteirizados: totalRoteirizados,
      naoRoteirizados: totalNaoRoteirizados,
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
      message: 'Fluxo sequencial atualizado por data e ciclo.',
      durationMs,
    });
  } catch (err: any) {
    logApi('error', 'Falha no fluxo sequencial de brancas', {
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return sendError(
      res,
      500,
      'SYNC_ERROR',
      `Erro durante o processamento sequencial: ${err?.message || String(err)}`
    );
  }
}
