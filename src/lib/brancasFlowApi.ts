import { readJsonResponse } from './safeJsonResponse';

export async function resetBrancasFlow(): Promise<{ flowId: string; message?: string }> {
  const response = await fetch('/api/brancas/reset', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  const json = await readJsonResponse<any>(response, {
    fallbackMessage: 'Falha ao zerar fluxo de Brancas.',
    serverErrorMessage:
      'A API de Brancas está temporariamente indisponível. Não foi possível zerar o fluxo agora.',
  });

  return json?.data || json;
}
