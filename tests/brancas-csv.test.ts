import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  analisarBrancasPorCsv,
  clearBrancasCsvSequence,
  getLastBrancasCsvReport,
} from '../src/lib/brancasCsvFallback';

const storage = new Map<string, string>();

vi.stubGlobal('localStorage', {
  getItem: (key: string) => storage.get(key) ?? null,
  setItem: (key: string, value: string) => storage.set(key, value),
  removeItem: (key: string) => storage.delete(key),
  clear: () => storage.clear(),
});

describe('análise local de Brancas por CSV', () => {
  beforeEach(() => {
    storage.clear();
    clearBrancasCsvSequence();
  });

  it('considera roteirizado todo ID da base encontrado na lista de rotas', () => {
    const report = analisarBrancasPorCsv(
      'ID,CICLO\n1001,AM\n1002,AM\n1003,AM',
      'ID,CICLO,ROTA\n1001,AM,R1\n1003,AM,R3',
      { brancas: 'brancas_do_dia.csv', rotas: 'rotas_am.csv' }
    );

    expect(report.totalBrancas).toBe(3);
    expect(report.totalRoteirizados).toBe(2);
    expect(report.totalNaoRoteirizados).toBe(1);
    expect(report.roteirizadosPorLista).toEqual({ AM1: 2 });
  });

  it('acumula as quantidades por AM, PM e SD entre atualizações locais', () => {
    analisarBrancasPorCsv(
      'ID,CICLO\n1001,AM\n1002,AM\n1003,AM\n1004,AM',
      'ID,CICLO,ROTA\n1001,AM,R1',
      { brancas: 'brancas_do_dia.csv', rotas: 'rotas_am.csv' }
    );

    analisarBrancasPorCsv(
      undefined,
      'ID,CICLO,ROTA\n1002,PM,R2',
      { rotas: 'rotas_pm.csv' }
    );

    const report = analisarBrancasPorCsv(
      undefined,
      'ID,ROTA\n1003,R3',
      { rotas: 'rotas_sd.csv' }
    );

    expect(report.roteirizadosPorLista).toEqual({ AM1: 1, PM1: 1, SD1: 1 });
    expect(report.totalRoteirizados).toBe(3);
    expect(report.totalNaoRoteirizados).toBe(1);
    expect(getLastBrancasCsvReport()?.roteirizadosPorLista).toEqual({
      AM1: 1,
      PM1: 1,
      SD1: 1,
    });
  });
});
