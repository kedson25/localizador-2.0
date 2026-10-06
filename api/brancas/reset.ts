import { runSafeBrancasHandler } from '../_lib/safe-brancas-entry';
import { requireBrancasAuth } from '../_lib/brancas-auth';
import { authorizeAdmin } from '../_lib/http-auth';

export default async function handler(req: any, res: any) {
  if (!(await requireBrancasAuth(req, res))) return;
  if (!(await authorizeAdmin(req, res))) return;
  return runSafeBrancasHandler(
    req,
    res,
    'reset',
    () => import('../_brancas/reset')
  );
}
