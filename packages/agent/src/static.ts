import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

import { embeddedWeb } from './generated/web-assets.js';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

function contentType(path: string): string {
  return TYPES[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

function headers(path: string): Record<string, string> {
  return {
    'Content-Type': contentType(path),
    // Asset names carry a content hash; index.html must never be cached.
    'Cache-Control': path.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  };
}

export const hasEmbeddedWeb = Object.keys(embeddedWeb).length > 0;

/** A build sitting next to the agent wins, so `npm run dev` shows live edits. */
export function findWebRoot(hereDir: string): string | null {
  const candidates = [
    join(hereDir, 'web'),
    resolve(hereDir, '../../web/dist'),
    resolve(hereDir, '../../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? null;
}

function serveEmbedded(urlPath: string, response: ServerResponse): boolean {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const key = requested in embeddedWeb ? requested : '/index.html';
  const body = embeddedWeb[key];
  if (!body) return false;
  const buffer = Buffer.from(body, 'base64');
  response.writeHead(200, { ...headers(key), 'Content-Length': buffer.length });
  response.end(buffer);
  return true;
}

/**
 * Serves the interface so the tool still works when a browser refuses to let an
 * https page talk to a plain http agent, and when there is no internet at all.
 * Falls back to the copy compiled into the binary.
 */
export function serveStatic(root: string | null, urlPath: string, response: ServerResponse): boolean {
  if (root) {
    const requested = urlPath === '/' ? '/index.html' : urlPath;
    const target = resolve(root, `.${normalize(requested)}`);
    const withinRoot = target === resolve(root) || target.startsWith(resolve(root) + sep);

    const file = withinRoot && existsSync(target) && statSync(target).isFile() ? target : join(root, 'index.html');
    if (existsSync(file)) {
      response.writeHead(200, headers(file));
      createReadStream(file).pipe(response);
      return true;
    }
  }
  return serveEmbedded(urlPath, response);
}
