import { randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * The agent can erase disks, so it is not enough to bind to localhost: any page
 * in any browser can reach localhost. Every request must carry a pairing code
 * that only someone looking at the agent's own console can know.
 */
export function generatePairingCode(): string {
  // Crockford-ish alphabet: no 0/O or 1/I to misread aloud.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(12);
  let code = '';
  for (let i = 0; i < bytes.length; i++) {
    if (i > 0 && i % 4 === 0) code += '-';
    code += alphabet[(bytes[i] as number) % alphabet.length];
  }
  return code;
}

export function normalizeCode(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function codesMatch(expected: string, provided: string | undefined | null): boolean {
  if (typeof provided !== 'string') return false;
  const a = Buffer.from(normalizeCode(expected));
  const b = Buffer.from(normalizeCode(provided));
  if (a.length === 0 || a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * The official site is pinned here so the hosted build can drive a local agent.
 * It is an allowlist of one exact origin, and the pairing code is still
 * required on top of it: reaching the agent is not the same as controlling it.
 */
export const OFFICIAL_ORIGINS = ['https://os.brionicx.com'];

/**
 * Only localhost pages and the official site may drive the agent. A malicious
 * site cannot read cross-origin responses anyway, but this stops it issuing
 * writes at all.
 */
export function isAllowedOrigin(origin: string | undefined, extraOrigins: string[] = []): boolean {
  if (!origin) return true; // curl, the CLI and same-process callers send none.
  if (OFFICIAL_ORIGINS.includes(origin) || extraOrigins.includes(origin)) return true;
  try {
    const { hostname, protocol } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') return false;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
  } catch {
    return false;
  }
}
