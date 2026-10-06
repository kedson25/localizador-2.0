import signupHandler from './_auth/signup';
import loginHandler from './_auth/login';
import usersHandler from './_auth/users';
import { sendError } from './_lib/response';
import { enforceRateLimit } from './_lib/rate-limit';

export default async function handler(req: any, res: any) {
  const { action } = req.query;
  if ((action === 'login' || action === 'signup') && !enforceRateLimit(req, res, `auth:${action}`, 10, 60_000)) return;
  switch (action) {
    case 'signup': return signupHandler(req, res);
    case 'login': return loginHandler(req, res);
    case 'users': return usersHandler(req, res);
    default: return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em auth');
  }
}
