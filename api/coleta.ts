import bipHandler from './_coleta/bip';
import itemHandler from './_coleta/item';
import itemsHandler from './_coleta/items';
import searchHandler from './_coleta/search';
import batchHandler from './_coleta/batch';
import statsHandler from './_coleta/stats';
import normalizeSaidaHandler from './_coleta/normalize-saida';
import { sendError } from './_lib/response';

export default async function handler(req: any, res: any) {
  const { action } = req.query;
  switch (action) {
    case 'bip': return bipHandler(req, res);
    case 'item': return itemHandler(req, res);
    case 'items': return itemsHandler(req, res);
    case 'search': return searchHandler(req, res);
    case 'batch': return batchHandler(req, res);
    case 'stats': return statsHandler(req, res);
    case 'normalize-saida': return normalizeSaidaHandler(req, res);
    default: return sendError(res, 404, 'NOT_FOUND', 'Ação não encontrada em coleta');
  }
}
