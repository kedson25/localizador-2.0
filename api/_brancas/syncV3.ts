import crypto from 'crypto';
import {
  readBrancas,
  readRotasDetails,
  isGoogleSheetsConfigured,
  BrancaRow,
} from '../_lib/googleSheets';
import { getDocRest, listDocsRest, runQueryRest } from '../_lib/firestore-rest';
import { batchCommitWritesWithRetry } from '../_lib/firestore-safe-batch';
import { sendSuccess, sendError } from '../_lib/response';
import { logApi } from '../_lib/logger';
import { translateRoutingPattern, buildVisaoGeral } from '../_lib/operationalTranslator';

type TransicaoBranca =
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

type FlowControl = {
  flowId: string;
  baseSaved?: boolean;
  baseCount?: number;
  baseDate?: string;
  baseCycle?: string;
  baseSavedAt?: string;
  baseSnapshotId?: string;
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
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
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
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function attemptOrder(dateKey: string, cycle: string): number {
  return (Number(dateKey.replace(/-/g, '')) || 0) * 1000 + cycleRank(cycle);
}

function detectBaseContext(brancas: BrancaRow[], ciclosRotas: string[]) {
  const dates = brancas.map((row) => parseDateKey(row.data)).filter(Boolean).sort();
  const baseDate = dates.at(-1) || saoPauloDateKey();
  const cycles = [
    ...brancas.map((row) => normalizeCycle(row.ciclo)).filter(Boolean),
    ...ciclosRotas.map(normalizeCycle).filter(Boolean),
  ].sort((a, b) => cycleRank(a) - cycleRank(b));
  const baseCycle = cycles[0] || 'AM1';
  return { baseDate, baseCycle };
}

function detectRouteContext(
  ciclosRotas: string[],
  latestSnapshot: any,
  control: FlowControl
) {
  const attemptDate = saoPauloDateKey();
  const cycles = ciclosRotas.map(normalizeCycle).filter(Boolean).sort((a, b) => cycleRank(a) - cycleRank(b));
  const attemptCycle = cycles.at(-1) || normalizeCycle(latestSnapshot?.attemptCycle) || normalizeCycle(control.baseCycle) || 'AM1';
  return {
    attemptDate,
    attemptCycle,
    attemptKey: `${attemptDate}|${attemptCycle}`,
    attemptOrder: attemptOrder(attemptDate, attemptCycle),
  };
}

function calculateRouteHash(rotasIds: Set<string>, attemptKey: string): string {
  return crypto
    .createHash('sha256')
    .update(`${attemptKey}:::${Array.from(rotasIds).sort().join(',')}`)
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

async function getControl(): Promise<FlowControl> {
  const control = await getDocRest('brancas_control/current');
  return {
    flowId: String(control?.flowId || 'default'),
    baseSaved: Boolean(control?.baseSaved),
    baseCount: Number(control?.baseCount || 0),
    baseDate: control?.baseDate || '',
    baseCycle: control?.baseCycle || '',
    baseSavedAt: control?.baseSavedAt || '',
    baseSnapshotId: control?.baseSnapshotId || '',
  };
}

async function getLatestSnapshot(flowId: string): Promise<any | null> {
  let docs = await runQueryRest('routing_snapshots', {
    orderByField: 'timestamp',
    orderDirection: 'DESCENDING',
    limit: 30,
  });
  if (docs.length === 0) {
    docs = await runQueryRest('routing_runs', {
      orderByField: 'timestamp',
      orderDirection: 'DESCENDING',
      limit: 30,
    });
  }
  return docs.find((doc: any) => doc.flowId === flowId) || null;
}

async function loadBaseRows(flowId: string): Promise<BrancaRow[]> {
  const rows: BrancaRow[] = [];
  let pageToken: string | undefined;
  do {
    const page = await listDocsRest(`brancas_bases/${flowId}/items`, 300, pageToken);
    for (const doc of page.documents || []) {
      rows.push({
        idPacote: String(doc.idPacote || doc.id || ''),
        data: String(doc.data || ''),
        base: String(doc.base || ''),
        ciclo: String(doc.ciclo || ''),
        etapaFluxo: String(doc.etapaFluxo || ''),
        motivoMacro: String(doc.motivoMacro || ''),
        detalheDescartes: String(doc.detalheDescartes || ''),
        statusTraduzido: String(doc.statusTraduzido || ''),
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return rows.filter((row) => row.idPacote);
}

function itemFromBase(row: BrancaRow, cycle: string, nowTimestamp: number): SnapshotItem {
  const translation = translateRoutingPattern(
    row.etapaFluxo,
    row.motivoMacro,
    row.detalheDescartes,
    row.statusTraduzido
  );
  return {
    idPacote: row.idPacote,
    dataBranca: row.data,
    base: row.base,
    cicloOrigem: normalizeCycle(row.ciclo) || cycle,
    cicloTentativa: cycle,
    etapaFluxo: row.etapaFluxo,
    motivoMacro: row.motivoMacro || 'NÃO INFORMADO',
    detalheDescartes: row.detalheDescartes,
    statusTraduzido: row.statusTraduzido || 'Sem rota',
    transicao: 'NOVO_NAO_ROTEIRIZADO',
    tentativasCount: 1,
    categoria: translation.categoria,
    categoriaLabel: translation.categoriaLabel,
    tituloOperacional: translation.titulo,
    explicacaoOperacional: translation.explicacao,
    badgeTipo: translation.badgeTipo,
    timestamp: nowTimestamp,
  };
}

export default async function syncV3Handler(req: any, res: any) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Método não permitido');
  }

  if (!isGoogleSheetsConfigured()) {
    return sendError(res, 503, 'SHEETS_NOT_CONFIGURED', 'Google Sheets indisponível. Use o modo CSV.');
  }

  const bodyParams = req.body || {};
  const queryParams = req.query || {};
  const spreadsheetId = bodyParams.spreadsheetId || queryParams.spreadsheetId;
  const sheetBrancas = bodyParams.sheetBrancas || queryParams.sheetBrancas;
  const sheetRotas = bodyParams.sheetRotas || queryParams.sheetRotas;
  const observacao = bodyParams.observacao || queryParams.observacao;
  const startedAt = Date.now();

  try {
    const control = await getControl();
    const flowId = control.flowId;
    const latestSnapshot = await getLatestSnapshot(flowId);
    const rotasDetails = await readRotasDetails(spreadsheetId, sheetRotas);
    const { rotasIds, rotasMap, ciclosRotas } = rotasDetails;

    let baseRows: BrancaRow[] = [];
    let baseWasJustSaved = false;
    let baseDate = control.baseDate || '';
    let baseCycle = control.baseCycle || '';

    if (!control.baseSaved) {
      baseRows = await readBrancas(spreadsheetId, sheetBrancas);
      if (baseRows.length === 0) {
        return sendError(res, 400, 'EMPTY_BRANCAS', 'A ext_brancas precisa ser carregada para criar a base inicial.');
      }
      const baseContext = detectBaseContext(baseRows, ciclosRotas);
      baseDate = baseContext.baseDate;
      baseCycle = baseContext.baseCycle;
      baseWasJustSaved = true;
    }

    const routeContext = baseWasJustSaved
      ? {
          attemptDate: baseDate,
          attemptCycle: baseCycle,
          attemptKey: `${baseDate}|${baseCycle}`,
          attemptOrder: attemptOrder(baseDate, baseCycle),
        }
      : detectRouteContext(ciclosRotas, latestSnapshot, control);

    if (
      latestSnapshot &&
      Number(latestSnapshot.attemptOrder || 0) > routeContext.attemptOrder
    ) {
      return sendError(
        res,
        409,
        'OLDER_SEQUENCE',
        `O ciclo ${routeContext.attemptDate} ${routeContext.attemptCycle} é anterior ao último salvo (${latestSnapshot.attemptDate} ${latestSnapshot.attemptCycle}).`
      );
    }

    const routeHash = calculateRouteHash(rotasIds, routeContext.attemptKey);
    if (
      latestSnapshot &&
      latestSnapshot.routeHash === routeHash &&
      latestSnapshot.attemptKey === routeContext.attemptKey &&
      Number(latestSnapshot.failedPackageWrites || 0) === 0
    ) {
      return sendSuccess(res, {
        ok: true,
        changed: false,
        isNewRun: false,
        hasChanges: false,
        partialSuccess: false,
        ...latestSnapshot,
        snapshotId: latestSnapshot.id,
        runId: latestSnapshot.id,
        lastCheckTime: new Date().toISOString(),
        statusBanner: `${routeContext.attemptDate} ${routeContext.attemptCycle}: nenhuma alteração nas rotas.`,
        message: 'A mesma lista de rotas já foi processada. Nenhuma tentativa foi duplicada.',
      });
    }

    let sourceRows: BrancaRow[] = [];
    let previousUnresolved: SnapshotItem[] = [];

    if (baseWasJustSaved) {
      sourceRows = baseRows;
    } else if (latestSnapshot && Array.isArray(latestSnapshot.itemsNaoRoteirizados)) {
      previousUnresolved = latestSnapshot.itemsNaoRoteirizados;
      sourceRows = previousUnresolved.map((item: SnapshotItem) => ({
        idPacote: item.idPacote,
        data: item.dataBranca || baseDate,
        base: item.base || '',
        ciclo: item.cicloOrigem || baseCycle,
        etapaFluxo: item.etapaFluxo || '',
        motivoMacro: item.motivoMacro || 'NÃO INFORMADO',
        detalheDescartes: item.detalheDescartes || '',
        statusTraduzido: item.statusTraduzido || 'Sem rota',
      }));
    } else {
      sourceRows = await loadBaseRows(flowId);
    }

    if (sourceRows.length === 0) {
      return sendError(res, 409, 'BASE_NOT_FOUND', 'A base de Brancas não foi encontrada. Use “Zerar fluxo” e carregue a ext_brancas novamente.');
    }

    const previousMap = new Map(previousUnresolved.map((item) => [item.idPacote, item]));
    const nowIso = new Date().toISOString();
    const nowTimestamp = Date.now();
    const sameAttempt = latestSnapshot?.attemptKey === routeContext.attemptKey;

    const itemsNaoRoteirizados: SnapshotItem[] = [];
    const itemsRecuperados: SnapshotItem[] = [];
    const motivos: Record<string, number> = {};
    const statusCounts: Record<string, number> = {};
    const writes: Array<{ type: 'set' | 'update' | 'delete'; docPath: string; data?: any }> = [];

    if (baseWasJustSaved) {
      for (const row of baseRows) {
        writes.push({
          type: 'set',
          docPath: `brancas_bases/${flowId}/items/${row.idPacote}`,
          data: {
            ...row,
            flowId,
            savedAt: nowIso,
          },
        });
      }
    }

    let recuperados = 0;
    let continuamFalhando = 0;
    let novosNaoRoteirizadosCount = 0;

    for (const row of sourceRows) {
      const prev = previousMap.get(row.idPacote);
      const rotaInfo = rotasMap.get(row.idPacote);
      const isRouted = rotasIds.has(row.idPacote);
      const cicloOrigem = normalizeCycle(prev?.cicloOrigem || row.ciclo) || baseCycle || routeContext.attemptCycle;
      const previousAttempts = Number(prev?.tentativasCount || 0);
      const tentativasCount = sameAttempt
        ? Math.max(1, previousAttempts || 1)
        : Math.max(1, previousAttempts + 1);

      if (isRouted) {
        const cicloDestino = normalizeCycle(rotaInfo?.ciclo) || routeContext.attemptCycle;
        const recovered = Boolean(prev) && !sameAttempt;
        if (recovered) recuperados++;

        const transicao: TransicaoBranca = recovered ? 'RECUPERADO' : 'ROTEIRIZADO';
        const item: SnapshotItem = {
          idPacote: row.idPacote,
          dataBranca: row.data,
          base: row.base,
          cicloOrigem,
          cicloDestino,
          cicloTentativa: cicloDestino,
          etapaFluxo: row.etapaFluxo,
          motivoMacro: row.motivoMacro || 'ROTEIRIZADO',
          motivoAnterior: prev?.motivoMacro || '',
          detalheDescartes: row.detalheDescartes,
          statusTraduzido: recovered
            ? `Roteirizou no ${cicloDestino}`
            : `Roteirizado no ${cicloDestino}`,
          statusAnterior: prev?.statusTraduzido || '',
          transicao,
          tentativasCount,
          categoria: recovered ? 'RECUPERADO' : 'ROTEIRIZADO',
          categoriaLabel: recovered ? 'Recuperado' : 'Roteirizado',
          tituloOperacional: recovered
            ? `Roteirizou (${cicloOrigem} ➔ ${cicloDestino})`
            : `Roteirizado no ${cicloDestino}`,
          explicacaoOperacional: recovered
            ? `O pacote estava sem rota e apareceu na ext_rotas do ciclo ${cicloDestino}.`
            : `O pacote já aparece na ext_rotas do ciclo ${cicloDestino}.`,
          badgeTipo: 'FATO',
          timestamp: nowTimestamp,
        };
        itemsRecuperados.push(item);

        const movementId = eventId(flowId, routeContext.attemptKey, row.idPacote);
        writes.push({
          type: 'set',
          docPath: `packages/${row.idPacote}`,
          data: {
            idPacote: row.idPacote,
            flowId,
            cicloOrigem,
            ultimoResultado: 'ROTEIRIZADO',
            ultimoCiclo: cicloDestino,
            ultimoCicloTentativa: cicloDestino,
            ultimaSequencia: routeContext.attemptKey,
            ultimaDataOperacional: routeContext.attemptDate,
            ultimoMotivo: item.motivoMacro || '',
            ultimoStatus: item.statusTraduzido || '',
            ultimaTransicao: transicao,
            totalTentativas: tentativasCount,
            updatedAt: nowIso,
            timestamp: nowTimestamp,
          },
        });
        writes.push({
          type: 'set',
          docPath: `packages/${row.idPacote}/movimentacoes/${movementId}`,
          data: {
            id: movementId,
            flowId,
            sequencia: routeContext.attemptKey,
            dataOperacional: routeContext.attemptDate,
            cicloTentativa: cicloDestino,
            resultado: 'ROTEIRIZADO',
            transicao,
            motivo: item.motivoMacro || '',
            status: item.statusTraduzido || '',
            dataRegistro: nowIso,
            timestamp: nowTimestamp,
          },
        });
        continue;
      }

      let item = itemFromBase(row, routeContext.attemptCycle, nowTimestamp);
      if (prev) {
        item = {
          ...item,
          cicloOrigem,
          cicloTentativa: routeContext.attemptCycle,
          motivoAnterior: prev.motivoMacro || '',
          statusAnterior: prev.statusTraduzido || '',
          transicao: sameAttempt ? prev.transicao || 'CONTINUA_NAO_ROTEIRIZADO' : 'CONTINUA_NAO_ROTEIRIZADO',
          tentativasCount,
        };
        if (!sameAttempt) continuamFalhando++;
      } else {
        novosNaoRoteirizadosCount++;
      }
      itemsNaoRoteirizados.push(item);

      const motivo = String(item.motivoMacro || 'NÃO INFORMADO');
      const status = String(item.statusTraduzido || 'Sem rota');
      motivos[motivo] = (motivos[motivo] || 0) + 1;
      statusCounts[status] = (statusCounts[status] || 0) + 1;

      const movementId = eventId(flowId, routeContext.attemptKey, row.idPacote);
      writes.push({
        type: 'set',
        docPath: `packages/${row.idPacote}`,
        data: {
          idPacote: row.idPacote,
          flowId,
          cicloOrigem,
          ultimoResultado: 'NAO_ROTEIRIZADO',
          ultimoCiclo: routeContext.attemptCycle,
          ultimoCicloTentativa: routeContext.attemptCycle,
          ultimaSequencia: routeContext.attemptKey,
          ultimaDataOperacional: routeContext.attemptDate,
          ultimoMotivo: item.motivoMacro || '',
          ultimoStatus: item.statusTraduzido || '',
          ultimaTransicao: item.transicao,
          totalTentativas: tentativasCount,
          updatedAt: nowIso,
          timestamp: nowTimestamp,
        },
      });
      writes.push({
        type: 'set',
        docPath: `packages/${row.idPacote}/movimentacoes/${movementId}`,
        data: {
          id: movementId,
          flowId,
          sequencia: routeContext.attemptKey,
          dataOperacional: routeContext.attemptDate,
          cicloTentativa: routeContext.attemptCycle,
          resultado: 'NAO_ROTEIRIZADO',
          transicao: item.transicao,
          motivo: item.motivoMacro || '',
          status: item.statusTraduzido || '',
          dataRegistro: nowIso,
          timestamp: nowTimestamp,
        },
      });
    }

    const writeResult = await batchCommitWritesWithRetry(writes, {
      chunkSize: 250,
      maxAttempts: 4,
      baseDelayMs: 450,
      maxDelayMs: 4_000,
      delayBetweenChunksMs: 80,
    });

    const baseCount = baseWasJustSaved ? baseRows.length : Number(control.baseCount || latestSnapshot?.baseCount || sourceRows.length);
    const totalNaoRoteirizados = itemsNaoRoteirizados.length;
    const totalRoteirizados = Math.max(0, baseCount - totalNaoRoteirizados);
    const taxaRoteirizacao = baseCount > 0
      ? Number(((totalRoteirizados / baseCount) * 100).toFixed(1))
      : 0;
    const itemsAll = [...itemsNaoRoteirizados, ...itemsRecuperados];
    const snapshotId = `snap_${Date.now()}_${routeHash.slice(0, 8)}`;
    const partial = writeResult.failedWrites > 0;

    const snapshotPayload = {
      id: snapshotId,
      snapshotId,
      flowId,
      baseCount,
      baseDate,
      baseCycle,
      routeHash,
      attemptDate: routeContext.attemptDate,
      attemptCycle: routeContext.attemptCycle,
      attemptKey: routeContext.attemptKey,
      attemptOrder: routeContext.attemptOrder,
      ciclosDetectados: [routeContext.attemptCycle],
      totalBrancas: baseCount,
      totalRotas: rotasIds.size,
      totalRoteirizados,
      totalNaoRoteirizados,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo: 0,
      roteirizados: totalRoteirizados,
      naoRoteirizados: totalNaoRoteirizados,
      recuperados,
      continuamFalhando,
      motivoAlteradoCount: 0,
      novosNaoRoteirizadosCount,
      mudancasMotivoDetalhes: [],
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      motivos,
      statusCounts,
      taxaRoteirizacao,
      extBrancasCount: baseCount,
      extRotasCount: rotasIds.size,
      visaoGeralSistema: buildVisaoGeral(itemsNaoRoteirizados as any),
      padroesDetectados: [],
      observacao: observacao ? String(observacao).trim() : '',
      writeSyncStatus: partial ? 'PARTIAL' : 'COMPLETE',
      totalPackageWrites: writeResult.totalWrites,
      successfulPackageWrites: writeResult.successfulWrites,
      failedPackageWrites: writeResult.failedWrites,
      quotaLimited: writeResult.quotaLimited,
      failedWriteChunks: writeResult.failedChunks,
      createdAt: nowIso,
      timestamp: nowTimestamp,
    };

    const snapshotWrite = await batchCommitWritesWithRetry(
      [
        { type: 'set', docPath: `routing_snapshots/${snapshotId}`, data: snapshotPayload },
        { type: 'set', docPath: `routing_runs/${snapshotId}`, data: snapshotPayload },
      ],
      { chunkSize: 2, maxAttempts: 4, baseDelayMs: 400, maxDelayMs: 4_000, delayBetweenChunksMs: 0 }
    );

    if (baseWasJustSaved && snapshotWrite.failedWrites === 0) {
      await batchCommitWritesWithRetry(
        [{
          type: 'set',
          docPath: 'brancas_control/current',
          data: {
            flowId,
            baseSaved: true,
            baseCount,
            baseDate,
            baseCycle,
            baseSavedAt: nowIso,
            baseSnapshotId: snapshotId,
            timestamp: nowTimestamp,
          },
        }],
        { chunkSize: 1, maxAttempts: 4, baseDelayMs: 300, maxDelayMs: 3_000, delayBetweenChunksMs: 0 }
      );
    }

    const partialSuccess = partial || snapshotWrite.failedWrites > 0;
    const statusBanner = baseWasJustSaved
      ? `Base salva com ${baseCount} Brancas. Ciclo inicial ${routeContext.attemptCycle}.`
      : `${routeContext.attemptDate} ${routeContext.attemptCycle}: ${recuperados} recuperado(s) e ${totalNaoRoteirizados} ainda sem rota.`;

    logApi(partialSuccess ? 'warn' : 'info', 'Brancas processadas com base fixa', {
      flowId,
      baseWasJustSaved,
      baseCount,
      attemptKey: routeContext.attemptKey,
      recuperados,
      totalNaoRoteirizados,
      durationMs: Date.now() - startedAt,
    });

    return sendSuccess(res, {
      ok: true,
      changed: true,
      isNewRun: true,
      hasChanges: true,
      partialSuccess,
      snapshotPersisted: snapshotWrite.failedWrites === 0,
      snapshotId,
      runId: snapshotId,
      flowId,
      baseSaved: true,
      baseCount,
      baseDate,
      baseCycle,
      attemptDate: routeContext.attemptDate,
      attemptCycle: routeContext.attemptCycle,
      attemptKey: routeContext.attemptKey,
      ciclosDetectados: [routeContext.attemptCycle],
      totalBrancas: baseCount,
      totalRotas: rotasIds.size,
      totalRoteirizados,
      totalNaoRoteirizados,
      totalRecuperados: recuperados,
      totalContinuamFalhando: continuamFalhando,
      totalMudaramMotivo: 0,
      roteirizados: totalRoteirizados,
      naoRoteirizados: totalNaoRoteirizados,
      recuperados,
      continuamFalhando,
      motivoAlteradoCount: 0,
      novosNaoRoteirizadosCount,
      mudancasMotivoDetalhes: [],
      itemsNaoRoteirizados,
      itemsRecuperados,
      itemsAll,
      motivos,
      statusCounts,
      taxaRoteirizacao,
      extBrancasCount: baseCount,
      extRotasCount: rotasIds.size,
      visaoGeralSistema: snapshotPayload.visaoGeralSistema,
      padroesDetectados: [],
      writeSyncStatus: snapshotPayload.writeSyncStatus,
      totalPackageWrites: writeResult.totalWrites,
      successfulPackageWrites: writeResult.successfulWrites,
      failedPackageWrites: writeResult.failedWrites,
      quotaLimited: writeResult.quotaLimited || snapshotWrite.quotaLimited,
      lastComparisonTime: nowIso,
      lastCheckTime: nowIso,
      statusBanner,
      message: baseWasJustSaved
        ? 'A ext_brancas foi salva como base fixa. As próximas atualizações usam somente a ext_rotas.'
        : 'Rotas atualizadas contra a base fixa de Brancas.',
      durationMs: Date.now() - startedAt,
    });
  } catch (err: any) {
    logApi('error', 'Falha no fluxo de Brancas com base fixa', {
      error: err?.message || String(err),
      stack: err?.stack,
    });
    return sendError(res, 500, 'SYNC_ERROR', `Erro ao processar Brancas: ${err?.message || String(err)}`);
  }
}
