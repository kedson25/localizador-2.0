import Papa from 'papaparse';

export interface SeparacaoRoute { planejado: string; otimizado: string; roteiro: string; servicos: string; hybrid: boolean }
const key = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toUpperCase();

export function parseSeparacao(text: string): SeparacaoRoute[] {
  const parsed = Papa.parse<string[]>(text.replace(/^\uFEFF/, ''), { skipEmptyLines: 'greedy' });
  if (parsed.errors.some(error => error.code !== 'UndetectableDelimiter')) throw new Error('Arquivo de separação inválido. Confira os delimitadores e as aspas.');
  const [headers, ...rows] = parsed.data;
  const column = (name: string) => headers?.findIndex(header => key(header) === key(name)) ?? -1;
  const planned = column('ID Planejado'), optimized = column('ID Otimizado'), detail = column('Detalhe do roteiro'), services = column('Tipos de serviços');
  if ([optimized, detail, services].some(index => index < 0)) throw new Error('A separação precisa das colunas ID Otimizado, Detalhe do roteiro e Tipos de serviços.');
  const result = rows.map(row => ({ planejado: (row[planned] || '').trim(), otimizado: (row[optimized] || '').trim(), roteiro: (row[detail] || '').trim(), servicos: (row[services] || '').trim(), hybrid: /\b(HYBRID|HIBRID[AO]S?)\b/.test(key(row[services] || '')) })).filter(row => row.otimizado && row.roteiro);
  if (!result.length) throw new Error('Nenhuma rota válida encontrada na separação.');
  const unique = [...new Map(result.map(row => [`${key(row.otimizado)}|${key(row.roteiro)}|${key(row.servicos)}`, row])).values()];
  if (new TextEncoder().encode(JSON.stringify(unique)).length > 200_000) throw new Error('A separação excede o tamanho suportado. Importe somente as colunas de rotas e serviços.');
  return unique;
}

export function hybridRoutesFor(routes: SeparacaoRoute[], value: string): SeparacaoRoute[] {
  const match = key(value.split('|')[0]);
  if (!match) return [];
  const details = new Set(routes.filter(row => [row.planejado, row.otimizado, row.roteiro].some(field => field && key(field) === match)).map(row => key(row.roteiro)));
  return routes.filter(row => row.hybrid && details.has(key(row.roteiro)));
}

export function groupHybridRoutes(routes: SeparacaoRoute[]) {
  const groups = new Map<string, { roteiro: string; ids: string[] }>();
  for (const row of routes) {
    if (!row.hybrid) continue;
    const group = groups.get(key(row.roteiro)) || { roteiro: row.roteiro, ids: [] };
    if (!group.ids.includes(row.otimizado)) group.ids.push(row.otimizado);
    groups.set(key(row.roteiro), group);
  }
  return [...groups.values()];
}
