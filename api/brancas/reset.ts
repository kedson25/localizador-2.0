import { runSafeBrancasHandler } from '../_lib/safe-brancas-entry';

export default async function handler(req: any, res: any) {
  return runSafeBrancasHandler(
    req,
    res,
    'reset',
    () => import('../_brancas/reset')
  );
}
