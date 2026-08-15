import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

import type { AgentInfo, JobProgress } from '../../shared/src/types.js';
import { TtlCache } from '../../shared/src/cache.js';
import { findLanguage } from '../../shared/src/windows/catalog.js';
import {
  MicrosoftResolveError,
  resolveWindowsIso,
  type ResolvedIso,
} from '../../shared/src/windows/microsoft.js';
import { listDevices } from './devices/index.js';
import { JobManager } from './jobs.js';
import { commandExists } from './process.js';
import { parseCreateUsbRequest, RequestValidationError } from './request.js';
import { codesMatch, isAllowedOrigin } from './security.js';
import { serveStatic } from './static.js';
import { createPlatform } from './usb/writer.js';

export interface AgentServerOptions {
  host: string;
  port: number;
  pairingCode: string;
  workDirectory: string;
  version: string;
  extraOrigins?: string[];
  /** Directory holding the built web app, when one was shipped alongside. */
  webRoot?: string | null;
}

const MAX_BODY_BYTES = 4 * 1024 * 1024;

/** Microsoft rate limits hard, so a resolved link is reused for a while. */
const isoCache = new TtlCache<ResolvedIso>(30 * 60_000);

function json(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(payload);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new RequestValidationError('Request body is too large.');
    chunks.push(chunk as Buffer);
  }
  if (size === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createAgentServer(options: AgentServerOptions) {
  const jobs = new JobManager(options.workDirectory);
  const sockets = new Set<WebSocket>();

  const authorized = (request: IncomingMessage, url: URL): boolean => {
    const header = request.headers['authorization'];
    const bearer = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
    const token = bearer ?? url.searchParams.get('code') ?? undefined;
    return codesMatch(options.pairingCode, token);
  };

  const server = createServer((request, response) => {
    void handle(request, response);
  });

  async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const origin = request.headers.origin;
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

    if (!isAllowedOrigin(origin, options.extraOrigins ?? [])) {
      json(response, 403, { error: 'This page is not allowed to control the agent.' });
      return;
    }

    if (origin) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
      response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
      response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    // Unauthenticated so the web app can tell whether an agent is running at all.
    if (url.pathname === '/agent/ping') {
      json(response, 200, { agent: 'osit', version: options.version, platform: process.platform });
      return;
    }

    if (!authorized(request, url)) {
      if (options.webRoot && !url.pathname.startsWith('/agent/') && request.method === 'GET') {
        serveStatic(options.webRoot, url.pathname, response);
        return;
      }
      json(response, 401, { error: 'Enter the pairing code shown in the agent window.' });
      return;
    }

    try {
      if (request.method === 'GET' && url.pathname === '/agent/info') {
        json(response, 200, await describeAgent(options.version));
        return;
      }
      if (request.method === 'GET' && url.pathname === '/agent/devices') {
        json(response, 200, { devices: await listDevices() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/agent/resolve-iso') {
        const body = ((await readJsonBody(request)) ?? {}) as Record<string, unknown>;
        const arch = body['arch'] === 'arm64' ? 'arm64' : 'x64';
        const languageTag = typeof body['language'] === 'string' ? body['language'] : 'en-US';
        const microsoftLanguageName =
          typeof body['microsoftLanguageName'] === 'string' && body['microsoftLanguageName'].length > 0
            ? body['microsoftLanguageName']
            : (findLanguage(languageTag)?.microsoftName ?? 'English');
        try {
          const resolved = await isoCache.wrap(`${arch}|${microsoftLanguageName}`, () =>
            resolveWindowsIso({ arch, microsoftLanguageName }),
          );
          json(response, 200, { ...resolved, language: languageTag });
        } catch (error) {
          if (error instanceof MicrosoftResolveError) {
            json(response, 502, {
              error: error.message,
              code: error.code,
              hint: error.hint,
              fallbackUrl: 'https://www.microsoft.com/software-download/windows11',
            });
            return;
          }
          throw error;
        }
        return;
      }
      if (request.method === 'GET' && url.pathname === '/agent/jobs') {
        json(response, 200, { jobs: jobs.list() });
        return;
      }
      if (request.method === 'POST' && url.pathname === '/agent/jobs') {
        const parsed = parseCreateUsbRequest(await readJsonBody(request));
        const job = jobs.start(parsed);
        json(response, 202, { jobId: job.id, progress: job.progress });
        return;
      }

      const jobMatch = /^\/agent\/jobs\/([0-9a-f-]{36})(\/cancel)?$/.exec(url.pathname);
      if (jobMatch) {
        const job = jobs.get(jobMatch[1] as string);
        if (!job) {
          json(response, 404, { error: 'No such job.' });
          return;
        }
        if (jobMatch[2] === '/cancel' && request.method === 'POST') {
          json(response, 200, { cancelled: jobs.cancel(job.id) });
          return;
        }
        json(response, 200, { progress: job.progress, log: job.log.slice(-200) });
        return;
      }

      if (options.webRoot && request.method === 'GET' && !url.pathname.startsWith('/agent/')) {
        serveStatic(options.webRoot, url.pathname, response);
        return;
      }

      json(response, 404, { error: 'Not found.' });
    } catch (error) {
      if (error instanceof RequestValidationError) {
        json(response, 400, { error: error.message });
        return;
      }
      json(response, 500, { error: error instanceof Error ? error.message : 'Unexpected agent error.' });
    }
  }

  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    if (url.pathname !== '/agent/events' || !isAllowedOrigin(request.headers.origin, options.extraOrigins ?? []) || !authorized(request, url)) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      sockets.add(ws);
      ws.on('close', () => sockets.delete(ws));
      ws.send(JSON.stringify({ type: 'hello', jobs: jobs.list() }));
    });
  });

  const broadcast = (message: unknown) => {
    const payload = JSON.stringify(message);
    for (const socket of sockets) {
      if (socket.readyState === socket.OPEN) socket.send(payload);
    }
  };
  jobs.on('progress', (progress: JobProgress) => broadcast({ type: 'progress', progress }));
  jobs.on('log', (entry: { jobId: string; message: string }) => broadcast({ type: 'log', ...entry }));

  return {
    jobs,
    listen: () =>
      new Promise<void>((resolve) => {
        server.listen(options.port, options.host, resolve);
      }),
    close: async () => {
      for (const socket of sockets) socket.close();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

async function describeAgent(version: string): Promise<AgentInfo> {
  const capabilities: Record<string, boolean> = {};
  let elevated = false;

  if (process.platform === 'win32') {
    const { isWindowsElevated } = await import('./usb/windows.js');
    elevated = await isWindowsElevated();
    capabilities['dism'] = await commandExists('dism.exe', ['/?']);
    capabilities['robocopy'] = await commandExists('robocopy.exe', ['/?']);
  } else {
    elevated = process.getuid?.() === 0;
    capabilities['wimlib-imagex'] = await commandExists('wimlib-imagex', ['--version']);
    capabilities['rsync'] = await commandExists('rsync', ['--version']);
  }

  const prerequisites = await createPlatform().checkPrerequisites();

  return {
    version,
    platform: process.platform,
    arch: process.arch,
    elevated,
    capabilities: { ...capabilities, ready: prerequisites.ok },
  };
}
