import { runSafeBrancasHandler } from '../_lib/safe-brancas-entry';
import { requireBrancasAuth } from '../_lib/brancas-auth';

export default async function handler(req: any, res: any) {
  if (!(await requireBrancasAuth(req, res))) return;
  return runSafeBrancasHandler(
    req,
    res,
    'historico',
    () => import('../_brancas/historicoV2')
  );
}
