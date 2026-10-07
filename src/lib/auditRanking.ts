export type RankingSource = 'aduana' | 'auditoria';
export interface RankingRecord { pacote: string; estado: string; detalhe: string; dataRegistro: string }
export interface RankingEntry { nome: string; aduana: number; auditoria: number; total: number }
export const normalizeRanking = (value: unknown) => String(value ?? '').trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ');

export function buildAuditRanking(sources: Partial<Record<RankingSource, RankingRecord[]>>) {
  const people = new Map<string, RankingEntry>();
  for (const source of ['aduana', 'auditoria'] as const) {
    for (const row of sources[source] || []) {
      if (normalizeRanking(row.estado) !== 'correto') continue;
      const nome = row.detalhe.trim() || 'Responsável não informado';
      const key = normalizeRanking(nome);
      const entry = people.get(key) || { nome, aduana: 0, auditoria: 0, total: 0 };
      entry[source]++;
      entry.total++;
      people.set(key, entry);
    }
  }
  return [...people.values()].sort((a, b) => b.total - a.total || a.nome.localeCompare(b.nome, 'pt-BR'));
}
