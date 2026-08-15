import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { ServerResponse } from 'node:http';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
};

/**
 * Serves the built single page app so the tool still works when the browser
 * refuses to let an https page talk to a plain http agent, and when there is no
 * internet connection at all.
 */
export function findWebRoot(hereDir: string): string | null {
  const candidates = [
    join(hereDir, 'web'),
    resolve(hereDir, '../../web/dist'),
    resolve(hereDir, '../../../web/dist'),
    resolve(process.cwd(), 'packages/web/dist'),
  ];
  return candidates.find((candidate) => existsSync(join(candidate, 'index.html'))) ?? null;
}

export function serveStatic(root: string, urlPath: string, response: ServerResponse): boolean {
  const requested = urlPath === '/' ? '/index.html' : urlPath;
  const target = resolve(root, `.${normalize(requested)}`);
  const withinRoot = target === resolve(root) || target.startsWith(resolve(root) + sep);

  const file = withinRoot && existsSync(target) && statSync(target).isFile() ? target : join(root, 'index.html');
  if (!existsSync(file)) return false;

  response.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': file.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
    'X-Content-Type-Options': 'nosniff',
  });
  createReadStream(file).pipe(response);
  return true;
}
