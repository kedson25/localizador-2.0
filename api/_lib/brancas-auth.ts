import { AuthError, requireAuth } from './auth';

export async function requireBrancasAuth(req: any, res: any) {
  try {
    const user = await requireAuth(req);
    if (!user.isApproved) {
      res.status(403).json({ ok: false, error: { code: 'NOT_APPROVED', message: 'Seu acesso ainda não foi aprovado.' } });
      return null;
    }
    return user;
  } catch (error: any) {
    const status = error instanceof AuthError ? error.statusCode : 401;
    res.status(status).json({ ok: false, error: { code: error?.code || 'UNAUTHORIZED', message: error?.message || 'Não autorizado.' } });
    return null;
  }
}
