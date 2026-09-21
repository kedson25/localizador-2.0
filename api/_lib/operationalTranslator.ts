export type CategoriaPadrao = 
  | 'DIVERGENCIA_HU'
  | 'OUTRO_CICLO'
  | 'SEM_ROTA'
  | 'AGUARDANDO'
  | 'SEM_CICLO'
  | 'REGRA_LOGISTICA'
  | 'JA_AVANCOU'
  | 'OUTROS';

export type BadgeTipo = 'FATO' | 'PADRAO' | 'HIPOTESE';
export type NivelSeveridade = 'alerta' | 'atencao' | 'info' | 'sucesso' | 'aviso';

export interface RoutingTranslation {
  categoria: CategoriaPadrao;
  categoriaLabel: string;
  titulo: string;
  explicacao: string;
  interpretacao: string;
  resumoCurto: string;
  nivel: NivelSeveridade;
  hipoteses: string[];
  detalheEspecifico?: string;
  badgeTipo: BadgeTipo;
  tags: string[];
}

export function translateRoutingPattern(
  etapaFluxo?: string,
  motivoMacro?: string,
  detalheDescartes?: string,
  statusTraduzido?: string
): RoutingTranslation {
  const motivo = (motivoMacro || '').trim().toUpperCase();
  const detalhe = (detalheDescartes || '').trim().toUpperCase();
  const etapa = (etapaFluxo || '').trim().toUpperCase();
  const status = (statusTraduzido || '').trim();

  // 1. PADRÃO 1: DIVERGÊNCIA DE HU (HU_MISMATCH / HU_MISM_*)
  if (
    motivo.includes('HU_MISM') ||
    motivo.includes('HU_MISMATCH') ||
    detalhe.includes('HU_MISM') ||
    status.toLowerCase().includes('divergência de gaiola') ||
    status.toLowerCase().includes('divergência de contêiner') ||
    status.toLowerCase().includes('divergência no xd')
  ) {
    let detalheTexto = 'Divergência entre a unidade de manuseio esperada e a associação encontrada.';
    if (motivo.includes('HU_MISM_FBM_OTHERS') || detalhe.includes('FBM_OTHERS')) {
      detalheTexto = 'Divergência de HU associada ao fluxo FBM.';
    } else if (motivo.includes('HU_MISM_FBM_SORTING') || motivo.includes('RESTRICTIONS') || status.toLowerCase().includes('sorting')) {
      detalheTexto = 'Divergência de HU relacionada a uma restrição de sorting.';
    } else if (motivo.includes('HU_MISM_XD_OTHERS') || detalhe.includes('XD_OTHERS')) {
      detalheTexto = 'Divergência de HU identificada no fluxo XD.';
    } else if (motivo.includes('HU_MISM_V2_XSP10') || detalhe.includes('V2_XSP10') || status.includes('V2 - XSP10')) {
      detalheTexto = 'Divergência de contêiner V2 relacionada ao XSP10.';
    } else if (motivo.includes('HU_MISM_V4_XSP10') || detalhe.includes('V4_XSP10') || status.includes('V4 - XSP10')) {
      detalheTexto = 'Divergência de contêiner V4 relacionada ao XSP10.';
    } else if (motivo.includes('HU_MISM_V4_XSP9') || detalhe.includes('V4_XSP9') || status.includes('V4 - XSP9')) {
      detalheTexto = 'Divergência de contêiner V4 relacionada ao XSP9.';
    } else if (motivo.includes('PRIORITY_WAVE') || status.toLowerCase().includes('onda prioritária')) {
      detalheTexto = 'Divergência relacionada ao atraso de uma onda prioritária.';
    }

    return {
      categoria: 'DIVERGENCIA_HU',
      categoriaLabel: 'Divergência de HU',
      titulo: 'Divergência de HU',
      explicacao: 'O pacote possui uma divergência entre a unidade de manuseio esperada e a associação encontrada pelo sistema.',
      interpretacao: 'Pode envolver gaiola, saca, contêiner ou associação lógica entre sistemas operacionais.',
      resumoCurto: 'A HU encontrada não bate com a HU esperada.',
      nivel: 'atencao',
      hipoteses: [
        'Possível inconsistência entre a unidade física e o cadastro no sistema.',
        'Pode demandar reconciliação de contêiner ou fechamento de onda.'
      ],
      detalheEspecifico: detalheTexto,
      badgeTipo: 'FATO',
      tags: ['HU', 'Contêiner/Gaiola', 'Associação Lógica']
    };
  }

  // 2. PADRÃO 2: ROUTED_IN_OTHER_CYCLE
  if (
    motivo.includes('ROUTED_IN_OTHER_CYCLE') ||
    detalhe.includes('ROUTED_IN_AM') ||
    detalhe.includes('ROUTED_IN_PM') ||
    status.toLowerCase().includes('outro ciclo')
  ) {
    return {
      categoria: 'OUTRO_CICLO',
      categoriaLabel: 'Outro ciclo',
      titulo: 'Rota associada a outro ciclo',
      explicacao: 'O sistema encontrou uma rota associada a um ciclo diferente.',
      interpretacao: 'Possível vínculo com ciclo anterior. Acompanhar histórico para confirmar.',
      resumoCurto: 'Tem rota, mas está relacionada a outro ciclo.',
      nivel: 'aviso',
      hipoteses: [
        'Possível vínculo com ciclo anterior dificultando nova alocação no ciclo corrente.',
        'Necessita acompanhamento histórico para verificar se persiste.'
      ],
      detalheEspecifico: 'Possível vínculo com ciclo anterior. Acompanhar histórico para confirmar.',
      badgeTipo: 'HIPOTESE',
      tags: ['Vínculo de Ciclo', 'Hipótese Operacional']
    };
  }

  // 3. PADRÃO 3: WITHOUT_ROUTING
  if (
    motivo.includes('WITHOUT_ROUTING') ||
    status.toLowerCase() === 'sem rota'
  ) {
    return {
      categoria: 'SEM_ROTA',
      categoriaLabel: 'Sem rota',
      titulo: 'Sem rota',
      explicacao: 'O pacote não recebeu uma rota válida nesta tentativa.',
      interpretacao: 'O algoritmo de roteirização executou mas não atribuiu percurso para este pacote nesta rodada.',
      resumoCurto: 'Não recebeu rota.',
      nivel: 'alerta',
      hipoteses: [
        'Capacidade de rotas esgotada para a região ou ausência de malha de entrega configurada.',
        'Frequentemente recuperado em tentativas com novos despachos ou consolidações.'
      ],
      detalheEspecifico: 'Não recebeu rota válida nesta tentativa.',
      badgeTipo: 'FATO',
      tags: ['Sem Rota', 'Capacidade']
    };
  }

  // 4. PADRÃO 4: PENDING_ROUTING
  if (
    motivo.includes('PENDING_ROUTING') ||
    status.toLowerCase().includes('aguardando roteirização')
  ) {
    return {
      categoria: 'AGUARDANDO',
      categoriaLabel: 'Aguardando',
      titulo: 'Aguardando roteirização',
      explicacao: 'O pacote ainda estava aguardando o processamento da roteirização.',
      interpretacao: 'O item entrou na fila de processamento mas a execução do roteirizador ainda não havia concluído no momento do corte.',
      resumoCurto: 'A roteirização ainda não tinha sido concluída.',
      nivel: 'info',
      hipoteses: [
        'Fila de processamento em andamento.',
        'Geralmente finaliza a alocação nas extrações subsequentes.'
      ],
      detalheEspecifico: 'Aguardando conclusão do processamento.',
      badgeTipo: 'FATO',
      tags: ['Fila', 'Em Processamento']
    };
  }

  // 5. PADRÃO 5: DAYS_WITHOUT_CYCLE
  if (
    motivo.includes('DAYS_WITHOUT_CYCLE') ||
    detalhe.includes('NO_CYCLE') ||
    status.toLowerCase().includes('sem ciclo')
  ) {
    const isSunday = detalhe.includes('SUNDAY') || status.toLowerCase().includes('domingo');
    const detalheTexto = isSunday 
      ? 'Não havia ciclo válido disponível para o despacho no domingo.' 
      : 'Não havia um ciclo válido disponível para aquela condição de despacho.';

    return {
      categoria: 'SEM_CICLO',
      categoriaLabel: 'Sem ciclo',
      titulo: 'Sem ciclo disponível',
      explicacao: 'Não havia um ciclo válido disponível para aquela condição de despacho.',
      interpretacao: detalheTexto,
      resumoCurto: 'O pacote precisava de um ciclo que não estava disponível.',
      nivel: 'aviso',
      hipoteses: [
        'Calendário de operação sem grade ativa para a data/horário.',
        'Aguardando abertura da janela do próximo ciclo programado.'
      ],
      detalheEspecifico: detalheTexto,
      badgeTipo: 'FATO',
      tags: ['Grade Horária', 'Calendário']
    };
  }

  // 6. PADRÃO 6: NO_CHEAPEST
  if (
    motivo.includes('NO_CHEAPEST') ||
    status.toLowerCase().includes('opção mais barata') ||
    status.toLowerCase().includes('perda alinhada')
  ) {
    return {
      categoria: 'REGRA_LOGISTICA',
      categoriaLabel: 'Regra logística',
      titulo: 'Condição de custo / opção logística',
      explicacao: 'O pacote entrou em uma condição relacionada à escolha da opção logística de menor custo.',
      interpretacao: 'Possível relação com disponibilidade de ciclo/opção logística de menor custo. Necessita confirmação pelo histórico.',
      resumoCurto: 'A opção logística esperada não estava disponível ou não foi utilizada.',
      nivel: 'atencao',
      hipoteses: [
        'Possível relação com disponibilidade de ciclo/opção logística de menor custo (ex: CHP). Necessita confirmação pelo histórico.',
        'Otimizador rejeitou rotas alternativas devido a teto orçamentário configurado.'
      ],
      detalheEspecifico: 'Possível relação com disponibilidade de opção de menor custo. Acompanhar evolução.',
      badgeTipo: 'HIPOTESE',
      tags: ['Custo Logístico', 'Otimização']
    };
  }

  // 7. PADRÃO 7: DISPATCHED_CPM
  if (
    motivo.includes('DISPATCHED_CPM') ||
    etapa.includes('DISPATCHED_CPM') ||
    status.toLowerCase().includes('despachado')
  ) {
    return {
      categoria: 'JA_AVANCOU',
      categoriaLabel: 'Já avançou',
      titulo: 'Já avançou no fluxo',
      explicacao: 'O pacote já havia avançado para uma etapa de despacho.',
      interpretacao: 'O pacote seguiu para expedição ou transbordo intermediário (ex: NEx).',
      resumoCurto: 'Já havia seguido no fluxo.',
      nivel: 'sucesso',
      hipoteses: [
        'Item já transferido para outro nó da malha.',
        'Não requer nova tentativa no hub de origem.'
      ],
      detalheEspecifico: 'Pacote já avançou no fluxo operacional.',
      badgeTipo: 'FATO',
      tags: ['Expedido', 'Avançado']
    };
  }

  // DEFAULT / OUTROS
  return {
    categoria: 'OUTROS',
    categoriaLabel: 'Outros',
    titulo: motivoMacro || statusTraduzido || 'Status Não Mapeado',
    explicacao: statusTraduzido || motivoMacro || 'Situação registrada pelo sistema logístico.',
    interpretacao: 'Condição operacional específica registrada nos campos de extração.',
    resumoCurto: statusTraduzido || motivoMacro || 'Situação não classificada.',
    nivel: 'info',
    hipoteses: ['Verificar logs detalhados de descartes.'],
    detalheEspecifico: detalheDescartes || statusTraduzido || '',
    badgeTipo: 'FATO',
    tags: ['Geral']
  };
}

