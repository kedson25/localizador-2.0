import { RefugoRow, ColetaItem, ColetaLista } from '../types';
import { RefugoScan, getAllItemsForExport } from '../lib/firebase';
import { cleanDigits, normalizeTrackingCode } from '../utils/csvParser';

export interface RotaMapaInfo {
  rota: string;
  refugoTotal: number;
  refugoBipados: number;
  coletaEncontrados: number;
  quantoPassouTotal: number;
  saldoPendente: number;
  progressoPercentual: number;
  bppCount: number;
  itensRefugo: Array<{
    id: string;
    isHighPriority?: boolean;
    passouNoRefugo: boolean;
    passouNaColeta: boolean;
    passouGeral: boolean;
    encontradoPor?: string;
  }>;
}

export interface MapaRefugoCalculo {
  totalRefugo: number;
  totalQuantoPassou: number;
  totalRotasEmColeta: number;
  totalPacotesRefugoEmColeta: number;
  totalSemRotaRefugo: number;
  totalSemRotaPassou: number;
  rotas: RotaMapaInfo[];
  progressoGeralPercentual: number;
}

// Cache em memória de itens de listas para cruzamento instantâneo
const listasItensCache = new Map<string, ColetaItem[]>();

/**
 * Carrega em background os itens das listas de coleta fornecidas (se ainda não estiverem em cache)
 */
export async function carregarItensDeListas(listas: ColetaLista[]): Promise<Map<string, ColetaItem[]>> {
  const promises: Promise<void>[] = [];

  for (const lista of listas) {
    if (!lista.id) continue;
    // Se a lista já veio com itens preenchidos
    if (Array.isArray(lista.itens) && lista.itens.length > 0) {
      listasItensCache.set(lista.id, lista.itens);
      continue;
    }
    // Se não está em cache, carrega
    if (!listasItensCache.has(lista.id)) {
      promises.push(
        getAllItemsForExport(lista.id)
          .then(itens => {
            listasItensCache.set(lista.id, itens || []);
          })
          .catch(err => {
            console.warn(`Erro ao carregar itens da lista ${lista.id}:`, err);
            listasItensCache.set(lista.id, []);
          })
      );
    }
  }

  if (promises.length > 0) {
    await Promise.all(promises);
  }

  return listasItensCache;
}

/**
 * Calcula os dados consolidados do Mapa de Refugo e a quantidade que encontrou de rota em coleta.
 */
