export type ListaCycle = 'AM' | 'PM' | 'SD';

export function cycleKey(value: unknown): ListaCycle | '' {
  const raw = String(value || '').trim().toUpperCase();
  if (!raw) return '';
  if (/(^|[^A-Z])AM([^A-Z]|$)/.test(raw)) return 'AM';
  if (/(^|[^A-Z])PM([^A-Z]|$)/.test(raw)) return 'PM';
  if (/(^|[^A-Z])SD([^A-Z]|$)/.test(raw)) return 'SD';
  return '';
}

export function canonicalSaidaForCycle(cycle: ListaCycle): string {
  if (cycle === 'AM') return 'Ciclo 1 - Saída AM';
  if (cycle === 'SD') return 'Ciclo 3 - Saída SD';
  return 'Ciclo 2 - Saída PM';
}

export function cycleFromListaName(nome: unknown): ListaCycle | '' {
  return cycleKey(nome);
}

export function rewriteListaNameCycle(nome: unknown, cycle: ListaCycle): string {
  const current = String(nome || '').trim();
  if (!current) return current;

  const label = `Saída ${cycle}`;
  if (/Sa[íi]da\s+(AM|PM|SD)/i.test(current)) {
    return current.replace(/Sa[íi]da\s+(AM|PM|SD)/i, label);
  }

  return current;
}

/**
 * Resolve a saída oficial da lista para gravações normais.
 *
 * IMPORTANTE: `saidaPadrao` é a fonte de verdade. O nome da lista é apenas
 * fallback para documentos antigos que realmente não possuem saída configurada.
 * Assim uma lista histórica não é convertida para SD só porque o nome legado
 * contém "Saída SD".
 */
export function resolveCanonicalListaSaida(
  listaData: Record<string, any> | null | undefined,
  fallback?: unknown
): string {
  const configuredCycle = cycleKey(listaData?.saidaPadrao);
  if (configuredCycle) return canonicalSaidaForCycle(configuredCycle);

  const fallbackCycle = cycleKey(fallback);
  if (fallbackCycle) return canonicalSaidaForCycle(fallbackCycle);

  const nameCycle = cycleFromListaName(listaData?.nome);
  if (nameCycle) return canonicalSaidaForCycle(nameCycle);

  const rawConfigured = String(listaData?.saidaPadrao || '').trim();
  if (rawConfigured) return rawConfigured;

  const rawFallback = String(fallback || '').trim();
  if (rawFallback) return rawFallback;

  return 'Ciclo 2 - Saída PM';
}
