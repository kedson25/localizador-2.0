import { dispatchApiRoute } from './_lib/router';
import { sendSuccess } from './_lib/response';

export default async function handler(req: any, res: any) {
  const urlPath = (req.url || '').split('?')[0].replace(/\/+$/, '');
  if (!urlPath || urlPath === '/api' || urlPath === '/api/health') {
    return sendSuccess(res, {
      status: 'healthy',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  }
  return dispatchApiRoute(req, res);
}
