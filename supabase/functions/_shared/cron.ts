// Machine-to-machine authentication for scheduler-invoked functions.
// The caller must send the shared secret in the `x-cron-secret` header.
import { timingSafeEqualStrings } from './crypto.ts';

export const CRON_HEADER = 'x-cron-secret';

export type CronAuthResult = 'ok' | 'unauthorized' | 'not_configured';

export async function checkCronSecret(req: Request, secret: string | undefined): Promise<CronAuthResult> {
  if (!secret || secret.length < 16) return 'not_configured'; // fail closed
  const provided = req.headers.get(CRON_HEADER);
  if (!provided) return 'unauthorized';
  return (await timingSafeEqualStrings(provided, secret)) ? 'ok' : 'unauthorized';
}
