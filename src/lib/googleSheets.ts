/**
 * Google Sheets Types & Frontend Client Helper
 * O acesso direto à API Google Sheets ocorre estritamente no backend (/api/brancas).
 */

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

export function normalizePackageId(val: any): string {
  if (val === null || val === undefined) return '';
  let str = String(val).trim();
  if (str.endsWith('.0')) {
    str = str.slice(0, -2);
  }
  return str;
}
