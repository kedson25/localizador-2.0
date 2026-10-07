import Papa from 'papaparse';
import { buildAuditRanking, normalizeRanking, type RankingRecord, type RankingSource } from './auditRanking';
import { dateScore } from './expedicao';

self.onmessage = async (event: MessageEvent) => {
  try {
    const sources: Partial<Record<RankingSource, RankingRecord[]>> = event.data.sources || {};
    for (const { file, source } of event.data.files || []) {
      const latest = new Map<string, RankingRecord>();
      let columns: string[] = [];
      await new Promise<void>((resolve, reject) => {
        Papa.parse<string[]>(file, {
          skipEmptyLines: 'greedy',
          chunkSize: 1024 * 1024,
          chunk(result) {
            for (const cells of result.data) {
              if (!columns.length) {
                columns = cells.map(normalizeRanking);
                if (!['shipment id', 'estado', 'rep auditoria'].every(name => columns.includes(name))) {
                  throw new Error(`${file.name}: faltam as colunas Shipment ID, Estado ou Rep auditoria.`);
                }
                continue;
              }
              const read = (name: string) => String(cells[columns.indexOf(name)] || '').trim();
              const pacote = read('shipment id').replace(/\.0+$/, '');
              if (!pacote) continue;
              const row = { pacote, estado: read('estado'), detalhe: read('rep auditoria'), dataRegistro: read('data auditoria') };
              const previous = latest.get(pacote);
              if (!previous || dateScore(row.dataRegistro) >= dateScore(previous.dataRegistro)) latest.set(pacote, row);
            }
          },
          complete: () => resolve(),
          error: reject,
        });
      });
      sources[source as RankingSource] = [...latest.values()];
    }
    self.postMessage({ ranking: buildAuditRanking(sources) });
  } catch (error) {
    self.postMessage({ error: error instanceof Error ? error.message : 'Falha ao calcular ranking.' });
  }
};
