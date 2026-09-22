import { BrancaRelatorioResponse, ItemNaoRoteirizado } from './brancasApi';
import { buildVisaoGeral, translateRoutingPattern } from './operationalTranslator';

type CsvRecord = Record<string, string>;

type RotaInfo = {
  idPacote: string;
  ciclo: string;
  rota: string;
};

function normalizeHeader(value: string): string {
  return String(value || '')
    .trim()
    .toUpperCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function normalizePackageId(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = String(value).trim().replace(/^"|"$/g, '');
  if (text.endsWith('.0')) text = text.slice(0, -2);
  return text.trim();
}

function detectDelimiter(text: string): string {
  const sample = text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(0, 8);

  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestScore = -1;

  for (const delimiter of candidates) {
    const score = sample.reduce((sum, line) => {
      let insideQuotes = false;
      let count = 0;
      for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
          if (insideQuotes && line[i + 1] === '"') {
            i++;
          } else {
            insideQuotes = !insideQuotes;
          }
        } else if (!insideQuotes && char === delimiter) {
          count++;
        }
      }
      return sum + count;
    }, 0);

    if (score > bestScore) {
      bestScore = score;
      best = delimiter;
    }
  }

  return best;
}

function parseCsvLine(line: string, delimiter: string): string[] {
  const values: string[] = [];
  let current = '';
  let insideQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (insideQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
      continue;
    }

    if (char === delimiter && !insideQuotes) {
      values.push(current.trim());
      current = '';
      continue;
    }

    current += char;
  }

  values.push(current.trim());
  return values;
}

function parseCsv(text: string): CsvRecord[] {
  const cleanText = String(text || '').replace(/^\uFEFF/, '');
  const lines = cleanText
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0);

  if (lines.length < 2) return [];

  const delimiter = detectDelimiter(cleanText);
  const rawHeaders = parseCsvLine(lines[0], delimiter);
  const headers = rawHeaders.map(normalizeHeader);
  const records: CsvRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i], delimiter);
    const record: CsvRecord = {};

    headers.forEach((header, index) => {
      if (header) record[header] = cells[index] ?? '';
    });

    if (Object.values(record).some((value) => String(value || '').trim())) {
      records.push(record);
    }
  }

  return records;
}

function valueFrom(record: CsvRecord, aliases: string[]): string {
  const normalizedAliases = aliases.map(normalizeHeader);

  for (const alias of normalizedAliases) {
    if (record[alias] !== undefined && String(record[alias]).trim() !== '') {
      return String(record[alias]).trim();
    }
  }

  for (const [key, value] of Object.entries(record)) {
    if (
      normalizedAliases.some(
        (alias) => key.includes(alias) || alias.includes(key)
      ) &&
      String(value || '').trim()
    ) {
      return String(value).trim();
    }
  }

  return '';
}

function getPackageId(record: CsvRecord): string {
  const direct = valueFrom(record, [
    'ID_PACOTE',
    'ID',
    'PACOTE',
    'TRACKING',
    'SHIPMENT_ID',
    'CODIGO_PACOTE',
  ]);

  if (direct) return normalizePackageId(direct);

  for (const value of Object.values(record)) {
    const candidate = normalizePackageId(value);
    if (/^[0-9]{6,18}$/.test(candidate)) return candidate;
  }

  return '';
}

function parseRotas(text: string): Map<string, RotaInfo> {
  const records = parseCsv(text);
  const result = new Map<string, RotaInfo>();

  for (const record of records) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;

    result.set(idPacote, {
      idPacote,
      ciclo: valueFrom(record, ['CICLO', 'CYCLE', 'TURNO', 'WAVE']),
      rota: valueFrom(record, ['ROTA', 'ROUTE', 'ID_ROTA']),
    });
  }

  return result;
}

function makeBaseItem(record: CsvRecord, idPacote: string): Omit<ItemNaoRoteirizado, 'transicao' | 'tentativasCount'> {
  return {
    idPacote,
    dataBranca: valueFrom(record, ['DATA', 'DATE', 'DATA_CRIACAO', 'DATA_BRANCA', 'DATA_HORA']),
    base: valueFrom(record, ['BASE', 'HUB', 'FACILITY', 'ESTACAO', 'STATION', 'UNIDADE']),
    cicloOrigem: valueFrom(record, ['CICLO', 'CICLO_ORIGEM', 'CYCLE', 'TURNO', 'WAVE']) || 'N/D',
    etapaFluxo: valueFrom(record, ['ETAPA_FLUXO', 'ETAPA', 'FLUXO', 'STEP', 'STAGE']),
    motivoMacro: valueFrom(record, ['MOTIVO_MACRO', 'MOTIVO', 'REASON', 'MACRO', 'MOTIVO_FALHA', 'MOTIVO_DESCARTE']) || 'NÃO INFORMADO',
    detalheDescartes: valueFrom(record, ['DETALHE_DESCARTES', 'DETALHE', 'DETAIL', 'DESCARTES', 'SUB_MOTIVO', 'DETALHE_DESCARTE']),
    statusTraduzido: valueFrom(record, ['STATUS_TRADUZIDO', 'STATUS', 'TRADUCAO', 'STATUS_OPERACIONAL', 'SITUACAO', 'DESCRICAO']) || 'Sem rota',
  };
}

