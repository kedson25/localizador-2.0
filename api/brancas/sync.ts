import { runSafeBrancasHandler } from '../_lib/safe-brancas-entry';

export default async function handler(req: any, res: any) {
  return runSafeBrancasHandler(
    req,
    res,
    'sync',
    () => import('../_brancas/syncV3')
  );
}
