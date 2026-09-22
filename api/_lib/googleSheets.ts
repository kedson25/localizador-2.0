import crypto from 'crypto';
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
const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

export function normalizePackageId(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.endsWith('.0')) str = str.slice(0, -2);
  return str;
}

function getCredentials() {
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
  const key = rawKey ? rawKey.replace(/\\n/g, '\n') : '';

  return { email, key, spreadsheetId };
}

export function isGoogleSheetsConfigured(): boolean {
  const { email, key } = getCredentials();
  return Boolean(email && key && email.trim() !== '' && key.trim() !== '');
}

function base64Url(input: string | Buffer): string {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
  return buffer
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

async function getAccessToken(): Promise<string> {
  const nowMs = Date.now();
  if (cachedAccessToken && cachedAccessToken.expiresAt - 60_000 > nowMs) {
    return cachedAccessToken.token;
  }

  const { email, key } = getCredentials();
  if (!email || !key) {
    throw new Error(
      'GOOGLE_SHEETS_AUTH_MISSING: Configure GOOGLE_CLIENT_EMAIL/GOOGLE_PRIVATE_KEY ou FIREBASE_CLIENT_EMAIL/FIREBASE_PRIVATE_KEY.'
    );
  }

  const now = Math.floor(nowMs / 1000);
  const header = base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64Url(
    JSON.stringify({
      iss: email,
      scope: SHEETS_SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );

  const unsignedJwt = `${header}.${claims}`;
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(unsignedJwt);
  signer.end();
  const signature = signer.sign(key);
  const assertion = `${unsignedJwt}.${base64Url(signature)}`;

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const response = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok || !payload.access_token) {
    throw new Error(
      `GOOGLE_AUTH_FAILED (${response.status}): ${payload.error_description || payload.error || text || 'Falha ao obter token'}`
    );
  }

  const expiresIn = Number(payload.expires_in || 3600);
  cachedAccessToken = {
    token: String(payload.access_token),
    expiresAt: nowMs + expiresIn * 1000,
  };

  return cachedAccessToken.token;
}

async function readSheetValues(
  spreadsheetId: string,
  range: string
): Promise<any[][]> {
  const token = await getAccessToken();
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(
    spreadsheetId
  )}/values/${encodeURIComponent(range)}?majorDimension=ROWS`;

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
    },
  });

  const text = await response.text();
  let payload: any = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!response.ok) {
    const googleMessage = payload?.error?.message || text || 'Falha ao ler Google Sheets';
    throw new Error(`GOOGLE_SHEETS_READ_FAILED (${response.status}): ${googleMessage}`);
  }

  return Array.isArray(payload.values) ? payload.values : [];
}

export async function readBrancas(
  customSpreadsheetId?: string,
  customTabName?: string
): Promise<BrancaRow[]> {
  const { spreadsheetId } = getCredentials();
  const targetSheetId = customSpreadsheetId || spreadsheetId;
  const targetTab = customTabName || process.env.GOOGLE_SHEET_BRANCAS || DEFAULT_SHEET_BRANCAS;
  const rows = await readSheetValues(targetSheetId, `${targetTab}!A:Z`);

  if (rows.length === 0) return [];

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
      if (
        val === 'ID' ||
        val === 'ID_PACOTE' ||
        val === 'PACOTE' ||
        val === 'TRACKING' ||
        val === 'SHIPMENT_ID' ||
        val === 'CODIGO_PACOTE'
      ) {
        idIdx = idx;
      } else if (
        val === 'DATA' ||
        val === 'DATE' ||
        val === 'DATA_CRIACAO' ||
        val === 'DATA_BRANCA' ||
        val === 'DATA_HORA'
      ) {
        dataIdx = idx;
      } else if (
        val === 'BASE' ||
        val === 'HUB' ||
        val === 'FACILITY' ||
        val === 'ESTACAO' ||
        val === 'STATION' ||
        val === 'UNIDADE'
      ) {
        baseIdx = idx;
      } else if (
        val === 'CICLO' ||
        val === 'CICLO_ORIGEM' ||
        val === 'CYCLE' ||
        val === 'TURNO' ||
        val === 'WAVE'
      ) {
        cicloIdx = idx;
      } else if (
        val === 'ETAPA_FLUXO' ||
        val === 'ETAPA' ||
        val === 'FLUXO' ||
        val === 'STEP' ||
        val === 'STAGE'
      ) {
        etapaIdx = idx;
      } else if (
        val === 'MOTIVO_MACRO' ||
        val === 'MOTIVO' ||
        val === 'REASON' ||
        val === 'MACRO' ||
        val === 'MOTIVO_FALHA' ||
        val === 'MOTIVO_DESCARTE'
      ) {
        motivoIdx = idx;
      } else if (
        val === 'DETALHE_DESCARTES' ||
        val === 'DETALHE' ||
        val === 'DETAIL' ||
        val === 'DESCARTES' ||
        val === 'SUB_MOTIVO' ||
        val === 'DETALHE_DESCARTE'
      ) {
        detalheIdx = idx;
      } else if (
        val === 'STATUS_TRADUZIDO' ||
        val === 'STATUS' ||
        val === 'TRADUCAO' ||
        val === 'STATUS_OPERACIONAL' ||
        val === 'SITUACAO' ||
        val === 'DESCRICAO'
      ) {
        statusIdx = idx;
      }
    });
  }

  const results: BrancaRow[] = [];
  for (let i = startRow; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;

    const idPacote = normalizePackageId(row[idIdx]);
    if (
      !idPacote ||
      idPacote.toUpperCase() === 'ID_PACOTE' ||
      idPacote.toUpperCase() === 'ID' ||
      idPacote.toUpperCase() === 'PACOTE'
    ) {
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

export async function readRotasDetails(
  customSpreadsheetId?: string,
  customTabName?: string
): Promise<{
  rotasIds: Set<string>;
  rotasMap: Map<string, { idPacote: string; ciclo: string; rota: string }>;
  ciclosRotas: string[];
}> {
  const { spreadsheetId } = getCredentials();
  const targetSheetId = customSpreadsheetId || spreadsheetId;
  const targetTab = customTabName || process.env.GOOGLE_SHEET_ROTAS || DEFAULT_SHEET_ROTAS;
  const rows = await readSheetValues(targetSheetId, `${targetTab}!A:Z`);

  const rotasIds = new Set<string>();
  const rotasMap = new Map<string, { idPacote: string; ciclo: string; rota: string }>();
  const ciclosSet = new Set<string>();

  if (rows.length === 0) return { rotasIds, rotasMap, ciclosRotas: [] };

  let targetColIdx = 0;
  let cicloColIdx = -1;
  let rotaColIdx = -1;
  let startRow = 0;
  const firstRow = rows[0] || [];

  const isHeaderRow = firstRow.some((cell: any) => {
    const val = String(cell || '').trim().toUpperCase();
    return (
      val.includes('ID') ||
      val.includes('PACOTE') ||
      val.includes('ROTA') ||
      val.includes('TRACKING') ||
      val.includes('CICLO')
    );
  });

  if (isHeaderRow) {
    startRow = 1;
    firstRow.forEach((cell: any, idx: number) => {
      const val = String(cell || '').trim().toUpperCase().replace(/[\s_-]+/g, '_');
      if (
        val === 'ID' ||
        val === 'ID_PACOTE' ||
        val === 'PACOTE' ||
        val === 'TRACKING' ||
        val === 'SHIPMENT_ID'
      ) {
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

    let id = normalizePackageId(row[targetColIdx]);
    if (
      !id ||
      id.toUpperCase() === 'ID' ||
      id.toUpperCase() === 'ID_PACOTE' ||
      id.toUpperCase() === 'ROTA' ||
      id.toUpperCase() === 'PACOTE'
    ) {
      for (let c = 0; c < row.length; c++) {
        const candidate = normalizePackageId(row[c]);
        if (
          candidate &&
          candidate.length >= 6 &&
          !candidate.toUpperCase().includes('ID') &&
          !candidate.toUpperCase().includes('ROTA')
        ) {
          id = candidate;
          break;
        }
      }
    }

    if (
      id &&
      id.toUpperCase() !== 'ID' &&
      id.toUpperCase() !== 'ID_PACOTE' &&
      id.toUpperCase() !== 'ROTA' &&
      id.toUpperCase() !== 'PACOTE'
    ) {
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

export async function readRotasIds(
  customSpreadsheetId?: string,
  customTabName?: string
): Promise<Set<string>> {
  const details = await readRotasDetails(customSpreadsheetId, customTabName);
  return details.rotasIds;
}
