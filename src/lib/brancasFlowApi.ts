export async function resetBrancasFlow(): Promise<{ flowId: string; message?: string }> {
  const response = await fetch('/api/brancas/reset', {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });

  const json = await response.json();
  if (!response.ok || json?.ok === false) {
    throw new Error(json?.error?.message || json?.message || 'Falha ao zerar fluxo de Brancas.');
  }

  return json?.data || json;
}
