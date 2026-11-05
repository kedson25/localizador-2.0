# Plano de Otimização de Performance — Sistema de Logística e Coleta

Diagnóstico técnico dos gargalos de lentidão identificados no sistema e plano de otimização ponta a ponta abrangendo **Conexão Firebase/Firestore**, **Buscador de IDs (`/consulta`)**, **Listas de Coleta (`/listas`)** e **Controle de Refugo (`/refugo`)**.

## User Review & Critical Decisions

- **Escopo de Otimização Confirmado**: Otimização completa em todos os módulos críticos (Buscador, Listas de Coleta, Refugo e camada de rede do Firebase).
- **Alcance da Busca em Listas de Coleta**: Por padrão, a busca de pacotes nas Listas de Coleta consultará apenas as **listas do dia atual (Hoje)** para resposta instantânea, adicionando um controle direto na tela (`Incluir listas antigas`) caso o operador deseje expandir a varredura para todo o histórico.
- **Preservação Integral de Dados e Funcionalidades**: Nenhuma regra de negócio, formato de exportação/cópia ou estrutura de dados salva no Firestore será perdida; todas as otimizações atuam na eficiência de consulta, indexação em memória e eliminação de leituras/observadores duplicados.

---

## 1. Overview & Core Concept

Durante a análise do código-fonte, foram identificados **5 gargalos principais** que causam lentidão, travamentos ao digitar/colar lotes grandes de IDs e atraso na sincronização com o banco de dados:

1. **Long-Polling Forçado no Firestore**: O cliente Firebase estava configurado para usar `experimentalForceLongPolling: true` por padrão, forçando conexões HTTP lentas em vez de WebSockets nativos em tempo real.
2. **Explosão de Consultas Duplicadas no Buscador (`/consulta`)**: Ao colar centenas de IDs, dois componentes (`IdLookup` e `IdLookupEnhanced`) disparam buscas concorrentes no Firestore. Além disso, a busca varria **todas as listas históricas já criadas** em lotes de 30 IDs (duplicando para `codigo` e `codigoClean`), gerando centenas de requisições simultâneas a cada pesquisa.
3. **Busca Linear $O(N \times M)$ na Planilha Base (CSV)**: Na aba `Buscar IDs`, cada ID pesquisado percorria toda a lista de milhares de linhas do CSV via `.find()` repetidamente a cada alteração de filtro, travando a thread principal do navegador.
4. **Leitura Dupla (`getDocs` + `onSnapshot`) e Escrita Sequencial nas Listas**: Ao abrir uma Lista de Coleta, o sistema executava um `getDocs` completo seguido imediatamente de um `onSnapshot` na mesma coleção de até 10.000 itens (dobrando o consumo de rede). Além disso, cada bipagem fazia 3 viagens de rede sequenciais (`getDoc` $\rightarrow$ `setDoc` $\rightarrow$ `updateDoc`).
5. **Polling de DOM a cada 300ms e `MutationObserver` Global**: Os componentes `IdLookupEnhanced` e `ListasColetaEnhanced` utilizavam `setInterval(..., 300)` e observadores globais em `document.body` (`subtree: true, characterData: true`) varrendo todas as tags `<span>` e `<button>` da página a cada mudança visual.

---

## 2. User Experience & Visual Design

A interface manterá sua identidade visual limpa e de alta densidade tabular (`tabular-nums`), recebendo melhorias diretas de fluidez e controle:

- **Seletor "Apenas Listas de Hoje / Incluir Listas Antigas" no Buscador**:
  - Na barra de filtros da aba **Buscar IDs**, ao lado dos filtros de Último Movimento e Saída, haverá uma opção clara (`Buscar apenas listas de hoje` ativo por padrão, com botão/checkbox `Incluir listas antigas`).
  - Quando em modo padrão (Hoje), a busca de 500+ IDs nas listas de coleta cai de vários segundos para milissegundos.
- **Resposta Instantânea ao Colar Lotes (500+ IDs)**:
  - Debounce inteligente na caixa de texto de busca para evitar disparos repetidos no Firestore enquanto o usuário ainda está digitando, mantendo atualização imediata ao colar ou clicar em pesquisar.
- **Bipagem Contínua sem Travamentos (`/listas` e `/refugo`)**:
  - Remoção dos observadores pesados de DOM global, garantindo que leitores de código de barras rápidos não sofram atraso de digitação (input lag).

---

## 3. Key Product Decisions & Trade-Offs

