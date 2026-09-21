import { google } from 'googleapis';
import { SERVICE_ACCOUNT_CREDENTIALS } from './googleCredentials';

export interface BrancaRow {
  idPacote: string;
  data: string;
  base: string;
  ciclo: string;
  etapaFluxo: string;
  motivoMacro: string;
  detalheDescartes: string;
  statusTraduzido: string;
}

const DEFAULT_SPREADSHEET_ID = '1hvYeyeXA7RkAX1YoGej6WGBcW1xuUMACyvRLNTJEX6Y';
const DEFAULT_SHEET_BRANCAS = 'ext_brancas';
const DEFAULT_SHEET_ROTAS = 'ext_rotas';

/**
 * Normaliza qualquer valor de ID para string limpa,
 * removendo casas decimais residuais de planilhas (ex: 48039843277.0) e espaços.
 */
export function normalizePackageId(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  // Se veio formatado com .0 de número float
  if (str.endsWith('.0')) {
    str = str.slice(0, -2);
  }
  return str;
}

export function isGoogleSheetsConfigured(): boolean {
  const email =
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    SERVICE_ACCOUNT_CREDENTIALS.client_email;
  const key =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.FIREBASE_PRIVATE_KEY ||
    SERVICE_ACCOUNT_CREDENTIALS.private_key;
  return Boolean(email && key && email.trim() !== '' && key.trim() !== '');
}

export function getGoogleSheetsClient() {
  const email =
    process.env.GOOGLE_CLIENT_EMAIL ||
    process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ||
    process.env.FIREBASE_CLIENT_EMAIL ||
    SERVICE_ACCOUNT_CREDENTIALS.client_email;
  const rawKey =
    process.env.GOOGLE_PRIVATE_KEY ||
    process.env.FIREBASE_PRIVATE_KEY ||
    SERVICE_ACCOUNT_CREDENTIALS.private_key;
  const spreadsheetId = process.env.GOOGLE_SPREADSHEET_ID || DEFAULT_SPREADSHEET_ID;

  if (!email || !rawKey) {
    throw new Error(
      'GOOGLE_SHEETS_AUTH_MISSING: As credenciais da Service Account (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY ou FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY) não estão configuradas no ambiente.'
    );
  }

  const key = rawKey.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email,
    key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  return { sheets, spreadsheetId };
}

/**
 * Lê a aba ext_brancas da planilha Google com detecção dinâmica ou posicional de colunas.
 * Colunas suportadas:
 * ID_PACOTE, DATA, BASE, CICLO, ETAPA_FLUXO, MOTIVO_MACRO, DETALHE_DESCARTES, STATUS_TRADUZIDO
 */
