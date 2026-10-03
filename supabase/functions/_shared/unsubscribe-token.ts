// Signed unsubscribe tokens:  base64url(payload) . base64url(HMAC_SHA256(base64url(payload), secret))
// The payload is NOT trusted until the signature has been verified.
import { fromBase64Url, hmacSha256, timingSafeEqualBytes, toBase64Url } from './crypto.ts';
import { PREFERENCE_BY_TYPE } from './preferences.ts';

export interface UnsubscribePayload {
  memberId: string;
  notifType: string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export async function signUnsubscribeToken(payload: UnsubscribePayload, secret: string): Promise<string> {
  if (!secret) throw new Error('UNSUBSCRIBE_SECRET is not configured');
  if (!UUID_RE.test(payload.memberId)) throw new Error('Invalid memberId');
  if (!(payload.notifType in PREFERENCE_BY_TYPE)) throw new Error('Invalid notification type');
  const body = toBase64Url(encoder.encode(JSON.stringify({ m: payload.memberId, t: payload.notifType, v: 1 })));
  const sig = toBase64Url(await hmacSha256(body, secret));
  return `${body}.${sig}`;
}

/** Returns the payload only if the signature is valid; otherwise null. Never throws. */
export async function verifyUnsubscribeToken(token: string, secret: string): Promise<UnsubscribePayload | null> {
  try {
    if (!secret || typeof token !== 'string' || token.length > 2048) return null;
    const parts = token.split('.');
    if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
    const [body, sig] = parts;
    const given = fromBase64Url(sig);
    if (!given) return null;
    const expected = await hmacSha256(body, secret);
    if (!timingSafeEqualBytes(given, expected)) return null;
    const raw = fromBase64Url(body);
    if (!raw) return null;
    const parsed = JSON.parse(decoder.decode(raw)) as { m?: unknown; t?: unknown; v?: unknown };
    if (parsed.v !== 1 || typeof parsed.m !== 'string' || typeof parsed.t !== 'string') return null;
    if (!UUID_RE.test(parsed.m) || !(parsed.t in PREFERENCE_BY_TYPE)) return null;
    return { memberId: parsed.m, notifType: parsed.t };
  } catch {
    return null;
  }
}
