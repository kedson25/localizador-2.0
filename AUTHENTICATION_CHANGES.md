# Autenticação e migração incremental

O login mantém username/e-mail e senha. O layout permanece o atual.

## Comportamento

- Perfis legados são encontrados no servidor. Somente quando a conta ainda não existe no Firebase Auth a senha legada é comparada, usando comparação de hashes em tempo constante.
- A conta é criada com o UID do documento existente. O login é validado pelo Firebase antes da emissão de qualquer token.
- O campo password é removido com update, preservando aprovação, admin, grupos, histórico e IDs.
- Quando uma conta Auth existente possui outro UID, uma ligação authUid e a claim assinada profileId preservam o documento original. Ligações ambíguas são recusadas.
- Senhas legadas menores que seis caracteres passam por transformação SHA-256 no servidor antes da validação no Firebase. O perfil guarda somente o marcador authPasswordEncoding. O usuário continua digitando sua senha antiga. A transformação não é usada como comparação manual após a migração.
- Cadastro novo exige oito caracteres, cria Firebase Auth e perfil pendente sem senha. Se o perfil não puder ser gravado, a conta criada na mesma requisição é removida.
- APIs protegidas aceitam somente Firebase ID tokens verificados, com checagem de revogação. Papéis e aprovação vêm do perfil do servidor.
- A API de usuários exige admin; alterações ficam restritas a isAdmin, isApproved e allowedGroups, com tipos validados.
- Exclusões nas APIs de coleta/listas/refugo e reset de Brancas exigem admin. A ausência de Firebase Admin retorna 503.
- Os helpers REST internos de Firestore usam OAuth do servidor; não operam com acesso público. Bipagem não tenta REST quando o Admin SDK falha.

## Configuração e publicação

Configure FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY e FIREBASE_WEB_API_KEY no backend. O projeto da Web API key precisa ser o mesmo do Admin SDK e do frontend. Habilite o provedor de e-mail/senha do Firebase Authentication. Use FIRESTORE_DATABASE_ID caso o projeto use banco nomeado.

Publique firestore.rules junto com o backend/frontend. As regras reconhecem profileId para perfis cujo ID legado difere do UID Firebase. Não apague perfis nem execute migração em massa: ela acontece no login.

## Verificação

Execute: node node_modules/vitest/vitest.mjs run --config vitest.auth.config.ts

Os testes usam Firebase e validação de payload simulados; verificam o fluxo de autenticação, migração, emissão de token, cadastro e permissões. Não substituem integração com Firebase/emuladores. A checagem isolada TypeScript do núcleo passou. Build e checagem completa estão bloqueados pela instalação incompleta de dependências (zod e outros módulos) e por erros existentes em firebase-core.ts. Nenhum usuário real foi alterado nesta implementação.

O ZIP inclui os arquivos completos desta alteração e os helpers de autorização já presentes no workspace dos quais ela depende. As demais alterações locais do projeto não estão incluídas.
