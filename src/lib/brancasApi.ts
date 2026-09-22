import { VisaoGeralCategoria, OperationalPatternInsight } from './operationalTranslator';
import { readJsonResponse } from './safeJsonResponse';

export interface MudancaMotivoDetalhe {
  idPacote: string;
  motivoAnterior: string;
  motivoAtual: string;
  statusAnterior: string;
  statusAtual: string;
}

export interface BrancaSyncResponse {
  ok: boolean;
  snapshotId?: string;
  runId?: string;
  ciclosDetectados?: string[];
  totalBrancas?: number;
  totalRotas?: number;
  totalRoteirizados?: number;
  totalNaoRoteirizados?: number;
  totalRecuperados?: number;
  totalContinuamFalhando?: number;
  totalMudaramMotivo?: number;
  roteirizados?: number;
  naoRoteirizados?: number;
  recuperados?: number;
  continuamFalhando?: number;
  motivoAlteradoCount?: number;
  novosNaoRoteirizadosCount?: number;
  mudancasMotivoDetalhes?: MudancaMotivoDetalhe[];
  extBrancasCount?: number;
  extRotasCount?: number;
  taxaRoteirizacao?: number;
  lastComparisonTime?: string;
  lastCheckTime?: string;
  statusBanner?: string;
  isNewRun?: boolean;
  hasChanges?: boolean;
  changed?: boolean;
  durationMs?: number;
  message?: string;
  itemsNaoRoteirizados?: ItemNaoRoteirizado[];
  itemsRecuperados?: ItemNaoRoteirizado[];
  itemsAll?: ItemNaoRoteirizado[];
  motivos?: Record<string, number>;
  statusCounts?: Record<string, number>;
  visaoGeralSistema?: VisaoGeralCategoria[];
  padroesDetectados?: OperationalPatternInsight[];
  error?: {
    code: string;
    message: string;
  };
}

export interface ItemNaoRoteirizado {
  idPacote: string;
  dataBranca: string;
  base: string;
  cicloOrigem: string;
  cicloDestino?: string;
  cicloTentativa?: string;
  etapaFluxo: string;
  motivoMacro: string;
  motivoAnterior?: string;
  detalheDescartes: string;
  statusTraduzido: string;
  statusAnterior?: string;
  transicao: string;
  tentativasCount: number;
  categoria?: string;
  categoriaLabel?: string;
  tituloOperacional?: string;
  explicacaoOperacional?: string;
  badgeTipo?: 'FATO' | 'PADRAO' | 'HIPOTESE';
  timestamp?: number;
}

export interface RecentRunSummary {
  runId: string;
  snapshotId?: string;
  ciclosDetectados?: string[];
  createdAt: string;
  timestamp: number;
  totalBrancas: number;
  roteirizados: number;
  naoRoteirizados: number;
  recuperados?: number;
  taxaRoteirizacao?: number;
}

export interface BrancaRelatorioResponse {
  hasData: boolean;
  snapshotId?: string;
  runId?: string;
  ciclosDetectados?: string[];
  createdAt?: string;
  timestamp?: number;
  totalBrancas: number;
  totalRotas: number;
  totalRoteirizados: number;
  totalNaoRoteirizados: number;
  totalRecuperados: number;
  totalContinuamFalhando: number;
  totalMudaramMotivo?: number;
  roteirizados: number;
  naoRoteirizados: number;
  recuperados: number;
  continuamFalhando: number;
  motivoAlteradoCount?: number;
  novosNaoRoteirizadosCount?: number;
  mudancasMotivoDetalhes?: MudancaMotivoDetalhe[];
  taxaRoteirizacao: number;
  extBrancasCount?: number;
  extRotasCount?: number;
  lastComparisonTime?: string;
  lastCheckTime?: string;
  statusBanner?: string;
  motivos: Record<string, number>;
  statusCounts: Record<string, number>;
  itemsNaoRoteirizados: ItemNaoRoteirizado[];
  itemsRecuperados?: ItemNaoRoteirizado[];
  itemsAll?: ItemNaoRoteirizado[];
  visaoGeralSistema?: VisaoGeralCategoria[];
  padroesDetectados?: OperationalPatternInsight[];
  recentRuns: RecentRunSummary[];
  message?: string;
}

export interface MovimentacaoPacote {
  id: string;
  cicloTentativa: string;
  resultado: 'ROTEIRIZADO' | 'NAO_ROTEIRIZADO';
  transicao: string;
  motivo: string;
  motivoAnterior?: string;
  status: string;
  dataRegistro: string;
  timestamp: number;
  snapshotId?: string;
}

export interface PacoteHistoricoResponse {
  idPacote: string;
  found: boolean;
  ultimoResultado: string | null;
  ultimoCicloTentativa: string | null;
  movimentacoes: MovimentacaoPacote[];
}

/**
 * Dispara o registro ou atualização de uma tentativa de roteirização no backend.
 * Se forceManual for falso e não houver alteração nas planilhas, não cria snapshot duplicado.
 */
export async function registrarTentativaBrancas(
  observacao?: string,
  forceManual: boolean = false
): Promise<BrancaSyncResponse> {
  const res = await fetch('/api/brancas/sync', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      observacao,
      forceManual,
    }),
  });

  const json = await readJsonResponse<any>(res, {
    fallbackMessage: 'Falha ao processar sincronização de Brancas.',
    serverErrorMessage:
      'A API de Brancas está temporariamente indisponível. Tente novamente em alguns instantes ou use o modo CSV.',
  });

  return json.data || json;
}

/**
 * Obtém o relatório consolidado do último snapshot (ou de um snapshot específico).
 * Se autoCheck=true, verifica silenciosamente se há nova extração nas planilhas.
 */
export async function getRelatorioBrancas(
  snapshotId?: string,
  autoCheck: boolean = true
): Promise<BrancaRelatorioResponse> {
  const params = new URLSearchParams();
  if (snapshotId) params.append('snapshotId', snapshotId);
  if (autoCheck) params.append('autoCheck', 'true');

  const queryString = params.toString();
  const url = queryString
    ? `/api/brancas/relatorio?${queryString}`
    : '/api/brancas/relatorio';

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
    },
    cache: 'no-store',
  });

  const json = await readJsonResponse<any>(res, {
    fallbackMessage: 'Falha ao carregar relatório de Brancas.',
    serverErrorMessage:
      'A API de Brancas está temporariamente indisponível. A tela não perdeu seus dados; tente novamente ou use o modo CSV.',
  });

  return json.data || json;
}

/**
 * Carrega a linha do tempo cronológica com todo o histórico de um pacote.
 */
export async function getHistoricoPacote(
  idPacote: string
): Promise<PacoteHistoricoResponse> {
  const res = await fetch(
    `/api/brancas/historico?id=${encodeURIComponent(idPacote)}`,
    {
      method: 'GET',
      headers: {
        Accept: 'application/json',
      },
      cache: 'no-store',
    }
  );

  const json = await readJsonResponse<any>(res, {
    fallbackMessage: 'Falha ao carregar histórico do pacote.',
    serverErrorMessage:
      'O histórico de Brancas está temporariamente indisponível. Tente novamente em alguns instantes.',
  });

  return json.data || json;
}
