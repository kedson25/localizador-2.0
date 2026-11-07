# Módulos com Links e Descrições na Rota Guia (`/guia`)

Permitir que administradores cadastrem e editem **descrições e links** (tanto vídeo-aulas quanto links externos como planilhas, documentos e ferramentas) dentro de cada módulo da página **Guias**, mantendo as descrições sempre visíveis logo abaixo do título do módulo e de cada item.

## Revisão e Decisões Confirmadas

> [!IMPORTANT]
> As escolhas abaixo refletem suas respostas e as diretrizes definidas anteriormente para a tela `/guia`:

- **Exibição das Descrições (Confirmado)**: A descrição do módulo fica visível diretamente abaixo do título do cabeçalho do módulo, e a descrição de cada item/link fica visível logo abaixo do título do respectivo item.
- **Comportamento dos Links (Padrão Recomendado)**: Links de vídeo (YouTube, Google Drive, Vimeo, Loom ou `.mp4`) abrem no player integrado da página (com opção de abrir em nova aba), enquanto links externos gerais (planilhas, formulários, sites ou sistemas) abrem diretamente em uma nova guia.
- **Permissão Exclusiva de Admin**: Apenas administradores autenticados visualizam os controles para adicionar ou editar módulos, links e descrições; visitantes sem login e operadores visualizam apenas o conteúdo limpo e o menu Drawer (**Localizador** e **Guias**).

---

## 1. Visão Geral e Conceito

- **O que faz**: Transforma cada módulo da aba **Guias** em um bloco completo de orientação operacional, onde o Admin pode definir:
  1. **Título e Descrição Geral do Módulo** (ex.: orientações gerais do processo daquele setor).
  2. **Itens do Módulo (Vídeos e Links)**: Cada item possui título, descrição detalhada visível abaixo do título e link clicável (vídeo ou link externo).
- **Público-Alvo**: Operadores e equipe logística que acessam `/guia` sem login para consultar IDs e acessar treinamentos, procedimentos e links úteis da operação.
- **Valor Principal**: Centraliza instruções escritas, vídeos de treinamento e links operacionais em um único lugar organizado por módulos, sem poluição visual.

---

## 2. Experiência do Usuário e Design Visual

- **Fluxo de Uso**:
  1. O usuário acessa `/guia` e alterna pelo Drawer lateral entre **Localizador** e **Guias**.
  2. Na visão **Guias**, cada módulo exibe seu **Título** e, logo abaixo, sua **Descrição do Módulo** em texto legível e direto.
  3. Dentro do módulo, a lista de itens apresenta o **Título do Item**, a **Descrição do Item** logo abaixo do título e a ação direta (reproduzir vídeo na página ou abrir o link externo em nova aba).
  4. Quando logado como **Admin**, o usuário conta com botões discretos para **Adicionar Item / Link**, **Editar Módulo (nome e descrição)**, **Editar Item** e **Excluir**.
- **Identidade Visual e Tema**:
  - *Direção Estética*: Utilitária corporativa limpa, seguindo o padrão de bordas retas (`1px solid`), fundo neutro (`#EBEBEB`) e cartões brancos de nível único de elevação.
  - *Paleta de Cores*: Superfícies brancas (`#FFFFFF`), cabeçalhos de módulo em cinza suave (`#F8FAFC`), destaque amarelo institucional (`#FFE600`) com azul escuro (`#253B80`) no Drawer e azul de ação (`#1769FF`) nos links e botões administrativos.
  - *Tipografia e Hierarquia*: Títulos de módulo em caixa alta compacta (`12px`, `font-black`), descrições de módulo e de itens em texto corrido legível (`12px–13px`, `text-slate-600`, preservando quebras de linha com `whitespace-pre-line`).
- **Feedback Interativo**:
  - Notificações discretas (*toast*) ao criar, atualizar ou remover itens e módulos, sem uso de janelas de alerta nativas.

---

## 3. Decisões de Produto e Trade-Offs

