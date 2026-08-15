import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';

/**
 * Serves packages/web/dist with the exact headers from deploy/nginx/osit.conf,
 * so the Content-Security-Policy can be verified in a real browser before it is
 * put in front of users.
 *
 *   node deploy/check-csp.mjs 8099
 */
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
  "connect-src 'self' http://127.0.0.1:5179 http://localhost:5179 ws://127.0.0.1:5179 ws://localhost:5179; " +
  "frame-ancestors 'none'; base-uri 'self'";

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const root = resolve(process.argv[3] ?? 'packages/web/dist');
const port = Number(process.argv[2] ?? 8099);

createServer((request, response) => {
  const path = (request.url ?? '/').split('?')[0];
  const candidate = resolve(root, `.${path === '/' ? '/index.html' : path}`);
  const file = candidate.startsWith(root) && existsSync(candidate) && statSync(candidate).isFile()
    ? candidate
    : join(root, 'index.html');

  response.writeHead(200, {
    'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
    'Content-Security-Policy': CSP,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
  });
  createReadStream(file).pipe(response);
}).listen(port, '127.0.0.1', () => {
  console.log(`Serving ${root} on http://127.0.0.1:${port} with the production CSP`);
});
