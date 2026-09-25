export function cycleKey(value: unknown): 'AM' | 'PM' | 'SD' | '' {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/(^|[^A-Z])AM([^A-Z]|$)/.test(raw)) return 'AM';
  if (/(^|[^A-Z])PM([^A-Z]|$)/.test(raw)) return 'PM';
  if (/(^|[^A-Z])SD([^A-Z]|$)/.test(raw)) return 'SD';
  return '';
}

export function canonicalSaidaForCycle(cycle: 'AM' | 'PM' | 'SD'): string {
  if (cycle === 'AM') return 'Ciclo 1 - Saída AM';
  if (cycle === 'SD') return 'Ciclo 3 - Saída SD';
  return 'Ciclo 2 - Saída PM';
}

/**
 * Resolve a saída oficial da lista.
 *
 * Listas antigas podem ter ficado com `saidaPadrao = PM` mesmo quando o nome
 * operacional foi criado como "Saída SD - DD/MM/AAAA". Como o nome da lista é
 * gerado a partir do ciclo escolhido na criação e não é editável na UI atual,
 * ele é usado para reparar esse legado quando existe conflito.
 */
export function resolveCanonicalListaSaida(
  listaData: Record<string, any> | null | undefined,
  fallback?: unknown
): string {
  const nameCycle = cycleKey(listaData?.nome);
  if (nameCycle) return canonicalSaidaForCycle(nameCycle);

  const configuredCycle = cycleKey(listaData?.saidaPadrao);
  if (configuredCycle) return canonicalSaidaForCycle(configuredCycle);

  const fallbackCycle = cycleKey(fallback);
  if (fallbackCycle) return canonicalSaidaForCycle(fallbackCycle);

  const rawConfigured = String(listaData?.saidaPadrao || '').trim();
  if (rawConfigured) return rawConfigured;

  const rawFallback = String(fallback || '').trim();
  if (rawFallback) return rawFallback;

  return 'Ciclo 2 - Saída PM';
}
