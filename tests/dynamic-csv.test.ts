import { describe, expect, it } from 'vitest';
import { crossSources, indexSource, parseDynamicCsv, sameColumns } from '../src/lib/dynamicCsv';

describe('CSV universal', () => {
  it('preserva cabeçalhos, zeros e campos com delimitadores e quebras de linha', () => {
    const source = parseDynamicCsv('\uFEFFCOD_ABC; POS_X ;INFO_77\r\n001;Q12;"entrada; confirmada\nhoje"', 'dados.csv');
    expect(source.columns).toEqual(['COD_ABC', ' POS_X ', 'INFO_77']);
    expect(source.rows[0]).toEqual({ COD_ABC: '001', ' POS_X ': 'Q12', INFO_77: 'entrada; confirmada\nhoje' });
    expect(indexSource(source, 'COD_ABC').get('001')).toHaveLength(1);
    expect(indexSource(source, 'COD_ABC').get('1')).toBeUndefined();
  });
  it('aceita uma única coluna e cabeçalhos sensíveis', () => {
    const source = parseDynamicCsv('__proto__\n001\n002', 'uma.csv');
    expect(source.rows[0]['__proto__']).toBe('001');
    expect(source.rows).toHaveLength(2);
  });
  it('rejeita cabeçalhos ambíguos e linhas inconsistentes', () => {
    expect(() => parseDynamicCsv('A,A\n1,2', 'dados.csv')).toThrow('repetidos');
    expect(() => parseDynamicCsv('A,B\n1,2,3', 'dados.csv')).toThrow('quantidade');
    expect(() => parseDynamicCsv('A,\n1,2', 'dados.csv')).toThrow('cabeçalho');
  });
  it('cruza nomes arbitrários, preserva duplicados e sinaliza ausentes e vazios', () => {
    const a = parseDynamicCsv('qualquer,outro\n001,a\n999,b\n,c', 'a.csv');
    const b = parseDynamicCsv('campo_x,campo_y,campo_z\n001,Q12,entrada\n001,T08,saída\n,ignorar,vazio', 'b.csv');
    const results = crossSources(a, b, { sourceAId: a.id, sourceAColumn: 'qualquer', sourceBId: b.id, sourceBColumn: 'campo_x', returnColumns: ['campo_y'] });
    expect(results).toHaveLength(4);
    expect(results.map(result => result.found)).toEqual([true, true, false, false]);
    expect(results[0].data).toEqual({ campo_y: 'Q12' });
    expect(results[1].data).toEqual({ campo_y: 'T08' });
  });
  it('identifica modelos pelos nomes, independentemente da ordem', () => {
    expect(sameColumns(['ABC', 'XYZ'], ['XYZ', 'ABC'])).toBe(true);
    expect(sameColumns(['ABC', 'XYZ'], ['ABC', 'novo'])).toBe(false);
  });
});