export interface OperationalPatternInsight {
  tipo: 'POSSIVEL_TRAVA_CICLO_ANTERIOR' | 'TENDENCIA_RECUPERACAO' | 'RECUPERACAO_POR_CICLO' | 'CATEGORIA_DESTAQUE';
  titulo: string;
  descricao: string;
  amostraTexto: string;
  badgeTipo: BadgeTipo;
  badgeLabel: string;
  relevancia: 'alta' | 'media' | 'baixa';
  categoria?: CategoriaPadrao;
  quantidadeAfetada: number;
}

export interface VisaoGeralCategoria {
  categoria: CategoriaPadrao;
  label: string;
  quantidade: number;
  resumo: string;
  badgeTipo: BadgeTipo;
}

export function buildVisaoGeral(itemsNaoRoteirizados: Array<{ motivoMacro?: string; statusTraduzido?: string; detalheDescartes?: string; etapaFluxo?: string }>): VisaoGeralCategoria[] {
  const counts: Record<CategoriaPadrao, number> = {
    SEM_CICLO: 0,
    SEM_ROTA: 0,
    REGRA_LOGISTICA: 0,
    DIVERGENCIA_HU: 0,
    OUTRO_CICLO: 0,
    AGUARDANDO: 0,
    JA_AVANCOU: 0,
    OUTROS: 0,
  };

  for (const item of itemsNaoRoteirizados) {
    const t = translateRoutingPattern(item.etapaFluxo, item.motivoMacro, item.detalheDescartes, item.statusTraduzido);
    counts[t.categoria] = (counts[t.categoria] || 0) + 1;
  }

  const result: VisaoGeralCategoria[] = [];

  if (counts.SEM_CICLO > 0) {
    result.push({
      categoria: 'SEM_CICLO',
      label: 'SEM CICLO',
      quantidade: counts.SEM_CICLO,
      resumo: 'Não havia ciclo válido para aquela condição de despacho.',
      badgeTipo: 'FATO',
    });
  }

  if (counts.SEM_ROTA > 0) {
    result.push({
      categoria: 'SEM_ROTA',
      label: 'SEM ROTA',
      quantidade: counts.SEM_ROTA,
      resumo: 'Não receberam rota válida nesta tentativa.',
      badgeTipo: 'FATO',
    });
  }

  if (counts.REGRA_LOGISTICA > 0) {
    result.push({
      categoria: 'REGRA_LOGISTICA',
      label: 'REGRA LOGÍSTICA',
      quantidade: counts.REGRA_LOGISTICA,
      resumo: 'Condição relacionada à opção logística de menor custo.',
      badgeTipo: 'HIPOTESE',
    });
  }

  if (counts.DIVERGENCIA_HU > 0) {
    result.push({
      categoria: 'DIVERGENCIA_HU',
      label: 'DIVERGÊNCIA DE HU',
      quantidade: counts.DIVERGENCIA_HU,
      resumo: 'Divergência entre a unidade de manuseio esperada e a associação encontrada.',
      badgeTipo: 'FATO',
    });
  }

  if (counts.OUTRO_CICLO > 0) {
    result.push({
      categoria: 'OUTRO_CICLO',
      label: 'POSSÍVEL VÍNCULO COM CICLO ANTERIOR',
      quantidade: counts.OUTRO_CICLO,
      resumo: 'Apresentaram rota associada a outro ciclo em tentativas anteriores/consecutivas.',
      badgeTipo: 'HIPOTESE',
    });
  }

  if (counts.AGUARDANDO > 0) {
    result.push({
      categoria: 'AGUARDANDO',
      label: 'AGUARDANDO ROTEIRIZAÇÃO',
      quantidade: counts.AGUARDANDO,
      resumo: 'Ainda em processamento pela fila do roteirizador.',
      badgeTipo: 'FATO',
    });
  }

  if (counts.JA_AVANCOU > 0) {
    result.push({
      categoria: 'JA_AVANCOU',
      label: 'JÁ AVANÇOU NO FLUXO',
      quantidade: counts.JA_AVANCOU,
      resumo: 'Já haviam avançado para etapas de expedição ou nós intermediários.',
      badgeTipo: 'FATO',
    });
  }

  if (counts.OUTROS > 0) {
    result.push({
      categoria: 'OUTROS',
      label: 'OUTROS MOTIVOS',
      quantidade: counts.OUTROS,
      resumo: 'Situações operacionais específicas registradas.',
      badgeTipo: 'FATO',
    });
  }

  return result.sort((a, b) => b.quantidade - a.quantidade);
}
