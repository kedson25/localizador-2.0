# Plano de profissionalização do Localizador 2.0

Este documento acompanha a evolução gradual do produto, preservando operações e dados reais. **Não declare o produto pronto para implantação empresarial antes de concluir P0.**

## P0 — Segurança (bloqueador para apresentação com dados reais)
- [ ] Substituir a autenticação por mecanismos verificados no servidor. O endpoint `api/_auth/login.ts` atualmente não valida a senha recebida antes de emitir um custom token.
- [ ] Remover gradualmente caminhos com tokens `user_<id>` e permissões concedidas pelo próprio cliente.
- [ ] Migrar usuários e credenciais com processo de transição testado; evitar travar usuários ativos.
- [ ] Revisar endpoints de alteração/exclusão, validação de papéis e regras dos bancos.
- [ ] Revisar dados sensíveis em CSV e relatórios; preparar demonstração com dados fictícios e consentimento de marca.

## P1 — Interface unificada
- [x] Criar tokens CSS e padrões compartilhados (`src/index.css`).
- [x] Aplicar base ao `DashboardShell` e à navegação operacional.
- [x] Remover indicador de notificação sem funcionalidade real.
- [ ] Adotar os padrões nos módulos de Coleta, Refugo, Brancas e Docas em PRs pequenos.
- [ ] Definir escala tipográfica (12/14/16/20/28), espaçamento, cores por estado e densidade de tabela.
- [ ] Harmonizar login e tela inicial com o mesmo produto.

## P2 — Engenharia e observabilidade
- [ ] Separar componentes extensos em hooks de estado, componentes de apresentação e adaptadores de dados.
- [ ] Remover interceptação global de `window.fetch` no módulo de Brancas.
- [ ] Padronizar tratamento de loading, vazio, erro, offline e sincronização.
- [ ] Adicionar testes de importação CSV, auditoria, reset, ranking e autenticação.
- [ ] Rodar `bun run build` e `bun run lint` em CI antes de promover deploy.

## P3 — Apresentação
- [ ] Preparar dataset de demonstração sem nomes, placas ou IDs reais.
- [ ] Demonstrar importar → analisar → encontrar divergência → tratar → exportar.
- [ ] Medir ganhos com metodologia reproduzível; evitar percentuais não auditados.

## Critério de conclusão
Cada módulo deve ter: visual consistente, acessibilidade de teclado, estados vazios/erro, fluxo testado e nenhuma regressão de operação. Segurança P0 deve ser verificada antes de dados de terceiros serem processados em produção.