export function analisarBrancasPorCsv(
  brancasText: string,
  rotasText: string,
  sourceNames?: { brancas?: string; rotas?: string }
): BrancaRelatorioResponse {
  const brancasRecords = parseCsv(brancasText);
  const rotasMap = parseRotas(rotasText);

  if (brancasRecords.length === 0) {
    throw new Error('O CSV de Brancas está vazio ou não possui linhas de dados válidas.');
  }

  if (rotasMap.size === 0) {
    throw new Error('O CSV de Rotas está vazio ou não foi possível identificar IDs de pacote.');
  }

  const itemsNaoRoteirizados: ItemNaoRoteirizado[] = [];
  const itemsRecuperados: ItemNaoRoteirizado[] = [];
  const motivos: Record<string, number> = {};
  const statusCounts: Record<string, number> = {};
  const cycles = new Set<string>();
  const validBrancasIds = new Set<string>();

  for (const record of brancasRecords) {
    const idPacote = getPackageId(record);
    if (!idPacote) continue;
    if (validBrancasIds.has(idPacote)) continue;
    validBrancasIds.add(idPacote);

    const baseItem = makeBaseItem(record, idPacote);
    if (baseItem.cicloOrigem) cycles.add(baseItem.cicloOrigem.toUpperCase());

    const rotaInfo = rotasMap.get(idPacote);

    if (rotaInfo) {
      const cicloDestino = rotaInfo.ciclo || baseItem.cicloOrigem || 'N/D';
      itemsRecuperados.push({
        ...baseItem,
        cicloDestino,
        statusTraduzido: cicloDestino
          ? `Roteirizou no ${cicloDestino}`
          : 'Roteirizado no CSV de rotas',
        transicao: 'RECUPERADO',
        tentativasCount: 1,
        categoria: 'RECUPERADO',
        categoriaLabel: 'Recuperado',
        tituloOperacional: 'Roteirizado no CSV de rotas',
        explicacaoOperacional: 'O ID está presente no CSV de rotas carregado manualmente.',
        badgeTipo: 'FATO',
        timestamp: Date.now(),
      });
      continue;
    }

    const translation = translateRoutingPattern(
      baseItem.etapaFluxo,
      baseItem.motivoMacro,
      baseItem.detalheDescartes,
      baseItem.statusTraduzido
    );

    const item: ItemNaoRoteirizado = {
      ...baseItem,
      transicao: 'NOVO_NAO_ROTEIRIZADO',
      tentativasCount: 1,
      categoria: translation.categoria,
      categoriaLabel: translation.categoriaLabel,
      tituloOperacional: translation.titulo,
      explicacaoOperacional: translation.explicacao,
      badgeTipo: translation.badgeTipo,
      timestamp: Date.now(),
    };

    itemsNaoRoteirizados.push(item);

    const motivo = item.motivoMacro || 'NÃO INFORMADO';
    motivos[motivo] = (motivos[motivo] || 0) + 1;

    const status = item.statusTraduzido || 'Sem rota';
    statusCounts[status] = (statusCounts[status] || 0) + 1;
  }

  const totalBrancas = validBrancasIds.size;
  const totalRoteirizados = itemsRecuperados.length;
  const totalNaoRoteirizados = itemsNaoRoteirizados.length;
  const now = new Date();
  const nowIso = now.toISOString();
  const taxaRoteirizacao = totalBrancas > 0
    ? Number(((totalRoteirizados / totalBrancas) * 100).toFixed(1))
    : 0;

  return {
    hasData: true,
    snapshotId: `csv_${Date.now()}`,
    runId: `csv_${Date.now()}`,
    ciclosDetectados: Array.from(cycles).sort(),
    createdAt: nowIso,
    timestamp: now.getTime(),
    totalBrancas,
    totalRotas: rotasMap.size,
    totalRoteirizados,
    totalNaoRoteirizados,
    totalRecuperados: totalRoteirizados,
    totalContinuamFalhando: 0,
    totalMudaramMotivo: 0,
    roteirizados: totalRoteirizados,
    naoRoteirizados: totalNaoRoteirizados,
    recuperados: totalRoteirizados,
    continuamFalhando: 0,
    motivoAlteradoCount: 0,
    novosNaoRoteirizadosCount: totalNaoRoteirizados,
    mudancasMotivoDetalhes: [],
    taxaRoteirizacao,
    extBrancasCount: totalBrancas,
    extRotasCount: rotasMap.size,
    lastComparisonTime: nowIso,
    lastCheckTime: nowIso,
    statusBanner: `Modo CSV ativo: ${sourceNames?.brancas || 'Brancas.csv'} + ${sourceNames?.rotas || 'Rotas.csv'}.`,
    motivos,
    statusCounts,
    itemsNaoRoteirizados,
    itemsRecuperados,
    itemsAll: [...itemsNaoRoteirizados, ...itemsRecuperados],
    visaoGeralSistema: buildVisaoGeral(itemsNaoRoteirizados),
    padroesDetectados: [],
    recentRuns: [],
    message: 'Análise local concluída no navegador. Nenhum dado foi enviado ao Google Sheets ou Firestore.',
  };
}
