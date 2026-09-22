import { runSafeBrancasHandler } from '../_lib/safe-brancas-entry';

export default async function handler(req: any, res: any) {
  return runSafeBrancasHandler(
    req,
    res,
    'relatorio',
    () => import('../_brancas/relatorioV2')
  );
}
