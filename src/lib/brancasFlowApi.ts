import { readJsonResponse } from './safeJsonResponse';
import { auth as firebaseAuth } from './firebase-core';

export async function resetBrancasFlow(): Promise<{ flowId: string; message?: string }> {
  await firebaseAuth.authStateReady();
  const user = firebaseAuth.currentUser;
  if (!user) throw new Error('Faça login para acessar a Análise de Brancas.');
  const response = await fetch('/api/brancas/reset', {
    method: 'POST',
    headers: { Accept: 'application/json', Authorization: `Bearer ${await user.getIdToken()}` },
  });

  const json = await readJsonResponse<any>(response, {
    fallbackMessage: 'Falha ao zerar fluxo de Brancas.',
    serverErrorMessage:
      'A API de Brancas está temporariamente indisponível. Não foi possível zerar o fluxo agora.',
  });

  return json?.data || json;
}
