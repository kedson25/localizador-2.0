export type SafeJsonResponseOptions = {
  fallbackMessage: string;
  serverErrorMessage?: string;
};

function compactServerText(text: string): string {
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
}

export async function readJsonResponse<T = any>(
  response: Response,
  options: SafeJsonResponseOptions
): Promise<T> {
  const rawText = await response.text();
  let payload: any = null;

  if (rawText.trim()) {
    try {
      payload = JSON.parse(rawText);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const apiMessage =
      payload?.error?.message ||
      payload?.message ||
      payload?.error;

    if (typeof apiMessage === 'string' && apiMessage.trim()) {
      throw new Error(apiMessage.trim());
    }

    if (response.status >= 500) {
      throw new Error(
        options.serverErrorMessage ||
          `${options.fallbackMessage} O servidor está temporariamente indisponível (HTTP ${response.status}).`
      );
    }

    const serverText = compactServerText(rawText);
    throw new Error(
      serverText
        ? `${options.fallbackMessage} (HTTP ${response.status}: ${serverText})`
        : `${options.fallbackMessage} (HTTP ${response.status}).`
    );
  }

  if (!payload || typeof payload !== 'object') {
    throw new Error(
      `${options.fallbackMessage} A API respondeu em um formato inválido. Atualize a página e tente novamente.`
    );
  }

  if (payload.ok === false) {
    const apiMessage =
      payload?.error?.message ||
      payload?.message ||
      options.fallbackMessage;
    throw new Error(String(apiMessage));
  }

  return payload as T;
}
