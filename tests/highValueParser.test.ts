import { describe, expect, it } from 'vitest';
import { formatHighValue, isHighValue, parseHighValueCsv, parseMoney } from '../src/lib/highValueParser';

describe('Alto valor - CSV', () => {
  it('aceita valores brasileiros, dólares e IDs como texto', () => {
    const rows = parseHighValueCsv('id;valor br;valor usd\n48288157957;R$ 1.234,56;US$ 230,50\n48250835703;300;55');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({ pacote: '48288157957', valorBr: 1234.56, valorUsd: 230.5 });
    expect(isHighValue(rows[0])).toBe(true);
    expect(isHighValue(rows[1])).toBe(false);
  });

  it('usa USD apenas quando BR está vazio', () => {
    const [row] = parseHighValueCsv('ID,valor br,valor usd\nAB123,,301');
    expect(isHighValue(row)).toBe(true);
    expect(formatHighValue(row)).toContain('US$');
  });

  it('rejeita colunas ausentes e valores sem número', () => {
    expect(() => parseHighValueCsv('nome;preco\nA;400')).toThrow(/colunas/);
    expect(() => parseHighValueCsv('id;valor br\n123;')).toThrow(/Nenhum ID/);
    expect(parseMoney('1,234.50')).toBe(1234.5);
  });
});
