export default async function handler(_req: any, res: any) {
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(200).json({ ok: true, service: 'localizador-api', timestamp: new Date().toISOString() });
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ ok: true, service: 'localizador-api', timestamp: new Date().toISOString() }));
}
