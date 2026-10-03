export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** CORS for browser callers. Auth is a bearer token (no cookies), so `*` is the fallback when
 *  ALLOWED_ORIGINS is unset; production should set ALLOWED_ORIGINS to the Vercel/app origin(s). */
export function corsHeaders(req: Request, allowedOrigins: string | undefined): Record<string, string> {
  const base = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
  const list = (allowedOrigins ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (list.length === 0) return { ...base, 'Access-Control-Allow-Origin': '*' };
  const origin = req.headers.get('origin') ?? '';
  return list.includes(origin) ? { ...base, 'Access-Control-Allow-Origin': origin } : base;
}

export function json(body: unknown, status = 200, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...extra },
  });
}
