import { requireBrancasAuth } from '../_lib/brancas-auth';
import relatorioHandler from '../_brancas/relatorioV2';

export default async function handler(req: any, res: any) {
  if (!(await requireBrancasAuth(req, res))) return;
  return relatorioHandler(req, res);
}
