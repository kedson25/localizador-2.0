import { describe, expect, it } from 'vitest';
import { enrichExpedicao, getChanges, parseBaseDespacho, parseExpedicaoRows } from '../src/lib/expedicao';

describe('Expedição', () => {
  it('completa rota, doca e placa usando a base despacho', () => {
    const base = parseBaseDespacho('Onda,Rota otimizada,Rota original,Doca,Placa\nOnda 4,VJ11_AM1,AM1_113,1,SDQ3J67');
    const aduana = parseExpedicaoRows('Shipment ID,Placa,ID da rota,Estado\n47774449934,SDQ3J67,VJ11_AM1 | 503,A mais', 'aduana');
    const rows = enrichExpedicao({ base, aduana, auditoria: [] });
    expect(rows[0]).toMatchObject({ rotaOtimizada: 'VJ11_AM1', doca: '1', onda: 'Onda 4', placa: 'SDQ3J67', classificacao: 'A mais' });
  });

  it('usa o Estado da Aduana como classificação oficial', () => {
    const aduana = parseExpedicaoRows('Shipment ID,Estado\n48066008566,Faltante', 'aduana');
    expect(enrichExpedicao({ base: [], aduana, auditoria: [] })[0].classificacao).toBe('Faltante');
  });

  it('marca itens exclusivos da auditoria como faltantes', () => {
    const auditoria = parseExpedicaoRows('ID do pacote,Problema\n48123234134,Pacote avariado', 'auditoria');
    expect(enrichExpedicao({ base: [], aduana: [], auditoria })[0].classificacao).toBe('Faltante');
  });

  it('registra apenas novidades ou mudanças entre cargas', () => {
    const oldRows = parseExpedicaoRows('Shipment ID,Estado\n1,A mais\n2,Faltante', 'aduana');
    const newRows = parseExpedicaoRows('Shipment ID,Estado\n1,A mais\n2,A mais\n3,Faltante', 'aduana');
    expect(getChanges(oldRows, newRows, 'aduana').map(item => `${item.tipo}:${item.pacote}`)).toEqual(['alterado:2', 'novo:3']);
  });
});
