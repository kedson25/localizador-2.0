export const BRANCAS_SPREADSHEET_ID = '1hvYeyeXA7RkAX1YoGej6WGBcW1xuUMACyvRLNTJEX6Y';
export const BRANCAS_SHEET_NAME = 'ext_brancas';
export const ROTAS_SHEET_NAME = 'ext_rotas';

type RowObject = Record<string, string>;

type GvizColumn = {
  id?: string;
  label?: string;
};

type GvizCell = {
  v?: unknown;
  f?: string;
} | null;

type GvizRow = {
  c?: GvizCell[];
};

type GvizPayload = {
  status?: string;
  errors?: Array<{ message?: string; detailed_message?: string }>;
  table?: {
    cols?: GvizColumn[];
    rows?: GvizRow[];
  };
};

function normalizeHeader(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizeId(value: unknown): string {
  let result = String(value ?? '').trim();
  if (result.endsWith('.0')) result = result.slice(0, -2);
  return result.replace(/\s+/g, '');
}

function cellValue(cell: GvizCell): string {
  if (!cell) return '';
  if (cell.f !== undefined && cell.f !== null) return String(cell.f).trim();
  if (cell.v !== undefined && cell.v !== null) return String(cell.v).trim();
  return '';
}

function parseGviz(text: string): GvizPayload {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');

  if (start < 0 || end <= start) {
    throw new Error('Resposta inválida do Google Sheets.');
  }

  const payload = JSON.parse(text.slice(start, end + 1)) as GvizPayload;

  if (payload.status === 'error') {
    const details = (payload.errors || [])
      .map(error => error.detailed_message || error.message || '')
      .filter(Boolean)
      .join(' | ');
    throw new Error(details || 'O Google Sheets retornou um erro.');
  }

  return payload;
}

async function readPublicSheet(
  spreadsheetId: string,
  sheetName: string
): Promise<{ headers: string[]; rows: string[][] }> {
  const url =
    `https://docs.google.com/spreadsheets/d/${encodeURIComponent(spreadsheetId)}` +
    `/gviz/tq?tqx=out:json&sheet=${encodeURIComponent(sheetName)}&_=${Date.now()}`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'text/plain,application/json,text/javascript,*/*',
      'User-Agent': 'Localizador-Brancas/1.0',
    },
    redirect: 'follow',
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Google Sheets indisponível (HTTP ${response.status}).`);
  }

  const payload = parseGviz(text);
  const columns = Array.isArray(payload.table?.cols) ? payload.table!.cols! : [];
  const sourceRows = Array.isArray(payload.table?.rows) ? payload.table!.rows! : [];

  const headers = columns.map((column, index) => {
    const label = normalizeHeader(column.label || column.id || '');
    return label || `COL_${index + 1}`;
  });

  const rows = sourceRows.map(row => {
    const cells = Array.isArray(row.c) ? row.c : [];
    return headers.map((_, index) => cellValue(cells[index] || null));
  });

  return { headers, rows };
}

function rowsToObjects(headers: string[], rows: string[][]): RowObject[] {
  return rows.map(row => {
    const result: RowObject = {};
    headers.forEach((header, index) => {
      result[header] = String(row[index] ?? '').trim();
    });
    return result;
  });
}

function getFirst(row: RowObject, names: string[]): string {
  for (const name of names) {
    const value = row[normalizeHeader(name)];
    if (value !== undefined && String(value).trim() !== '') return String(value).trim();
  }
  return '';
}

function findPackageId(row: RowObject): string {
  const direct = getFirst(row, [
    'ID_PACOTE',
    'ID',
    'PACOTE',
    'TRACKING',
    'SHIPMENT_ID',
    'CODIGO_PACOTE',
  ]);
  if (direct) return normalizeId(direct);

  for (const value of Object.values(row)) {
    const candidate = normalizeId(value);
    if (/^\d{6,}$/.test(candidate)) return candidate;
  }

  return '';
}

function reasonLabel(row: RowObject): string {
  return (
    getFirst(row, ['MOTIVO_MACRO', 'MOTIVO', 'REASON', 'MOTIVO_FALHA']) ||
    getFirst(row, ['STATUS_TRADUZIDO', 'STATUS', 'SITUACAO']) ||
    'Sem rota'
  );
}

function statusLabel(row: RowObject): string {
  return (
    getFirst(row, ['STATUS_TRADUZIDO', 'STATUS', 'SITUACAO', 'DESCRICAO']) ||
    reasonLabel(row)
  );
}

function percentage(part: number, total: number): number {
  if (total <= 0) return 0;
  return Number(((part / total) * 100).toFixed(1));
}

export async function buildLiveBrancasReport(options?: {
  spreadsheetId?: string;
  sheetBrancas?: string;
  sheetRotas?: string;
}) {
  const spreadsheetId = options?.spreadsheetId || BRANCAS_SPREADSHEET_ID;
  const sheetBrancas = options?.sheetBrancas || BRANCAS_SHEET_NAME;
  const sheetRotas = options?.sheetRotas || ROTAS_SHEET_NAME;

  const startedAt = Date.now();

  const [brancasSheet, rotasSheet] = await Promise.all([
    readPublicSheet(spreadsheetId, sheetBrancas),
    readPublicSheet(spreadsheetId, sheetRotas),
  ]);

  const brancasRows = rowsToObjects(brancasSheet.headers, brancasSheet.rows);
  const rotasRows = rowsToObjects(rotasSheet.headers, rotasSheet.rows);

  const brancas = brancasRows
    .map(row => ({ row, idPacote: findPackageId(row) }))
    .filter(item => item.idPacote);

  const rotasMap = new Map<string, RowObject>();
  for (const row of rotasRows) {
    const idPacote = findPackageId(row);
    if (idPacote) rotasMap.set(idPacote, row);
  }

  const motivos: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const itemsNaoRoteirizados: any[] = [];
  const itemsRecuperados: any[] = [];
  const itemsAll: any[] = [];
  const ciclosSet = new Set<string>();

  for (const entry of brancas) {
    const row = entry.row;
    const rotaRow = rotasMap.get(entry.idPacote);
    const routed = Boolean(rotaRow);

    const motivoMacro = reasonLabel(row);
    const statusTraduzido = statusLabel(row);
    const cicloOrigem = getFirst(row, ['CICLO', 'CICLO_ORIGEM', 'CYCLE', 'TURNO', 'WAVE']);
    const cicloDestino = rotaRow
      ? getFirst(rotaRow, ['CICLO', 'CICLO_DESTINO', 'CYCLE', 'TURNO', 'WAVE'])
      : '';

    if (cicloOrigem) ciclosSet.add(cicloOrigem);
    if (cicloDestino) ciclosSet.add(cicloDestino);

    const item = {
      idPacote: entry.idPacote,
      dataBranca: getFirst(row, ['DATA', 'DATA_BRANCA', 'DATE', 'DATA_HORA']),
      base: getFirst(row, ['BASE', 'HUB', 'FACILITY', 'ESTACAO', 'STATION', 'UNIDADE']),
      cicloOrigem,
      cicloDestino: cicloDestino || undefined,
      cicloTentativa: cicloDestino || cicloOrigem,
      etapaFluxo: getFirst(row, ['ETAPA_FLUXO', 'ETAPA', 'FLUXO', 'STEP', 'STAGE']),
      motivoMacro,
      detalheDescartes: getFirst(row, [
        'DETALHE_DESCARTES',
        'DETALHE_DESCARTE',
        'DETALHE',
        'SUB_MOTIVO',
        'DETAIL',
      ]),
      statusTraduzido,
      transicao: routed ? 'RECUPERADO' : 'CONTINUA_NAO_ROTEIRIZADO',
      tentativasCount: 1,
      timestamp: Date.now(),
    };

    itemsAll.push(item);

    if (routed) {
      itemsRecuperados.push(item);
    } else {
      itemsNaoRoteirizados.push(item);
      motivos[motivoMacro] = (motivos[motivoMacro] || 0) + 1;
      statusCounts[statusTraduzido] = (statusCounts[statusTraduzido] || 0) + 1;
    }
  }

  const totalBrancas = brancas.length;
  const totalRotas = rotasMap.size;
  const totalRoteirizados = itemsRecuperados.length;
  const totalNaoRoteirizados = itemsNaoRoteirizados.length;
  const taxaRoteirizacao = percentage(totalRoteirizados, totalBrancas);
  const now = new Date();
  const liveId = `live-${now.toISOString().replace(/[:.]/g, '-')}`;

  return {
    hasData: totalBrancas > 0,
    snapshotId: liveId,
    runId: liveId,
    ciclosDetectados: Array.from(ciclosSet),
    createdAt: now.toISOString(),
    timestamp: now.getTime(),
    totalBrancas,
    totalRotas,
    totalRoteirizados,
    totalNaoRoteirizados,
    totalRecuperados: totalRoteirizados,
    totalContinuamFalhando: totalNaoRoteirizados,
    totalMudaramMotivo: 0,
    roteirizados: totalRoteirizados,
    naoRoteirizados: totalNaoRoteirizados,
    recuperados: totalRoteirizados,
    continuamFalhando: totalNaoRoteirizados,
    motivoAlteradoCount: 0,
    novosNaoRoteirizadosCount: totalNaoRoteirizados,
    mudancasMotivoDetalhes: [],
    taxaRoteirizacao,
    extBrancasCount: totalBrancas,
    extRotasCount: totalRotas,
    lastComparisonTime: now.toISOString(),
    lastCheckTime: now.toISOString(),
    statusBanner: `Leitura ao vivo: ${totalBrancas.toLocaleString('pt-BR')} brancas, ${totalRoteirizados.toLocaleString('pt-BR')} encontradas.`,
    motivos,
    statusCounts,
    itemsNaoRoteirizados,
    itemsRecuperados,
    itemsAll,
    visaoGeralSistema: [],
    padroesDetectados: [],
    recentRuns: [],
    source: {
      type: 'google-sheets-live',
      spreadsheetId,
      sheetBrancas,
      sheetRotas,
      durationMs: Date.now() - startedAt,
    },
    message: 'Dados carregados diretamente do Google Sheets.',
  };
}
