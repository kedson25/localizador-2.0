# Manual de uso — Ecooy / Localizador 2.0

**Versão documental:** 1.0 • **Revisado em:** 08/10/2026  
**Produto:** ferramenta web de apoio a rotinas logísticas, consulta de IDs, coleta, conferência, correlação e relatórios.  
**Código-fonte:** [Localizador 2.0](https://github.com/kedson25/localizador-2.0)

> **Aviso sobre a publicação:** documentação baseada na leitura do código atual. Algumas funções dependem de permissões, conexão e serviços configurados no ambiente. Não significa certificação de segurança, homologação empresarial ou garantia de disponibilidade. Use dados fictícios nas demonstrações públicas. O nome e a identidade visual de terceiros não implicam vínculo ou aprovação dessas organizações.

## Índice

1. [Visão geral](#1-visão-geral)
2. [Acesso e navegação](#2-acesso-e-navegação)
3. [Preparação de arquivos CSV](#3-preparação-de-arquivos-csv)
4. [Base principal e consulta de IDs](#4-base-principal-e-consulta-de-ids)
5. [Listas de Coleta](#5-listas-de-coleta)
6. [Controle de Refugo](#6-controle-de-refugo)
7. [Análise de Brancas](#7-análise-de-brancas)
8. [Correlação de IDs](#8-correlação-de-ids)
9. [Remover IDs](#9-remover-ids)
10. [Baixas](#10-baixas)
11. [Reporte WhatsApp](#11-reporte-whatsapp)
12. [Controle de Docas](#12-controle-de-docas)
13. [Ranking de auditores](#13-ranking-de-auditores)
14. [Painel de administração](#14-painel-de-administração)
15. [Configurações](#15-configurações)
16. [Dados e persistência](#16-dados-e-persistência)
17. [Erros comuns e solução de problemas](#17-erros-comuns-e-solução-de-problemas)
18. [Boas práticas e glossário](#18-boas-práticas-e-glossário)
19. [Limites e escopo](#19-limites-e-escopo)

## 1. Visão geral

O Ecooy reúne módulos de apoio ao processamento e à conferência de pacotes. É possível importar arquivos, comparar IDs entre bases, consultar rotas, registrar leituras, acompanhar divergências e preparar reportes. As operações não possuem necessariamente uma única base de dados: algumas informações são compartilhadas via serviços remotos, enquanto outras ficam apenas no navegador.

### Módulos disponíveis

| Recurso | Acesso | Finalidade |
| --- | --- | --- |
| Módulos | `/` | Página inicial e acesso às ferramentas |
| Importar CSV | `/upload` | Carregar a base principal |
| Buscar IDs | `/consulta` | Consultar IDs da base e informações relacionadas |
| Listas de Coleta | `/listas` | Criar, abrir e acompanhar listas de bipagem |
| Baixas | `/baixas` | Importar status Entregue / Em rota |
| Remover IDs | `/remover` | Comparar e filtrar IDs de uma base |
| Reporte WhatsApp | `/reporte` | Elaborar um resumo compartilhável |
| Controle de Refugo | `/refugo` | Bipar e conferir pacotes faltantes |
| Análise de Brancas | `/brancas` | Comparar etiquetas brancas com listas de rotas |
| Correlação de IDs | `/correlacao` | Cruzar lista de IDs com arquivo FOS |
| Controle de Docas | `/expedicao` | Monitorar Aduana, Auditoria e Ranking |
| Administração | `/admin` | Usuários, listas e métricas, para administradores |
| Configurações | `/configuracoes` | Preferências e manutenção |

> A aba **Avarias** foi retirada da navegação e do roteamento atual. Ela **não** faz parte do manual de operação disponível.

## 2. Acesso e navegação

1. Abra a URL de implantação disponibilizada pela pessoa responsável.
2. Em **Login**, informe usuário ou e-mail, avance e digite a senha.
3. Se ainda não tiver conta, use **Criar conta** e aguarde aprovação quando aplicável.
4. Na tela **Módulos**, escolha a ferramenta desejada, ou pesquise pelo nome.
5. O botão **Módulos** retorna ao início; **Sair** encerra a sessão local.

**Permissões:** algumas ferramentas dependem dos grupos liberados para a conta; a área administrativa requer perfil de administrador. A existência de um botão na tela não substitui validações de acesso no servidor.

**Recomendação:** não compartilhe credenciais nem utilize contas genéricas para registrar autoria operacional.

## 3. Preparação de arquivos CSV

Antes de importar:

- Use arquivos exportados diretamente da fonte de dados autorizada; mantenha uma cópia do original.
- Garanta uma coluna com identificador único do pacote, como **ID** ou **Shipment ID**, conforme o módulo.
- Confira delimitador, cabeçalhos, células vazias e aspas. CSV, TXT e TSV são aceitos em determinados módulos, mas **não em todos**.
- Preserve IDs como texto para evitar perda de dígitos por planilhas eletrônicas.
- Evite compartilhar planilhas contendo nomes, placas ou identificadores reais em ambientes públicos.
- Verifique visualmente quantidades e amostras antes de confiar no resultado do processamento.

### Exemplos ilustrativos (dados fictícios)

**Base simples:**
```csv
ID,Saída,MOTIVO
EXEMPLO00001,SD,Etiqueta Branca
EXEMPLO00002,PM,Sem motivo
```

**Auditoria para Ranking:**
```csv
Shipment ID,Data auditoria,Contenedor,Estado,Rep auditoria
EXEMPLO00001,08/10/2026 07:16:10,A1,Correto,Operador Exemplo
EXEMPLO00002,08/10/2026 07:20:10,A2,A mais,Operador Exemplo
```

Os nomes exatos de algumas colunas dependem do arquivo e do fluxo. Quando houver opções de mapeamento, selecione a coluna correta e confirme o resultado.

## 4. Base principal e consulta de IDs

**Rota:** `/upload` e `/consulta`.

### Carregar ou atualizar a base

1. Na tela **Módulos**, clique em **Carregar CSV** ou **Atualizar CSV**, conforme a situação.
2. Escolha um arquivo `.csv`, `.txt` ou `.tsv` em **Importar Arquivo**.
3. Aguarde o processamento e retorne à tela principal.
4. Confira a quantidade de IDs indicada.

A base principal alimenta funcionalidades como consulta, remoção e reporte. O comando **Zerar base** limpa essa base e deve ser utilizado somente após confirmar que você tem o arquivo original.

### Buscar IDs

1. Acesse **Buscar IDs**.
2. Consulte o ID ou grupo desejado.
3. Examine os dados associados ao pacote, como saída, rota e motivo, quando presentes na base.
4. Utilize as ferramentas de importar grupo ou registrar erro de roteamento somente após conferir a lista de destino.

**Importante:** a consulta não constitui prova de localização física. O resultado depende do arquivo carregado, do processamento e dos registros acessíveis ao módulo.

## 5. Listas de Coleta

**Rota:** `/listas`.

### Criar lista

1. Clique em **Nova lista**.
2. Defina nome, data, ciclo e tipo de lista, de acordo com os campos disponíveis.
3. Confirme e abra a lista.

Os ciclos disponíveis nos fluxos operacionais incluem **AM**, **PM** e **SD**. O cadastro pode oferecer organização **Comum** ou **Por grupos**.

### Trabalhar com a lista

1. Abra a lista no painel.
2. Importe ou inclua IDs pelo fluxo oferecido.
3. Realize a leitura/bipagem dos pacotes.
4. Verifique totais, pendências, estado de sincronização e ciclo selecionado.
5. Evite repetir leituras durante sincronização ou falha de rede; confira se o ID foi efetivamente registrado.

### Gerenciar listas

O painel permite pesquisar por **nome, ciclo ou responsável**, filtrar por período, **Sincronizar**, **Exportar IDs**, **Reabrir** listas finalizadas e **Excluir** listas. **Excluir é uma ação destrutiva**: confira lista, data e ciclo antes de confirmar. A exportação de IDs gera um CSV.

**Boa prática:** mantenha uma lista por objetivo operacional claramente identificado; informe responsável, ciclo e data de forma consistente.

## 6. Controle de Refugo

**Rota:** `/refugo`.

Objetivo: conferir pacotes faltantes com leitura individual e comparar com uma base importada.

### Procedimento

1. Acesse **Controle Refugo**.
2. Clique em **Carregar Base CSV** e importe o arquivo de referência.
3. Na seção **Leitura de Pacotes**, bिपe ou digite o código.
4. Verifique o retorno na tela, especialmente se o pacote está na base e se há rota associada.
5. Ao concluir, use **Baixar Bipados (CSV)** para exportar registros, quando necessário.
6. Se houver IDs **SEM ROTA**, utilize **Exportar Lista Branca** para preparar um tratamento específico.

Há ações de métricas e limpeza no módulo. Execute reset/limpeza apenas quando o turno estiver encerrado e as exportações pertinentes tiverem sido conferidas. **Zerar a base não equivale necessariamente a apagar históricos ou arquivos já baixados.** 

## 7. Análise de Brancas

**Rota:** `/brancas`.

A tela atual oferece análise manual usando arquivos locais. O objetivo é identificar quais IDs da base de etiquetas brancas aparecem nas listas de rotas, acompanhando resultados ao longo de importações sucessivas.

### Primeira análise

1. Clique em **Carregar arquivos**.
2. Selecione **Brancas** (base inicial obrigatória).
3. Selecione **Rotas** (arquivo obrigatório para comparação).
4. Execute a análise e confira as contagens e os resultados apresentados.

### Análises seguintes

1. Clique em **Carregar rotas**.
2. Mantenha a base de Brancas armazenada ou selecione um novo arquivo para substituí-la.
3. Importe o CSV de rotas do novo ciclo.
4. Repita a análise e acompanhe identificadores que passaram a aparecer na lista.

O módulo oferece histórico local por pacote e o comando **Zerar fluxo**, que descarta a sequência armazenada e exige nova base. A análise manual utiliza o navegador; **não trate o resultado como automaticamente sincronizado entre colaboradores**.

**Interpretação:** um ID encontrado no CSV de rotas indica correspondência entre arquivos, não comprovação de entrega ou despacho físico.

## 8. Correlação de IDs

**Rota:** `/correlacao`.

Usado para comparar uma lista de referência com um arquivo FOS, associando IDs a motivo e data.

1. Importe o arquivo da **Lista**.
2. Importe o arquivo **FOS**.
3. Selecione a **Coluna do ID da lista**.
4. Selecione a **Coluna com ID FOS – ID lista**.
5. Selecione, se disponíveis, **Coluna do motivo** e **Coluna da data**.
6. Confira as correspondências, pesquise resultados e exporte o arquivo `correlacao-ids.csv` quando necessário.

Uma ausência de correspondência pode decorrer de formato diferente do ID, coluna selecionada incorretamente ou ausência do registro na fonte.

## 9. Remover IDs

**Rota:** `/remover`.

Use esta ferramenta para gerar um novo conjunto de linhas removendo IDs selecionados.

1. Carregue a base principal **ou** cole um CSV específico em **Base CSV**.
2. Cole na área de remoção os IDs a excluir, um por linha.
3. Configure filtros disponíveis, como saída e pesquisa.
4. Confira a quantidade final e utilize **Exportar**.
5. Verifique o CSV gerado antes de substituir qualquer arquivo original.

O módulo gera um arquivo filtrado; **isso não significa excluir os pacotes dos sistemas logísticos de origem**.

## 10. Baixas

**Rota:** `/baixas`.

Importa um CSV/TXT com identificadores e status. O processador considera registros de **Entregue** e **Em rota**; reconhece cabeçalhos de ID e status e pode ler as duas primeiras colunas quando não houver cabeçalhos compatíveis.

1. Selecione o arquivo.
2. Confira **Pacotes no fluxo**, **Entregues**, **Em rota** e **Taxa de entrega**.
3. Verifique amostras na lista de baixas importadas.

**Fórmula:** taxa = Entregues / Total de itens reconhecidos × 100 (arredondada). Essa métrica reflete apenas o arquivo processado; não é a taxa oficial de entrega da operação.

Os registros deste painel são salvos no navegador e podem alimentar resumos exibidos na área de relatórios.

## 11. Reporte WhatsApp

**Rota:** `/reporte`.

1. Acesse **Reporte WhatsApp**.
2. Escolha uma lista, use a base principal ou importe/cole os IDs oferecidos pelo formulário.
3. Confira correspondências, ausências, saída, motivos e totalizadores.
4. Preencha campos contextuais, como ciclo ou texto livre, quando disponíveis.
5. Revise integralmente o resumo antes de copiar, compartilhar ou enviar por um canal externo.

O resultado é um **reporte construído a partir das fontes selecionadas**. Sempre confira a data de referência e evite expor IDs ou informações pessoais em grupos sem autorização.

## 12. Controle de Docas

**Rota:** `/expedicao`.

Três visões principais: **Aduana • vagas**, **Auditoria • pacotes** e **Ranking auditores**. O monitoramento cruza dados de Despacho, Aduana e Auditoria para localizar divergências e produzir reportes.

### Preparar o monitoramento

1. Na área de importação, carregue **Despacho**, quando o módulo solicitar a base principal.
2. Na aba **Aduana • vagas**, importe **Aduana**.
3. Na aba **Auditoria • pacotes**, importe **Auditoria**.
4. Confira indicadores e a lista de vagas ou pacotes.
5. Use a pesquisa e filtros disponíveis para restringir registros.

No monitoramento, há filtros de status e presença em **lista do dia**, com opções como **Todos**, **Em lista do dia**, **Fora das listas**, **Encontrados** e **Pendentes**. A disponibilidade depende da aba.

### Analisar divergências

- **A mais:** ocorrência que requer análise, não prova automática de erro humano.
- **Faltante:** item esperado e não identificado segundo as regras da comparação.
- **Encontrado/pendente:** classificação da base ou da conferência processada.
- Selecione uma **vaga** para consultar seus IDs e conferir a origem dos registros.

### Gerar reporte

Clique em **Reporte**, confira o resumo de Aduana e Auditoria e use **Baixar PNG** ou o compartilhamento disponível. O recurso de compartilhamento pode recorrer ao compartilhamento nativo do navegador ou a um link de WhatsApp, dependendo do dispositivo.

### Reset

O botão **Zerar** atua sobre o monitoramento de Docas e exige confirmação. **Não confunda esse reset com o botão Zerar ranking** da aba de auditores: são fluxos distintos e podem ter persistências diferentes.

## 13. Ranking de auditores

**Caminho:** Controle de Docas → **Ranking auditores**.

### Importação e cálculo

1. Importe CSV de **Aduana**, **Auditoria** ou ambos.
2. Para o cálculo, são necessárias as colunas **Shipment ID** e **Rep auditoria**.
3. O sistema também reconhece, para os campos adicionais, **Estado/Status**, **ID da rota/Contenedor/Rota** e **Data auditoria/Data da auditoria/Data**.
4. Clique em **Calcular ranking**.
5. Filtre pelo nome do colaborador, escolha **Todos** ou **Top 10**, e gere o PNG.

### Como as métricas são calculadas

- **Pacotes auditados (ranking):** total de registros finais por `fonte + Shipment ID`. O registro mais recente por data prevalece dentro da mesma fonte.
- **Rotas distintas:** número de códigos de rota diferentes por colaborador, deduplicados entre os dois arquivos.
- **Corretos:** registros finais com estado `Correto`.
- **A mais:** registros finais com estado `A mais`.
- **Pacotes / rota:** total auditado dividido por rotas distintas, **arredondado para inteiro** na apresentação.
- **Classificação:** maior total de pacotes auditados; em empate, considera mais rotas, mais corretos e ordem alfabética.

**Atenção:** o mesmo Shipment ID pode contribuir em ambas as fontes, pois são contagens por fonte. Portanto, os totais do ranking **não** devem ser interpretados automaticamente como número de pacotes fisicamente únicos.

### Exportação

O botão **Baixar reporte PNG** muda para **Baixando...** durante a geração; depois é liberado novamente. O relatório inclui cabeçalho e rodapé personalizados, data de geração atual e tabela alinhada. **Todos/Top 10** controlam o conjunto visível e exportado; listas grandes podem ser divididas em arquivos de partes.

### Persistência

O ranking calculado é armazenado no `localStorage` e os CSVs processados em armazenamento local/IndexedDB. **Esses dados não são garantidos em outros navegadores, perfis ou dispositivos.** O comando **Zerar ranking** elimina os dados salvos desse ranking local, sem zerar automaticamente o monitoramento de Docas.

## 14. Painel de administração

**Rota:** `/admin`, disponível para contas com perfil de administrador.

O painel possui ferramentas para revisão de **usuários**, solicitações de aprovação, **listas**, pendências e métricas, conforme a configuração da implantação.

### Rotina recomendada

1. Revise pedidos pendentes de acesso.
2. Conceda somente os módulos necessários a cada usuário.
3. Verifique listas em andamento, responsáveis e pendências.
4. Use as opções de fechamento para registrar situação como **Em andamento**, **Finalizada** ou motivo de fechamento, quando disponível.
5. Exporte pendentes para conferência e mantenha a trilha de validação externa quando necessária.

Excluir usuários, alterar perfis e finalizar listas são ações administrativas e exigem confirmação organizacional prévia.

## 15. Configurações

**Rota:** `/configuracoes`.

A seção **Preferências** contém opções como notificações e modo compacto, salvas no navegador. **Modo manutenção global** é uma área administrativa: permite indicar ativação, prazo e mensagem de manutenção. Verifique impacto operacional e comunicação com a equipe antes de ativar.

## 16. Dados e persistência

| Informação | Onde fica / como se comporta |
| --- | --- |
| Base principal de IDs | Mantida pelo fluxo da base principal e serviços associados; pode ser recarregada via CSV |
| Listas de Coleta | Utilizam APIs/serviços de dados com sincronização; exigem conexão adequada |
| Refugo | Possui fluxo de registros e métricas remotos, além de estado no navegador |
| Brancas manual | Base e sequência mantidas localmente no navegador |
| Ranking | Resultado em `localStorage`; arquivos processados em IndexedDB |
| Baixas | `localStorage` do navegador |
| Arquivos PNG/CSV exportados | Downloads locais no dispositivo; não se apagam ao zerar uma tela |
| Conta e preferências | Parte da sessão e das preferências é armazenada localmente |

**Regra essencial:** nem todas as abas compartilham os mesmos dados ou o mesmo alcance de sincronização. Em trabalho colaborativo, confirme qual fonte é considerada oficial antes de comparar totais.

## 17. Erros comuns e solução de problemas

| Sintoma | Verifique / ação recomendada |
| --- | --- |
| Login não funciona | Confirme usuário, senha, aprovação e conexão; solicite suporte ao responsável |
| Módulo não aparece | Pode haver restrição de permissão ou a rota ter sido removida |
| CSV sem registros | Confira se o arquivo tem cabeçalhos esperados, IDs válidos e delimitadores corretos |
| ID não encontrado | Confirme conteúdo, normalização e a base/ciclo selecionado |
| Total diferente da planilha | Verifique filtros, duplicatas, datas, fontes e regras de deduplicação |
| Resultado não aparece para outro usuário | Verifique se o módulo armazena apenas no navegador |
| Bipagem demora ou falha | Verifique status de sincronização e rede antes de repetir o bip |
| Arquivo PNG não baixa | Confira permissões de download e bloqueios do navegador; tente novamente |
| Reset não limpa exportação anterior | Arquivos baixados são independentes do armazenamento do sistema |
| Relatório diverge da operação | Confira data do CSV, última atualização, filtros e eventos posteriores |

Se o erro persistir, registre **módulo, horário, ação executada, versão do arquivo, mensagem exibida e ambiente**, sem divulgar senhas ou dados pessoais.

## 18. Boas práticas e glossário

### Boas práticas diárias

1. Identifique **turno/ciclo e data de referência** antes de importar.
2. Salve uma cópia da base original.
3. Valide alguns IDs e totais após cada carga.
4. Diferencie **encontrado na planilha** de **localizado fisicamente**.
5. Revise divergências antes de comunicar causas ou responsáveis.
6. Exporte o relatório final e anote seus critérios.
7. Não utilize reset enquanto outras pessoas dependem do fluxo.
8. Compartilhe somente informações necessárias e autorizadas.

### Glossário

- **ID / Shipment ID:** identificador do pacote ou expedição na base utilizada.
- **Bipagem:** leitura/registro de um identificador por scanner ou teclado.
- **Rota:** agrupamento logístico que pode ter código específico.
- **Ciclo:** janela de operação, como AM, PM ou SD.
- **Brancas:** pacotes presentes na base de etiquetas brancas analisada.
- **Refugo:** fluxo de conferência e tratamento de pacotes divergentes ou faltantes.
- **Aduana / Auditoria:** arquivos e painéis de conferência do monitoramento.
- **A mais:** categoria de divergência presente na fonte de auditoria.
- **Faltante:** item esperado não localizado pela regra de cruzamento vigente.
- **Sincronização:** envio/recebimento de alterações nos serviços usados pelo módulo.
- **Ranking:** ordenação dos auditores pelo total de registros auditados.
- **CSV:** formato tabular de texto com colunas delimitadas.

## 19. Limites e escopo

Esta documentação descreve funcionalidades identificadas no repositório na data acima. Não substitui treinamento, procedimentos de segurança, validação das fontes ou normas da organização usuária. O código contém caminhos de autenticação legados que **devem ser revisados antes de qualquer implantação empresarial com dados reais**. A publicação deste manual não certifica o produto como pronto para produção nem comprova testes ponta a ponta.

**Para manutenção, implantação e segurança**, consulte [Guia técnico](./GUIA-TECNICO.md) e [Plano de profissionalização](./PLANO-PROFISSIONALIZACAO.md).
