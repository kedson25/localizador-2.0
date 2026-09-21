import syncHandler from './_brancas/sync';
import relatorioHandler from './_brancas/relatorio';
import historicoHandler from './_brancas/historico';
import checkHandler from './_brancas/check';
import { sendError } from './_lib/response';

export default async function handler(req: any, res: any) {
  const urlPath = (req.url || '').split('?')[0].replace(/\/+$/, '');
  const { action } = req.query || {};

  // Se o caminho especifica a sub-rota
  if (urlPath.endsWith('/check') || action === 'check' || action === 'cron') {
    return checkHandler(req, res);
  }

  if (urlPath.endsWith('/sync') || action === 'sync') {
    return syncHandler(req, res);
  }

  if (urlPath.endsWith('/relatorio') || action === 'relatorio') {
    return relatorioHandler(req, res);
  }

  if (urlPath.endsWith('/historico') || action === 'historico') {
    return historicoHandler(req, res);
  }

  // Se for POST em /api/brancas sem action, default para sync
  if (req.method === 'POST') {
    return syncHandler(req, res);
  }

  // Se for GET em /api/brancas sem action, default para relatorio
  if (req.method === 'GET') {
    return relatorioHandler(req, res);
  }

  return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em /api/brancas');
}
