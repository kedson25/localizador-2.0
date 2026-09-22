export default async function handler(req: any, res: any) {
  const payload = {
    ok: true,
    data: {
      diagnostic: true,
      service: 'brancas-relatorio',
      spreadsheetId: '1hvYeyeXA7RkAX1YoGej6WGBcW1xuUMACyvRLNTJEX6Y',
      sheetBrancas: 'ext_brancas',
      sheetRotas: 'ext_rotas',
      timestamp: new Date().toISOString(),
    },
  };

  res.setHeader?.('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader?.('Content-Type', 'application/json; charset=utf-8');

  if (typeof res.status === 'function' && typeof res.json === 'function') {
    return res.status(200).json(payload);
  }

  res.statusCode = 200;
  return res.end(JSON.stringify(payload));
}