- **WebSockets com Auto-Detecção (`experimentalAutoDetectLongPolling`) vs. Long-Polling Forçado**:
  - *Decisão*: Mudar o padrão para auto-detecção do Firebase (que usa WebSockets rápidos e só cai para long-polling se a rede corporativa bloquear), mantendo a opção manual de fallback caso necessário.
- **Unificação de Busca em Listas (`IdLookup` + `IdLookupEnhanced`)**:
  - *Decisão*: Centralizar e compartilhar o cache em memória das listas consultadas para que `IdLookup` e `IdLookupEnhanced` não façam consultas duplicadas ao Firestore para os mesmos pacotes.
- **Indexação em Memória (`Map`) para CSV e Histórico**:
  - *Decisão*: Pré-indexar as linhas da planilha CSV e os mapas de vagas/refugo em estruturas `Map<string, Row>` via `useMemo`. O cruzamento de 500 IDs contra 10.000 linhas passa de ~5.000.000 de comparações para 500 acessos diretos $O(1)$.

---

## 4. Technical Architecture & Data Strategy

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        INTERFACE DO OPERADOR                            │
│  /consulta (Buscador)        /listas (Coleta)         /refugo (Refugo)  │
└───────────┬─────────────────────────┬────────────────────────┬──────────┘
            │                         │                        │
            ▼                         ▼                        ▼
┌───────────────────────────┐ ┌──────────────────────┐ ┌──────────────────┐
│ Indexador O(1) em Memória │ │ Listener Único       │ │ Cache & Map O(1) │
│ • Map<ID, CsvRow>         │ │ • Apenas onSnapshot  │ │ • Lookup direto  │
│ • Debounce de Input       │ │   (sem getDocs duplo)│ │   por pacote     │
│ • Filtro Padrão: Hoje     │ │ • Escrita Otimizada  │ │                  │
└───────────┬───────────────┘ └──────────┬───────────┘ └────────┬─────────┘
            │                            │                      │
            └────────────────────────────┼──────────────────────┘
                                         ▼
┌─────────────────────────────────────────────────────────────────────────┐
│                CAMADA FIREBASE / FIRESTORE OTIMIZADA                    │
│  • Transporte WebSocket padrão (experimentalAutoDetectLongPolling)      │
│  • Cache compartilhado de metadados de listas e ocorrências de pacotes  │
│  • Redução de queries concorrentes com deduplicação de códigos limpos   │
└─────────────────────────────────────────────────────────────────────────┘
```

### Etapas de Implementação Técnica

1. **Otimização da Camada Firebase (`firebase-core.ts` e `listaMultiSearch.ts`)**:
   - Ativar `experimentalAutoDetectLongPolling: true` por padrão (desativando o `forceLongPolling` forçado).
   - Remover o `getDocs(q)` redundante dentro de `listenToListaItens`, deixando apenas o `onSnapshot` gerenciar os dados em tempo real.
   - Otimizar `searchItemsAcrossAllListas` para aceitar o parâmetro `onlyToday: boolean` (padrão `true`), filtrar as listas em memória pela data de hoje antes de disparar queries nas subcoleções `itens`, unificar buscas quando `codigo === codigoClean` (reduzindo pela metade as queries por lote) e guardar cache de curta duração para evitar re-consultas idênticas.
   - Otimizar `addItemToLista` para usar operação direta com `increment(1)` ou batch sem leituras bloqueantes desnecessárias quando o item é novo.
2. **Otimização do Buscador de IDs (`IdLookup.tsx` e `IdLookupEnhanced.tsx`)**:
   - Criar índice `Map` memorizado para `rows` (CSV) por ID limpo e ID exato, eliminando o `rows.find()` linear dentro do loop de resultados.
   - Adicionar debounce de 350ms na busca ao Firestore quando o usuário digita/cola códigos, além do seletor visual **"Apenas listas de hoje"** / **"Incluir listas antigas"**.
   - Substituir o `setInterval` de 300ms do `IdLookupEnhanced` por eventos sincronizados leves, reutilizando os dados já carregados pelo `IdLookup`.
3. **Otimização de Listas de Coleta e Refugo (`ListasColetaEnhanced.tsx` e `ControleRefugo.tsx`)**:
   - Remover os dois `MutationObserver` globais em `document.body` com `characterData: true` que causavam lentidão geral na interface, substituindo por verificação leve e escopada.
   - Garantir que o cruzamento de pacotes no Controle de Refugo utilize `Map` indexado em memória para resposta imediata ao bipar.
