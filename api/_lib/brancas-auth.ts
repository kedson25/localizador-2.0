import { AuthError, requireGroup } from './auth';

export async function requireBrancasAuth(req: any, res: any) {
  try {
    return await requireGroup(req, 'brancas');
  } catch (error: any) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    res.status(status).json({
      ok: false,
      error: {
        code: error?.code || 'UNAUTHORIZED',
        message: error?.message || 'Não autorizado.',
      },
    });
    return null;
  }
}
