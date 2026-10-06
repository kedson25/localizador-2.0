import { describe, expect, it } from 'vitest';
import { groupHybridRoutes, hybridRoutesFor, parseSeparacao } from '../src/lib/separacao';

const text = 'ID Planejado\tID Otimizado\tDetalhe do roteiro\tTipos de serviços\t\t\nAM1_7\tH1_AM1\tAM1 - C 11\thybrid\t\t\nAM1_6\tQ2_AM1\tAM1 - C 11\thybrid\t\t\nAM1_116\tH3_AM1\tAM1 - C 4\tME Extra,hybrid\t\t\nAM1_18\tA10_AM1\tAM1 - C 1\tME Extra\t\t\n\t\t\t\t\t';
describe('separação de híbridas', () => {
  it('aceita TSV com colunas vazias finais e serviço combinado', () => {
    const rows = parseSeparacao(text);
    expect(rows).toHaveLength(4);
    expect(rows.find(row => row.otimizado === 'H3_AM1')?.hybrid).toBe(true);
    expect(rows.find(row => row.otimizado === 'A10_AM1')?.hybrid).toBe(false);
  });
  it('preserva todas as híbridas do mesmo roteiro', () => {
    expect(groupHybridRoutes(parseSeparacao(text))[0]).toEqual({ roteiro: 'AM1 - C 11', ids: ['H1_AM1', 'Q2_AM1'] });
  });
  it('cruza por detalhe, ID planejado ou ID otimizado sem misturar roteiros', () => {
    for (const query of ['AM1 - C 11', 'AM1_7', 'H1_AM1 | 503']) expect(hybridRoutesFor(parseSeparacao(text), query).map(row => row.otimizado)).toEqual(['H1_AM1', 'Q2_AM1']);
    expect(hybridRoutesFor(parseSeparacao(text), 'AM1 - C 1')).toEqual([]);
    expect(hybridRoutesFor(parseSeparacao(text), 'inexistente')).toEqual([]);
  });
  it('rejeita cabeçalho incompatível sem retornar lista vazia silenciosa', () => {
    expect(() => parseSeparacao('A,B\n1,2')).toThrow('colunas');
  });
});
