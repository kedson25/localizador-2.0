import { describe, expect, it } from 'vitest';
import { enrichExpedicao, getChanges, parseBaseDespacho, parseExpedicaoRows } from '../src/lib/expedicao';

describe('Expedição', () => {
  it('completa rota, doca e placa usando a base despacho', () => {
    const base = parseBaseDespacho('Onda,Rota otimizada,Rota original,Doca,Placa\nOnda 4,VJ11_AM1,AM1_113,1,SDQ3J67');
    const aduana = parseExpedicaoRows('Shipment ID,Placa,ID da rota,Estado\n47774449934,SDQ3J67,VJ11_AM1 | 503,A mais', 'aduana');
    const rows = enrichExpedicao({ base, aduana, auditoria: [] });
    expect(rows[0]).toMatchObject({ rotaOtimizada: 'VJ11_AM1', doca: '1', onda: 'Onda 4', placa: 'SDQ3J67', classificacao: 'A mais' });
  });

  it('prioriza o ID do pacote para achar o destino correto de um A mais', () => {
    const base = parseBaseDespacho([
      'Shipment ID,Onda,Rota otimizada,Rota original,Doca,Placa',
      '47774449934,Onda 4,VJ11_AM1,AM1_113,1,SDQ3J67',
      '49999999999,Onda 5,B2_AM1,AM1_220,9,ABC1D23',
    ].join('\n'));
    const aduana = parseExpedicaoRows(
      'Shipment ID,Placa,ID da rota,Estado\n47774449934,ABC1D23,B2_AM1,A mais',
      'aduana',
    );
    const rows = enrichExpedicao({ base, aduana, auditoria: [] });
    expect(rows[0]).toMatchObject({
      pacote: '47774449934',
      rotaOtimizada: 'VJ11_AM1',
      doca: '1',
      onda: 'Onda 4',
      placa: 'SDQ3J67',
      encontradoDoca: '9',
      destinoDoca: '1',
      classificacao: 'A mais',
    });
  });

  it('posiciona A mais na vaga física onde foi encontrado e mantém o destino separado', () => {
    const base = parseBaseDespacho([
      'Shipment ID,Onda,Rota otimizada,Rota original,Doca,Placa',
      '48129865734,Onda 2,B6_AM1,AM1_6,6,DEST6',
      '49999999999,Onda 3,H5_AM1,AM1_8,8,FOUND8',
    ].join('\n'));
    const auditoria = parseExpedicaoRows(
      'Shipment ID,Contenedor,Estado\n48129865734,H5_AM1,A mais',
      'auditoria',
    );
    const rows = enrichExpedicao({ base, aduana: [], auditoria });

    expect(rows[0]).toMatchObject({
      pacote: '48129865734',
      classificacao: 'A mais',
      encontradoDoca: '8',
      destinoDoca: '6',
      vagaOperacional: '8',
    });
  });

  it('usa o Estado da Aduana como classificação oficial', () => {
    const aduana = parseExpedicaoRows('Shipment ID,Estado\n48066008566,Faltante', 'aduana');
    expect(enrichExpedicao({ base: [], aduana, auditoria: [] })[0].classificacao).toBe('Faltante');
  });

  it('marca itens exclusivos da auditoria como faltantes', () => {
    const auditoria = parseExpedicaoRows('ID do pacote,Problema,Estado\n48123234134,Pacote avariado,Faltante', 'auditoria');
    expect(enrichExpedicao({ base: [], aduana: [], auditoria })[0].classificacao).toBe('Faltante');
  });

  it('registra apenas novidades ou mudanças entre cargas', () => {
    const oldRows = parseExpedicaoRows('Shipment ID,Estado\n1,A mais\n2,Faltante', 'aduana');
    const newRows = parseExpedicaoRows('Shipment ID,Estado\n1,A mais\n2,A mais\n3,Faltante', 'aduana');
    expect(getChanges(oldRows, newRows, 'aduana').map(item => `${item.tipo}:${item.pacote}`)).toEqual(['alterado:2', 'novo:3']);
  });

  it('cruza Contenedor da auditoria com rota otimizada e ignora corretos', () => {
    const base = parseBaseDespacho('Onda,Rota otimizada,Rota original,Doca,Placa\nOnda 1,B1_AM1,AM1_1,2,ABC1D23');
    const auditoria = parseExpedicaoRows('Shipment ID,Contenedor,Estado\n48038961782,B1_AM1,A mais\n9,B1_AM1,Correto', 'auditoria');
    const rows = enrichExpedicao({ base, aduana: [], auditoria });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rotaOtimizada: 'B1_AM1', doca: '2', placa: 'ABC1D23', vagaOperacional: '2' });
  });

  it('identifica erro de atrelamento quando Auditoria e Despacho apontam a mesma rota', () => {
    const base = parseBaseDespacho('Shipment ID,Onda,Rota otimizada,Rota original,Doca,Placa\n48038961782,Onda 1,B1_AM1,AM1_1,2,ABC1D23');
    const auditoria = parseExpedicaoRows('Shipment ID,Contenedor,Estado\n48038961782,B1_AM1,A mais', 'auditoria');
    const [row] = enrichExpedicao({ base, aduana: [], auditoria });

    expect(row).toMatchObject({
      encontradoDoca: '2',
      destinoDoca: '2',
      erroAtrelamentoGaiola: true,
      diagnostico: 'Erro de atrelamento de gaiola',
    });
  });

  it('mantém Aduana e Auditoria visíveis para o mesmo ID', () => {
    const base = parseBaseDespacho('Shipment ID,Rota otimizada,Doca\n1,R1,4');
    const aduana = parseExpedicaoRows('Shipment ID,ID da rota,Estado\n1,R1,Faltante', 'aduana');
    const auditoria = parseExpedicaoRows('Shipment ID,Contenedor,Estado\n1,R1,A mais', 'auditoria');
    const rows = enrichExpedicao({ base, aduana, auditoria });

    expect(rows.map(row => row.origem)).toEqual(['aduana', 'auditoria']);
  });
});
