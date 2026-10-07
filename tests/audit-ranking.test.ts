import { describe, expect, it } from 'vitest';
import { buildAuditRanking } from '../src/lib/auditRanking';

describe('ranking de auditoria', () => {
  it('soma as duas fontes, normaliza responsáveis e ignora outros estados', () => {
    const row = (detalhe: string, estado = 'Correto') => ({ pacote: '1', detalhe, estado, dataRegistro: '' });
    expect(buildAuditRanking({ aduana: [row('José Silva'), row('Outra Pessoa'), row('Outra Pessoa', 'Pendente')], auditoria: [row(' JOSE SILVA '), row('Outra Pessoa', 'A mais')] })).toEqual([
      { nome: 'José Silva', aduana: 1, auditoria: 1, total: 2 },
      { nome: 'Outra Pessoa', aduana: 1, auditoria: 0, total: 1 },
    ]);
  });
  it('processa um grande volume e ordena pelo total', () => {
    const rows = Array.from({ length: 100000 }, (_, i) => ({ pacote: String(i), detalhe: `Pessoa ${i % 10}`, estado: i % 2 ? 'Correto' : 'Faltante', dataRegistro: '' }));
    const ranking = buildAuditRanking({ auditoria: rows });
    expect(ranking).toHaveLength(5);
    expect(ranking.reduce((sum, row) => sum + row.total, 0)).toBe(50000);
  });
});