export function calcularMapaRefugoEstatisticas(
  refugoRows: RefugoRow[],
  refugoScans: RefugoScan[],
  coletaListas: ColetaLista[],
  cachedListasItens?: Map<string, ColetaItem[]>
): MapaRefugoCalculo {
  const cacheItens = cachedListasItens || listasItensCache;

  // 1. Mapear todos os pacotes bipados na Coleta
  // Guarda informações: código normalizado -> { rota, listaNome, responsavel }
  const coletaCodigosMap = new Map<string, { rota: string; listaNome: string; responsavel?: string }>();
  let totalBipsComRotaEmColeta = 0;

  for (const lista of coletaListas) {
    const itens = cacheItens.get(lista.id) || lista.itens || [];
    const listaRotaPadrao = String(lista.rota || '').trim();

    // Se temos os itens da lista
    if (itens.length > 0) {
      for (const item of itens) {
        const codNorm = normalizeTrackingCode(item.codigo);
        const codDigits = cleanDigits(item.codigo);
        const rotaItem = (item.rota && item.rota.trim() && !item.rota.toUpperCase().includes('SEM ROTA') && !item.rota.toLowerCase().includes('branca'))
          ? item.rota.trim()
          : (listaRotaPadrao && !listaRotaPadrao.toUpperCase().includes('SEM ROTA') && !listaRotaPadrao.toLowerCase().includes('BRANCA') ? listaRotaPadrao : '');

        if (rotaItem) {
          totalBipsComRotaEmColeta++;
        }

        const info = {
          rota: rotaItem,
          listaNome: lista.nome,
          responsavel: item.responsavel || lista.responsavel,
        };

        if (codNorm) coletaCodigosMap.set(codNorm, info);
        if (codDigits) coletaCodigosMap.set(codDigits, info);
      }
    } else if (lista.rotasCount) {
      // Se não temos os itens carregados ainda mas temos rotasCount nos metadados
      Object.entries(lista.rotasCount).forEach(([r, count]) => {
        if (r && !r.toUpperCase().includes('SEM ROTA') && !r.toLowerCase().includes('branca')) {
          totalBipsComRotaEmColeta += Number(count) || 0;
        }
      });
    } else if (listaRotaPadrao && !listaRotaPadrao.toUpperCase().includes('SEM ROTA') && !listaRotaPadrao.toLowerCase().includes('branca')) {
      totalBipsComRotaEmColeta += Number(lista.totalItens || lista.totalValidados || 0);
    }
  }

  // 2. Mapear scans de Refugo
  const refugoScansMap = new Map<string, RefugoScan>();
  for (const scan of refugoScans) {
    const key = scan.normalizedId || normalizeTrackingCode(scan.id);
    const digits = cleanDigits(scan.id);
    if (key) refugoScansMap.set(key, scan);
    if (digits) refugoScansMap.set(digits, scan);
  }

  // 3. Agrupar por rotas da base de Refugo
  const rotasMap = new Map<string, {
    refugoTotal: number;
    bppCount: number;
    itensRefugo: Array<{
      id: string;
      isHighPriority?: boolean;
      passouNoRefugo: boolean;
      passouNaColeta: boolean;
      passouGeral: boolean;
      encontradoPor?: string;
    }>;
    refugoBipadosSet: Set<string>;
    coletaEncontradosSet: Set<string>;
    quantoPassouSet: Set<string>;
  }>();

  let totalPacotesRefugoEmColeta = 0;
  let totalSemRotaRefugo = 0;
  let totalSemRotaPassou = 0;

  for (const row of refugoRows) {
    const rawRota = String(row.rota || '').trim();
    const isSemRota = !rawRota || rawRota.toUpperCase() === 'SEM ROTA' || rawRota.toLowerCase().includes('branca') || rawRota === '-';
    const rotaKey = isSemRota ? 'SEM ROTA' : rawRota.toUpperCase();

    if (isSemRota) {
      totalSemRotaRefugo++;
    }

    if (!rotasMap.has(rotaKey)) {
      rotasMap.set(rotaKey, {
        refugoTotal: 0,
        bppCount: 0,
        itensRefugo: [],
        refugoBipadosSet: new Set(),
        coletaEncontradosSet: new Set(),
        quantoPassouSet: new Set(),
      });
    }

    const group = rotasMap.get(rotaKey)!;
    group.refugoTotal++;

    const isBpp = Boolean(row.isHighPriority);
    if (isBpp) group.bppCount++;

    const normId = normalizeTrackingCode(row.id);
    const digitsId = cleanDigits(row.id);

    // Verificação se passou no refugo
    const refugoScan = refugoScansMap.get(normId) || (digitsId ? refugoScansMap.get(digitsId) : undefined);
    const passouNoRefugo = Boolean(refugoScan);

    // Verificação se passou na coleta
    const coletaMatch = coletaCodigosMap.get(normId) || (digitsId ? coletaCodigosMap.get(digitsId) : undefined);
    const passouNaColeta = Boolean(coletaMatch);

    if (passouNaColeta && !isSemRota) {
      totalPacotesRefugoEmColeta++;
    }

    const passouGeral = passouNoRefugo || passouNaColeta;

    if (passouNoRefugo) {
      group.refugoBipadosSet.add(normId);
    }
    if (passouNaColeta) {
      group.coletaEncontradosSet.add(normId);
    }
    if (passouGeral) {
      group.quantoPassouSet.add(normId);
      if (isSemRota) {
        totalSemRotaPassou++;
      }
    }

    group.itensRefugo.push({
      id: row.id,
      isHighPriority: isBpp,
      passouNoRefugo,
      passouNaColeta,
      passouGeral,
      encontradoPor: refugoScan?.foundBy || coletaMatch?.responsavel || undefined,
    });
  }

  // 4. Também adicionar pacotes bipados no refugo ou coleta que não estavam na base CSV
  for (const scan of refugoScans) {
    const rawRota = String(scan.rota || '').trim();
    const isSemRota = scan.status !== 'found' || !rawRota || rawRota.toUpperCase() === 'SEM ROTA' || rawRota.toLowerCase().includes('branca');
    const rotaKey = isSemRota ? 'SEM ROTA' : rawRota.toUpperCase();

    const normId = scan.normalizedId || normalizeTrackingCode(scan.id);

    // Verifica se já foi contabilizado na base
    let rotaGroup = rotasMap.get(rotaKey);
    if (!rotaGroup) {
      rotaGroup = {
        refugoTotal: 0,
        bppCount: 0,
        itensRefugo: [],
        refugoBipadosSet: new Set(),
        coletaEncontradosSet: new Set(),
        quantoPassouSet: new Set(),
      };
      rotasMap.set(rotaKey, rotaGroup);
    }

    if (!rotaGroup.quantoPassouSet.has(normId)) {
      rotaGroup.refugoBipadosSet.add(normId);
      rotaGroup.quantoPassouSet.add(normId);
      if (isSemRota) totalSemRotaPassou++;
    }
  }

  // 5. Transformar em lista ordenada de RotaMapaInfo
  const rotas: RotaMapaInfo[] = [];
  let totalQuantoPassou = 0;
  let totalRefugoGeral = refugoRows.length;

  rotasMap.forEach((data, rotaNome) => {
    const quantoPassou = data.quantoPassouSet.size;
    const refugoTotal = data.refugoTotal;
    const refugoBipados = data.refugoBipadosSet.size;
    const coletaEncontrados = data.coletaEncontradosSet.size;
    const saldoPendente = Math.max(0, refugoTotal - quantoPassou);
    const progressoPercentual = refugoTotal > 0 ? Math.min(100, Math.round((quantoPassou / refugoTotal) * 100)) : 100;

    totalQuantoPassou += quantoPassou;

    rotas.push({
      rota: rotaNome,
      refugoTotal,
      refugoBipados,
      coletaEncontrados,
      quantoPassouTotal: quantoPassou,
      saldoPendente,
      progressoPercentual,
      bppCount: data.bppCount,
      itensRefugo: data.itensRefugo,
    });
  });

  // Ordenar rotas: colocar 'SEM ROTA' no final e o restante por ordem alfabética ou maior volume
  rotas.sort((a, b) => {
    if (a.rota === 'SEM ROTA') return 1;
    if (b.rota === 'SEM ROTA') return -1;
    return a.rota.localeCompare(b.rota, 'pt-BR', { numeric: true });
  });

  const progressoGeralPercentual = totalRefugoGeral > 0
    ? Math.min(100, Math.round((totalQuantoPassou / totalRefugoGeral) * 100))
    : 0;

  return {
    totalRefugo: totalRefugoGeral,
    totalQuantoPassou,
    totalRotasEmColeta: totalBipsComRotaEmColeta,
    totalPacotesRefugoEmColeta,
    totalSemRotaRefugo,
    totalSemRotaPassou,
    rotas,
    progressoGeralPercentual,
  };
}
