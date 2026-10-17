# Padrão visual Ecooy

A navegação de todas as telas usa `DashboardShell`. O catálogo em `src/lib/navigation.ts` alimenta o menu, a busca e a página inicial; novos módulos devem ser cadastrados ali. As permissões do catálogo controlam a exibição, e não substituem a autorização no servidor.

Os tokens em `src/index.css` definem o visual compartilhado:

- Ação principal: `--ecooy-primary`; hover: `--ecooy-primary-hover`.
- Fundo: `--ecooy-bg`; superfície: `--ecooy-surface`; borda: `--ecooy-border`.
- Texto: `--ecooy-ink`; secundário: `--ecooy-muted`.
- Painéis: raio de 12px; campos e botões: 8px; espaçamento em múltiplos de 4px.
- Vermelho indica erro ou ação destrutiva, verde indica sucesso, âmbar indica atenção. Categorias de módulos não precisam de paletas diferentes.

Use `ecooy-panel`, `ecooy-control`, `ecooy-table` e `ui-button` para novos componentes. Acrescente `ui-button-primary` à ação principal. Mantenha um título de página, descrições curtas e ações próximas do conteúdo. Evite títulos inteiros em maiúsculas, gradientes decorativos e cabeçalhos duplicados.

O menu vira uma gaveta abaixo de 1024px. Inclua nomes acessíveis nos controles de ícone, foco visível e estados vazios. Preserve as cores operacionais de gráficos, docas e relatórios exportados.

## Verificação da mudança

Layout revisado em Chromium com dados fictícios e chamadas aos bancos bloqueadas. Conferidos: página inicial em 1440px e 390px, filtro de módulos, menu móvel, login, listas, correlação e refugo. A revisão visual não homologa os fluxos de dados ou as permissões de produção.
