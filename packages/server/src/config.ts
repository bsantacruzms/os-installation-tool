import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw === undefined ? Number.NaN : Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envList(name: string): string[] {
  return (process.env[name] ?? '')
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v.length > 0);
}

function findWebRoot(): string | null {
  const candidates = [
    resolve(here, '../../web/dist'),
    resolve(here, '../../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
  ];
  return candidates.find((c) => existsSync(c)) ?? null;
}

export const config = {
  port: envInt('OSIT_PORT', 5178),
  host: process.env['OSIT_HOST'] ?? '127.0.0.1',
  /** Extra browser origins allowed to call the API, on top of localhost. */
  allowedOrigins: envList('OSIT_ALLOWED_ORIGINS'),
  /** Serves the built single page app when it is present. */
  webRoot: findWebRoot(),
  /** How long a resolved Microsoft link is reused before asking again. */
  isoCacheTtlMs: envInt('OSIT_ISO_CACHE_MINUTES', 30) * 60_000,
  languageCacheTtlMs: envInt('OSIT_LANGUAGE_CACHE_MINUTES', 720) * 60_000,
};

export function isLocalOrigin(origin: string): boolean {
  try {
    const { hostname } = new URL(origin);
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1';
  } catch {
    return false;
  }
}
