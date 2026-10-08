# Ecooy — Localizador 2.0

**Plataforma web de apoio a operações logísticas:** consulta de identificadores, listas de coleta, conferência de refugo, análise de brancas, correlação de arquivos, monitoramento de docas e relatórios.

> **Estado do projeto:** evolução contínua. A documentação descreve funções presentes no código; **não equivale a homologação de segurança nem a autorização para uso de dados pessoais ou operacionais reais**. Antes de uma implantação empresarial, conclua a revisão de autenticação, permissões, infraestrutura e privacidade.

## Documentação

| Documento | Para quem | Conteúdo |
| --- | --- | --- |
| **[Manual de Uso](docs/MANUAL-DE-USO.md)** | Operadores e apresentadores | Instruções completas por módulo, CSVs, indicadores, reportes, dúvidas e boas práticas |
| **[Guia Técnico](docs/GUIA-TECNICO.md)** | Desenvolvimento e TI | Arquitetura, APIs, ambiente, implantação, testes e limites |
| **[Plano de Profissionalização](docs/PLANO-PROFISSIONALIZACAO.md)** | Gestão do projeto | Prioridades de segurança, UX e preparação para implantação |

### Módulos principais

- **Base principal e Buscar IDs:** importação, consulta e conferência.
- **Listas de Coleta:** criação, bipagem, acompanhamento, exportação e fechamento.
- **Controle de Refugo:** conferência, leituras, resultados e relatórios.
- **Análise de Brancas:** cruzamento manual de CSV de brancas com CSV de rotas.
- **Correlação de IDs:** associação entre listas e dados FOS.
- **Remover IDs e Baixas:** filtros e análise de status.
- **Reporte WhatsApp:** composição de resumos operacionais.
- **Controle de Docas:** Aduana, Auditoria, Ranking de Auditores e exportação PNG.
- **Administração e Configurações:** usuários, listas, preferências e manutenção.

A área **Avarias** foi retirada da navegação atual.

## Primeiros passos

Para **usar** o sistema, obtenha a URL e uma conta aprovada com a equipe responsável. Comece com o [Manual de Uso](docs/MANUAL-DE-USO.md).

Para **desenvolver localmente**:

```bash
npm install
cp .env.example .env.local
npm run dev
```

Configure apenas **credenciais de desenvolvimento autorizadas**. No Windows PowerShell, use `Copy-Item .env.example .env.local`.

Scripts: `npm run dev`, `npm run build`, `npm run lint` e `npm run preview`. Consulte o guia técnico antes de fazer deploy.

## Tecnologia

React, TypeScript, Vite, Tailwind CSS, Firebase/Firestore, integrações Supabase/Google Sheets e funções HTTP sob `api/` para a Vercel. Nem todos os módulos utilizam o mesmo armazenamento.

## Privacidade e apresentação

Use dados fictícios ou anonimizados em demos públicas. Nomes, placas, identificadores de pacotes e relatórios internos devem ser tratados conforme autorização aplicável. O uso de marcas de terceiros não implica vínculo oficial.

**Segurança:** a implementação atual requer correções de autenticação e autorização antes de ser considerada pronta para processamento empresarial de informações reais.

## Atualizações

O manual acompanha o código inspecionado em **08/10/2026**. Para reportar divergências da documentação, abra uma solicitação de correção sem anexar dados sensíveis.
