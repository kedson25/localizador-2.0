import fs from 'node:fs';
import path from 'node:path';

const filePath = path.resolve('src/components/ListasColeta.tsx');
const rawSource = fs.readFileSync(filePath, 'utf8');
const eol = rawSource.includes('\r\n') ? '\r\n' : '\n';
let source = rawSource.replace(/\r\n/g, '\n');
const original = source;

const replacements = [
  [
    "const [selectedSaida, setSelectedSaida] = useState('Ciclo 2 - Saída PM');",
    "const [selectedSaida, setSelectedSaida] = useState('');",
  ],
  [
    "  }, [activeListaId]);\n\n  // Timeout de segurança caso a conexão de rede demore ou caia",
    "  }, [\n    listaAtiva?.id,\n    listaAtiva?.rota,\n    listaAtiva?.saidaPadrao,\n    listaAtiva?.motivoPadrao,\n  ]);\n\n  // Timeout de segurança caso a conexão de rede demore ou caia",
  ],
  [
    "      setListas(prev => [novaLista, ...prev.filter(l => l.id !== novaLista.id)]);\n\n      setShowModalNovaLista(false);",
    "      setListas(prev => [novaLista, ...prev.filter(l => l.id !== novaLista.id)]);\n      setSelectedSaida(novaLista.saidaPadrao);\n\n      setShowModalNovaLista(false);",
  ],
  [
    "const saidaItemFinal = selectedSaida || listaAtiva.saidaPadrao || 'Ciclo 2 - Saída PM';",
    "const saidaItemFinal = listaAtiva.saidaPadrao || selectedSaida || 'Ciclo 2 - Saída PM';",
  ],
  [
    "const saidaCicloFinal = selectedSaida || listaAtiva.saidaPadrao || 'Ciclo 2 - Saída PM';",
    "const saidaCicloFinal = listaAtiva.saidaPadrao || selectedSaida || 'Ciclo 2 - Saída PM';",
  ],
  [
    "Vinculados ao ciclo <strong className=\"text-blue-700\">{selectedSaida}</strong>.",
    "Vinculados ao ciclo <strong className=\"text-blue-700\">{listaAtiva?.saidaPadrao || selectedSaida || 'Ciclo 2 - Saída PM'}</strong>.",
  ],
];

for (const [before, after] of replacements) {
  if (source.includes(before)) {
    source = source.replace(before, after);
    continue;
  }

  if (!source.includes(after)) {
    throw new Error(`Não foi possível aplicar correção de saída. Trecho não encontrado: ${before.slice(0, 100)}`);
  }
}

if (source !== original) {
  fs.writeFileSync(filePath, source.replace(/\n/g, eol), 'utf8');
  console.log('[patch-listas-saida] ListasColeta.tsx corrigido para respeitar a saída da lista.');
} else {
  console.log('[patch-listas-saida] Correção já aplicada.');
}