export async function readBrancas(customSpreadsheetId?: string, customTabName?: string): Promise<BrancaRow[]> {
  const { sheets, spreadsheetId } = getGoogleSheetsClient();
  const targetSheetId = customSpreadsheetId || spreadsheetId;
  const targetTab = customTabName || process.env.GOOGLE_SHEET_BRANCAS || DEFAULT_SHEET_BRANCAS;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: targetSheetId,
    range: `${targetTab}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  // Mapeamento dinâmico de cabeçalho
  let idIdx = 0;
  let dataIdx = 1;
  let baseIdx = 2;
  let cicloIdx = 3;
  let etapaIdx = 4;
  let motivoIdx = 5;
  let detalheIdx = 6;
  let statusIdx = 7;

  let startRow = 0;
  const firstRow = rows[0] || [];

  // Verifica se a primeira linha é cabeçalho
  const isHeaderRow = firstRow.some((cell: any) => {
    const val = String(cell || '').trim().toUpperCase();
    return (
      val.includes('ID') ||
      val.includes('PACOTE') ||
      val.includes('DATA') ||
      val.includes('BASE') ||
      val.includes('CICLO') ||
      val.includes('MOTIVO') ||
      val.includes('STATUS') ||
      val.includes('FLUXO')
    );
  });

  if (isHeaderRow) {
    startRow = 1;
    firstRow.forEach((cell: any, idx: number) => {
      const val = String(cell || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');
      if (val === 'ID' || val === 'ID_PACOTE' || val === 'PACOTE' || val === 'TRACKING' || val === 'SHIPMENT_ID' || val === 'CODIGO_PACOTE') {
        idIdx = idx;
      } else if (val === 'DATA' || val === 'DATE' || val === 'DATA_CRIACAO' || val === 'DATA_BRANCA' || val === 'DATA_HORA') {
        dataIdx = idx;
      } else if (val === 'BASE' || val === 'HUB' || val === 'FACILITY' || val === 'ESTACAO' || val === 'STATION' || val === 'UNIDADE') {
        baseIdx = idx;
      } else if (val === 'CICLO' || val === 'CICLO_ORIGEM' || val === 'CYCLE' || val === 'TURNO' || val === 'WAVE') {
        cicloIdx = idx;
      } else if (val === 'ETAPA_FLUXO' || val === 'ETAPA' || val === 'FLUXO' || val === 'STEP' || val === 'STAGE') {
        etapaIdx = idx;
      } else if (val === 'MOTIVO_MACRO' || val === 'MOTIVO' || val === 'REASON' || val === 'MACRO' || val === 'MOTIVO_FALHA' || val === 'MOTIVO_DESCARTE') {
        motivoIdx = idx;
      } else if (val === 'DETALHE_DESCARTES' || val === 'DETALHE' || val === 'DETAIL' || val === 'DESCARTES' || val === 'SUB_MOTIVO' || val === 'DETALHE_DESCARTE') {
        detalheIdx = idx;
      } else if (val === 'STATUS_TRADUZIDO' || val === 'STATUS' || val === 'TRADUCAO' || val === 'STATUS_OPERACIONAL' || val === 'SITUACAO' || val === 'DESCRICAO') {
        statusIdx = idx;
      }
    });
  }

  const results: BrancaRow[] = [];

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const rawId = row[idIdx];
    const idPacote = normalizePackageId(rawId);

    // Ignora linha sem ID ou se for repetição de cabeçalho
    if (!idPacote || idPacote.toUpperCase() === 'ID_PACOTE' || idPacote.toUpperCase() === 'ID' || idPacote.toUpperCase() === 'PACOTE') {
      continue;
    }

    results.push({
      idPacote,
      data: row[dataIdx] !== undefined ? String(row[dataIdx]).trim() : '',
      base: row[baseIdx] !== undefined ? String(row[baseIdx]).trim() : '',
      ciclo: row[cicloIdx] !== undefined ? String(row[cicloIdx]).trim() : '',
      etapaFluxo: row[etapaIdx] !== undefined ? String(row[etapaIdx]).trim() : '',
      motivoMacro: row[motivoIdx] !== undefined ? String(row[motivoIdx]).trim() : '',
      detalheDescartes: row[detalheIdx] !== undefined ? String(row[detalheIdx]).trim() : '',
      statusTraduzido: row[statusIdx] !== undefined ? String(row[statusIdx]).trim() : '',
    });
  }

  return results;
}

/**
 * Lê a aba ext_rotas e retorna um Set<string> com os IDs normalizados dos pacotes roteirizados,
 * além do mapeamento detalhado com ciclo/turno se disponível.
 */
export async function readRotasDetails(customSpreadsheetId?: string, customTabName?: string): Promise<{
  rotasIds: Set<string>;
  rotasMap: Map<string, { idPacote: string; ciclo: string; rota: string }>;
  ciclosRotas: string[];
}> {
  const { sheets, spreadsheetId } = getGoogleSheetsClient();
  const targetSheetId = customSpreadsheetId || spreadsheetId;
  const targetTab = customTabName || process.env.GOOGLE_SHEET_ROTAS || DEFAULT_SHEET_ROTAS;

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: targetSheetId,
    range: `${targetTab}!A:Z`,
  });

  const rows = response.data.values || [];
  const rotasIds = new Set<string>();
  const rotasMap = new Map<string, { idPacote: string; ciclo: string; rota: string }>();
  const ciclosSet = new Set<string>();

  if (rows.length === 0) return { rotasIds, rotasMap, ciclosRotas: [] };

  // Detecta colunas se houver cabeçalho
  let targetColIdx = 0;
  let cicloColIdx = -1;
  let rotaColIdx = -1;
  let startRow = 0;
  const firstRow = rows[0] || [];

  const isHeaderRow = firstRow.some((cell: any) => {
    const val = String(cell || '').trim().toUpperCase();
    return val.includes('ID') || val.includes('PACOTE') || val.includes('ROTA') || val.includes('TRACKING') || val.includes('CICLO');
  });

  if (isHeaderRow) {
    startRow = 1;
    firstRow.forEach((cell: any, idx: number) => {
      const val = String(cell || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');
      if (val === 'ID' || val === 'ID_PACOTE' || val === 'PACOTE' || val === 'TRACKING' || val === 'SHIPMENT_ID') {
        targetColIdx = idx;
      } else if (val === 'CICLO' || val === 'TURNO' || val === 'CYCLE' || val === 'WAVE') {
        cicloColIdx = idx;
      } else if (val === 'ROTA' || val === 'ROUTE' || val === 'ID_ROTA') {
        rotaColIdx = idx;
      }
    });
  }

  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    let rawId = row[targetColIdx];
    let id = normalizePackageId(rawId);

    if (!id || id.toUpperCase() === 'ID' || id.toUpperCase() === 'ID_PACOTE' || id.toUpperCase() === 'ROTA' || id.toUpperCase() === 'PACOTE') {
      for (let c = 0; c < row.length; c++) {
        const candidate = normalizePackageId(row[c]);
        if (candidate && candidate.length >= 6 && !candidate.toUpperCase().includes('ID') && !candidate.toUpperCase().includes('ROTA')) {
          id = candidate;
          break;
        }
      }
    }

    if (id && id.toUpperCase() !== 'ID' && id.toUpperCase() !== 'ID_PACOTE' && id.toUpperCase() !== 'ROTA' && id.toUpperCase() !== 'PACOTE') {
      const ciclo = cicloColIdx >= 0 && row[cicloColIdx] ? String(row[cicloColIdx]).trim() : '';
      const rota = rotaColIdx >= 0 && row[rotaColIdx] ? String(row[rotaColIdx]).trim() : '';

      if (ciclo) ciclosSet.add(ciclo.toUpperCase());

      rotasIds.add(id);
      rotasMap.set(id, { idPacote: id, ciclo, rota });
    }
  }

  return {
    rotasIds,
    rotasMap,
    ciclosRotas: Array.from(ciclosSet),
  };
}

/**
 * Lê a aba ext_rotas e retorna um Set<string> com os IDs normalizados dos pacotes roteirizados.
 */
export async function readRotasIds(customSpreadsheetId?: string, customTabName?: string): Promise<Set<string>> {
  const details = await readRotasDetails(customSpreadsheetId, customTabName);
  return details.rotasIds;
}
