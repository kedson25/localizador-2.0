# Guia técnico e de implantação — Localizador 2.0

**Revisão:** 08/10/2026 • **Estado:** documentação do código existente, não uma certificação de prontidão.

> **Aviso:** o projeto demanda uma revisão de autenticação/autorização antes de exposição empresarial com dados reais. Não transforme as instruções abaixo em promessa de segurança. Nunca publique chaves privadas, tokens ou bases reais.

## Sumário

- [Arquitetura](#arquitetura)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Como desenvolver localmente](#como-desenvolver-localmente)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Endpoints e fluxos](#endpoints-e-fluxos)
- [Persistência e fontes](#persistência-e-fontes)
- [Importação CSV e relatórios](#importação-csv-e-relatórios)
- [Deploy e operação](#deploy-e-operação)
- [Qualidade e validação](#qualidade-e-validação)
- [Riscos conhecidos e prioridades](#riscos-conhecidos-e-prioridades)
- [Checklist pré-publicação](#checklist-pré-publicação)

## Arquitetura

Aplicação web **React 19 + TypeScript + Vite 6 + Tailwind CSS 4**, com navegação por **React Router**. Ícones **Lucide**, gráficos **Recharts** e leitura tabular **PapaParse** são utilizados em áreas específicas. Serviços acessados no código incluem **Firebase/Firestore**, **Supabase** e **Google Sheets**, conforme o módulo. A API é formada por funções sob `api/`, implantáveis na **Vercel**.

Fluxo ilustrativo:

```text
Navegador (React, formulários, CSV e Canvas PNG)
  ├─ módulos locais: análise CSV, localStorage, IndexedDB
  ├─ módulos colaborativos: Firestore/Firebase, APIs /api/*
  └─ APIs servidor (Vercel Functions)
      ├─ autenticação e usuários
      ├─ listas e coleta
      ├─ refugo
      └─ brancas / Google Sheets e outras fontes
```

Os fluxos de dados **não são uniformes**. Não deduza que um dado está disponível a todos só porque foi salvo em um módulo.

## Estrutura do repositório

| Diretório | Responsabilidade |
| --- | --- |
| `src/App.tsx` | Rotas, permissões visuais e composição do aplicativo |
| `src/components/` | Módulos de coleta, consulta, docas, brancas, refugo, relatórios e administração |
| `src/lib/` | Clientes de APIs, autenticação, persistência e regras operacionais |
| `src/utils/` | Utilitários de CSV e sincronização |
| `api/` | Roteadores de funções HTTP |
| `api/_auth/` | Fluxos de autenticação e usuários |
| `api/_coleta/` | Bip, itens, batch, busca, estatísticas e normalização |
| `api/_listas/` | Metadados, alterações e reconciliação |
| `api/_refugo/` | Leituras e histórico |
| `api/_brancas/` | Análise, histórico, reset e sincronização |
| `api/_lib/` | Regras comuns de backend, integrações e autenticação |
| `public/` | Imagens do cabeçalho e rodapé do Ranking |
| `docs/` | Manuais e planos técnicos |

Alguns componentes possuem versões originais, wrappers e variantes Enhanced/Clean. Um arquivo presente no repositório pode não corresponder à tela ativa. Confira primeiro o `src/App.tsx`.

## Como desenvolver localmente

**Pré-requisitos:** Node.js compatível com Vite 6, gerenciador npm e acesso autorizado aos serviços do ambiente.

```bash
git clone https://github.com/kedson25/localizador-2.0.git
cd localizador-2.0
npm install
cp .env.example .env.local
npm run dev
```

No Windows PowerShell, copie o arquivo com `Copy-Item .env.example .env.local`. Configure variáveis de **um ambiente de desenvolvimento**, nunca credenciais produtivas em uma estação não autorizada.

Scripts existentes:

```bash
npm run dev      # pré-etapa de patch, depois Vite
npm run build    # pré-etapa de patch, depois build de produção
npm run lint     # TypeScript --noEmit
npm run preview  # prévia do bundle gerado
```

Os scripts `predev` e `prebuild` executam `scripts/patch-listas-saida.mjs`; registre esse comportamento em investigações de regressão. Não foi atestado nesta revisão que os testes e a compilação tenham passado.

## Variáveis de ambiente

Use **`.env.example` apenas como referência dos nomes**, sem reutilizar dados reais. Principais famílias:

| Prefixo / variável | Uso | Local correto |
| --- | --- | --- |
| `VITE_FIREBASE_*` | Configuração do cliente Firebase | Frontend, conforme regras de segurança adequadas |
| `FIREBASE_PROJECT_ID` | Projeto Firebase do backend | Servidor |
| `FIREBASE_CLIENT_EMAIL` | Identidade de service account | Servidor |
| `FIREBASE_PRIVATE_KEY` | Credencial privada | **Somente servidor; nunca no Git** |
| `GOOGLE_*` | Integração com Google Sheets e service account | Servidor |
| `SYNC_API_KEY` | Configuração de fluxo de sincronização | Servidor |
| `VITE_BRANCAS_API_KEY` | Variável de cliente; **não** trate como segredo | Frontend |
| `VITE_SUPABASE_URL` | URL de projeto | Frontend |
| `VITE_SUPABASE_ANON_KEY` | Chave pública do cliente, sujeita a políticas RLS | Frontend |
| `SUPABASE_SERVICE_ROLE_KEY` | Privilégios de serviço | **Somente servidor** |
| `SENTRY_DSN` | Telemetria opcional | Conforme integração |

**Nunca** coloque segredos em variáveis `VITE_*`: o Vite as incorpora ao bundle acessível no navegador. Verifique correspondência entre projetos configurados para frontend e backend.

## Endpoints e fluxos

### APIs de autenticação

Roteador `/api/auth?action=...` com ações `signup`, `login` e `users`, implementadas sob `api/_auth/`.

**Importante:** a implementação atual contém caminhos de compatibilidade/legados e não deve ser considerada autenticada adequadamente para publicação empresarial sem correções e auditoria. Não descreva o endpoint atual como autenticação segura.

### API de Coleta

Roteador `/api/coleta?action=...`:

| Ação | Objetivo |
| --- | --- |
| `bip` | Registrar um pacote |
| `item` | Alterar ou excluir item |
| `items` | Listagem paginada, com filtros |
| `search` | Busca por ID |
| `batch` | Importação em lote |
| `stats` | Contadores |
| `normalize-saida` | Padronização de informações de saída |

O frontend utiliza `src/lib/api.ts`. O contrato de `batch` disponibiliza contagens de recebidos, inseridos, atualizados, duplicados e falhas; os parâmetros de consulta incluem `listaId`, limite, cursor, saída, motivo e validado. Para payloads completos, leia o código dos handlers, que pode mudar.

### API de Listas

Roteador `/api/listas?action=...`:

- `index`: listagem e criação.
- `id&id=...`: operações específicas da lista.
- `reconcile`: reconciliação de contadores.

### API de Refugo

`/api/refugo?action=scans` e `/api/refugo?action=historico` oferecem operações de registros e histórico conforme métodos dos handlers.

### Brancas

Há endpoints de integração/relatório, inclusive um roteador `/api/brancas` capaz de consultar Google Sheets. Entretanto, o módulo atual conectado à rota `/brancas` usa `BrancasPanelWithCsvFallback`, que permite análise manual local e intercepta determinadas requisições no navegador. **Não use a documentação da API ao vivo como prova de que a tela atual está lendo a planilha em tempo real.**

### Saúde e Sheets

Há funções `api/health.ts` e `api/sheets.ts`. Não exponha URLs administrativas ou ações de mutação ao público sem revisar os mecanismos de autenticação e rate limiting.

## Persistência e fontes

- **Firebase/Firestore:** fluxos de usuário, coleta e componentes de operação; confirme regras atuais de segurança do projeto.
- **Supabase:** cliente e suporte em algumas camadas; a presença do SDK não prova que todos os módulos usem Supabase.
- **Google Sheets:** fontes específicas de integração.
- **localStorage:** sessão/aparência, base de baixas e resultado do Ranking de Auditores.
- **IndexedDB:** registros importados no Ranking de Auditores por `src/lib/localPersistence.ts`.
- **Downloads:** são arquivos gerados no computador; independentes de resets e exclusões da interface.

Em suporte ou reprodução de bugs, anote sempre **origem dos dados, navegador, perfil, data, ciclo e identificador da lista**.

## Importação CSV e relatórios

O sistema usa leitores diferentes para necessidades diferentes. Não generalize formatos:

- **Ranking:** valida colunas `Shipment ID` e `Rep auditoria`; usa `Estado`, `Contenedor/ID da rota` e `Data auditoria` quando disponíveis.
- **Correlação:** usuário mapeia explicitamente as colunas dos dois arquivos.
- **Baixas:** reconhece colunas de identificador e status; filtra Entregue/Em rota.
- **Brancas:** carga manual da base e das listas de rotas.
- **Refugo:** base de conferência, leitura e exportações.
- **Docas:** bases de Despacho, Aduana e Auditoria; exportação de reporte.
- **Ranking PNG:** Canvas com imagens de `public/ranking-cabecalho.png` e `public/ranking-rodape.png`, data dinâmica e divisão em partes quando necessário.

### Validação de relatório

Confira contagens, data, origem dos CSVs, filtros, deduplicação, IDs não encontrados e existência de múltiplos ciclos antes de divulgar resultados como oficiais.

## Deploy e operação

O arquivo `vercel.json` contém rewrite para `index.html` nas rotas que não começam com `api/`, preservando a navegação da SPA.

Fluxo recomendado:

1. Criar branch de alteração e revisar PR.
2. Executar `npm run lint` e `npm run build`.
3. Testar login, importação, bipagem, sincronização, reportes e reset em staging.
4. Revisar variáveis e permissões do ambiente Vercel.
5. Testar autorização em cada endpoint de leitura e mutação.
6. Confirmar deploy e registrar SHA do commit aplicado.
7. Executar smoke test da interface após o deploy.
8. Ter procedimento de reversão documentado.

**Não** aponte um staging com dados fictícios para bancos de produção.

## Qualidade e validação

Matriz mínima para homologação:

| Cenário | Esperado |
| --- | --- |
| Login válido / inválido | Sessão apenas para credenciais válidas e usuário aprovado |
| Usuário sem permissão | Recurso negado também no backend |
| CSV vazio / malformado | Erro claro sem apagar dados existentes |
| CSV com duplicatas | Regras de contagem documentadas e verificadas |
| Lista de 1 mil e de 10 mil IDs | Interface responsiva e estatísticas corretas |
| Bip duplicado simultâneo | Não elevar contadores indevidamente |
| Rede instável | Indicação de falha/retry sem perda silenciosa |
| Reset de refugo e ranking | Escopo de limpeza previsível |
| Reporte Todos / Top 10 | Conteúdo correto em PNG e download repetido |
| Navegação mobile e desktop | Campos, tabelas e ações acessíveis |

Adicione testes automatizados e regras de revisão de PR antes de chamar o sistema de pronto para escalar.

## Riscos conhecidos e prioridades

**Prioridade crítica — antes de produzir com dados reais:**

1. Corrigir o fluxo de validação de credenciais e os caminhos legados de autenticação.
2. Impedir concessão de privilégios no cliente e verificar autorização de todas as mutações no servidor.
3. Revisar Firestore rules, Supabase RLS, permissões de service accounts e tratamento de dados pessoais.
4. Revisar e retirar credenciais antigas eventualmente expostas; use rotação e armazenamento seguro.
5. Revisar interceptação global de `window.fetch` em Brancas.
6. Revisar dependências entre estado local e dados compartilhados.

**Outras prioridades:** dividir componentes grandes, padronizar UI, ampliar telemetria e melhorar estados de erro/offline.

Mais detalhes no [Plano de profissionalização](./PLANO-PROFISSIONALIZACAO.md). Relate problemas de segurança por canal privado, evitando divulgar payloads e dados pessoais em issues públicas.

## Checklist pré-publicação

- [ ] Dados de exemplo sem identificadores operacionais reais.
- [ ] Uso de nomes e marcas de terceiros devidamente autorizado.
- [ ] Autenticação e permissões auditadas e corrigidas.
- [ ] Variáveis privadas ausentes do repositório e do bundle.
- [ ] Conexões de frontend/backend apontando para os ambientes esperados.
- [ ] `npm run lint` e `npm run build` validados.
- [ ] Fluxos críticos testados em staging.
- [ ] Política de retenção, acesso e exclusão de dados definida.
- [ ] Manual de Uso revisado e aprovado por operadores.
- [ ] Suporte e procedimento de incidentes definidos.

---

Leia também: [Manual de Uso](./MANUAL-DE-USO.md). Esta documentação é destinada a desenvolvedores e administradores técnicos e deve ser atualizada junto com as mudanças de arquitetura.
