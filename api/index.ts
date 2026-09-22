import { sendSuccess } from './_lib/response';

export default async function handler(req: any, res: any) {
  return sendSuccess(res, {
    ok: true,
    service: 'localizador-api',
    status: 'healthy',
    timestamp: new Date().toISOString(),
  });
}
