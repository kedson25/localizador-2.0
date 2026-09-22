type HandlerLoader = () => Promise<{ default?: (req: any, res: any) => any }>;

function sendRuntimeError(res: any, endpoint: string) {
  const payload = {
    ok: false,
    error: {
      code: 'BRANCAS_RUNTIME_ERROR',
      message: 'A API de Brancas encontrou uma falha temporária. Tente novamente em alguns instantes ou use o modo CSV.',
      endpoint,
    },
  };

  if (res?.headersSent) {
    try {
      return res.end();
    } catch {
      return;
    }
  }

  try {
    if (typeof res?.status === 'function' && typeof res?.json === 'function') {
      res.setHeader?.('Cache-Control', 'no-store');
      return res.status(500).json(payload);
    }

    res.statusCode = 500;
    res.setHeader?.('Content-Type', 'application/json; charset=utf-8');
    res.setHeader?.('Cache-Control', 'no-store');
    return res.end(JSON.stringify(payload));
  } catch (sendError) {
    console.error(`[Brancas API] Falha ao enviar erro JSON em ${endpoint}:`, sendError);
    return;
  }
}

export async function runSafeBrancasHandler(
  req: any,
  res: any,
  endpoint: string,
  loader: HandlerLoader
) {
  try {
    res?.setHeader?.('Cache-Control', 'no-store');

    const module = await loader();
    const handler = module?.default;

    if (typeof handler !== 'function') {
      throw new Error(`Handler ${endpoint} não disponível.`);
    }

    return await handler(req, res);
  } catch (error: any) {
    console.error(`[Brancas API] Falha não tratada em ${endpoint}:`, {
      message: error?.message || String(error),
      stack: error?.stack,
    });

    return sendRuntimeError(res, endpoint);
  }
}
