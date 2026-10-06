type Entry = { count: number; resetAt: number };
const buckets = new Map<string, Entry>();

export function enforceRateLimit(req: any, res: any, scope: string, limit: number, windowMs: number): boolean {
  const forwarded = String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  const address = forwarded || req.socket?.remoteAddress || 'unknown';
  const key = `${scope}:${address}`;
  const now = Date.now();
  const current = buckets.get(key);
  const entry = !current || current.resetAt <= now ? { count: 0, resetAt: now + windowMs } : current;
  entry.count += 1;
  buckets.set(key, entry);
  res.setHeader?.('RateLimit-Limit', String(limit));
  res.setHeader?.('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
  if (entry.count <= limit) return true;
  res.setHeader?.('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
  res.status?.(429).json?.({ ok: false, error: { code: 'RATE_LIMITED', message: 'Muitas tentativas. Aguarde e tente novamente.' } });
  return false;
}
