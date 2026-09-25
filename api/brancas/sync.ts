import { requireBrancasAuth } from '../_lib/brancas-auth';
import syncV3Handler from '../_brancas/syncV3';

/**
 * Sincroniza diretamente pela Google Sheets API usando a conta de serviço.
 * A primeira execução fixa ext_brancas; as próximas confrontam apenas ext_rotas.
 */
export default async function handler(req: any, res: any) {
  if (!(await requireBrancasAuth(req, res))) return;
  return syncV3Handler(req, res);
}
