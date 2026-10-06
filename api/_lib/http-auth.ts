import { AuthError, requireAdmin, requireGroup } from './auth';
import { sendError } from './response';

function deny(res: any, error: any) {
  const status = error instanceof AuthError ? error.statusCode : 401;
  return sendError(res, status, error?.code || 'UNAUTHORIZED', error?.message || 'Não autorizado.');
}

export async function authorizeGroup(req: any, res: any, group: string): Promise<boolean> {
  try {
    await requireGroup(req, group);
    return true;
  } catch (error) {
    deny(res, error);
    return false;
  }
}

export async function authorizeAdmin(req: any, res: any): Promise<boolean> {
  try {
    await requireAdmin(req);
    return true;
  } catch (error) {
    deny(res, error);
    return false;
  }
}
