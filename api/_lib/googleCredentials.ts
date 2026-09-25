/**
 * Credenciais são carregadas exclusivamente das variáveis de ambiente da Vercel.
 * Este módulo existe apenas para manter compatibilidade com o backend legado.
 */
export const SERVICE_ACCOUNT_CREDENTIALS: {
  client_email?: string;
  private_key?: string;
} = {};