- **Decisão 1: Suporte Unificado a Vídeos e Links Externos no Mesmo Módulo**
  - *Abordagem Escolhida*: Detectar automaticamente se o link informado é um vídeo incorporável (YouTube, Drive, Vimeo, Loom, `.mp4`) ou um link externo geral (planilha, documento, site). Se for vídeo, exibe o ícone de reprodução e abre o player na página (além de permitir abrir em nova aba); se for um link externo, exibe o ícone de link e abre diretamente em nova aba.
  - *Por quê*: Evita que o Admin precise preencher formulários separados para vídeos e links, mantendo o cadastro simples e rápido.
- **Decisão 2: Sincronização da Descrição do Módulo no Firestore + Cache Local**
  - *Abordagem Escolhida*: Armazenar a descrição do módulo (`moduleDescription`) e a descrição do item (`description`) sincronizadas em tempo real no Firestore com cache instantâneo em `localStorage`.
  - *Por quê*: Garante carregamento instantâneo (`0ms`) para quem abre `/guia` no coletor ou celular e atualiza em tempo real para toda a equipe quando o Admin edita um módulo.

---

## 4. Arquitetura Técnica e Estratégia de Dados

### Diagrama de Arquitetura e Componentes

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Rota Pública (/guia)                          │
│  ┌────────────────────────────────────────────────────────────────┐  │
│  │ Barra Superior + Drawer Lateral (Localizador | Guias)          │  │
│  └───────────────┬────────────────────────────────┬───────────────┘  │
│                  │                                │                  │
│                  ▼                                ▼                  │
│  ┌──────────────────────────────┐  ┌──────────────────────────────┐  │
│  │ Visão: Localizador           │  │ Visão: Guias (Módulos)       │  │
│  │ • Busca de IDs (MinimalMode) │  │ • Cabeçalho do Módulo        │  │
│  │ • Cruzamento em tempo real   │  │   - Título do Módulo         │  │
│  └──────────────────────────────┘  │   - Descrição do Módulo      │  │
│                                    │ • Lista de Itens do Módulo   │  │
│                                    │   - Título do Item           │  │
│                                    │   - Descrição abaixo título  │  │
│                                    │   - Ação: Player ou Link Ext │  │
│                                    │ • Modal Admin (Criar/Editar) │  │
│                                    └──────────────┬───────────────┘  │
└───────────────────────────────────────────────────┼──────────────────┘
                                                    │
                                                    ▼
                                     ┌──────────────────────────────┐
                                     │ Firestore (guia_aulas)       │
                                     │ + Cache Local (localStorage) │
                                     └──────────────────────────────┘
```

### Modelo de Dados e Estado

- **Entidade `GuiaLesson` (Item do Módulo)**:
  - `id`: Identificador único do item.
  - `moduleTitle`: Nome do módulo ao qual o item pertence.
  - `moduleDescription`: Descrição geral do módulo exibida abaixo do título do módulo.
  - `title`: Título da aula, link ou orientação.
  - `description`: Descrição detalhada exibida abaixo do título do item.
  - `videoUrl`: URL do vídeo ou link externo.
  - `createdAt` / `updatedAt` / `createdBy`: Metadados de auditoria e ordenação.

### Mapeamento de Interações

- **Criar / Editar Item (Admin)**: Modal único com campos para **Módulo** (com seleção rápida dos módulos existentes), **Descrição do Módulo** (preenchida automaticamente ao selecionar um módulo existente e editável), **Título do Item**, **Link (Vídeo ou URL externa)** e **Descrição do Item**.
- **Editar Módulo (Admin)**: Ao atualizar o nome ou a descrição de um módulo no cabeçalho do bloco, todos os itens daquele módulo têm seu cabeçalho/descrição de módulo sincronizados.
- **Clique no Item (Todos os Usuários)**:
  - Se o link for um vídeo compatível com player integrado, abre/fecha o player acima da lista.
  - Se o link for uma página ou documento externo, abre diretamente em uma nova aba segura (`target="_blank" rel="noopener noreferrer"`).
