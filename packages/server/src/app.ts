import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance } from 'fastify';

import { commonLanguages, findLanguage, windowsImageVariants } from '../../shared/src/windows/catalog.js';
import { defaultWindowsConfig, defaultDebloatPackages } from '../../shared/src/windows/defaults.js';
import { windowsEditions } from '../../shared/src/windows/editions.js';
import { normalizeWindowsConfig } from '../../shared/src/windows/normalize.js';
import { buildWindowsPlan } from '../../shared/src/windows/plan.js';
import { privacyTweaks } from '../../shared/src/windows/privacy.js';
import { hasErrors, validateWindowsConfig } from '../../shared/src/windows/validate.js';
import type { Arch } from '../../shared/src/types.js';

import { TtlCache } from '../../shared/src/cache.js';
import { config, isLocalOrigin } from './config.js';
import {
  listWindowsLanguages,
  MicrosoftResolveError,
  resolveWindowsIso,
  type ResolvedIso,
  type SkuOption,
} from '../../shared/src/windows/microsoft.js';

const isoCache = new TtlCache<ResolvedIso>(config.isoCacheTtlMs);
const languageCache = new TtlCache<SkuOption[]>(config.languageCacheTtlMs);

function parseArch(value: unknown): Arch {
  return value === 'arm64' ? 'arm64' : 'x64';
}

export interface AppOptions {
  /** Tests pass false to keep the output readable. */
  logger?: boolean;
}

export async function createApp(options: AppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: options.logger === false ? false : { level: process.env['OSIT_LOG_LEVEL'] ?? 'info' },
    bodyLimit: 512 * 1024,
    trustProxy: false,
  });

  await app.register(cors, {
    origin(origin, callback) {
      // Same-origin and non-browser callers send no Origin header.
      if (!origin) return callback(null, true);
      if (isLocalOrigin(origin) || config.allowedOrigins.includes(origin)) return callback(null, true);
      callback(new Error('Origin not allowed'), false);
    },
    methods: ['GET', 'POST'],
  });

  app.get('/api/health', async () => ({ ok: true, version: '0.1.0' }));

  app.get('/api/catalog', async () => ({
    images: windowsImageVariants,
    editions: windowsEditions,
    privacyTweaks,
    languages: commonLanguages,
    defaultPackages: defaultDebloatPackages,
    defaults: {
      easy: defaultWindowsConfig('easy'),
      advanced: defaultWindowsConfig('advanced'),
    },
  }));

  app.get('/api/windows/languages', async (request, reply) => {
    const arch = parseArch((request.query as Record<string, unknown>)['arch']);
    try {
      const skus = await languageCache.wrap(arch, () => listWindowsLanguages(arch));
      return { arch, languages: skus.map((s) => ({ name: s.language, localized: s.localizedLanguage })) };
    } catch (error) {
      return replyResolveError(reply, error, { arch, languages: commonLanguages.map((l) => ({ name: l.microsoftName, localized: l.label })) });
    }
  });

  app.post('/api/windows/resolve', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const arch = parseArch(body['arch']);
    const languageTag = typeof body['language'] === 'string' ? body['language'] : 'en-US';
    const microsoftLanguageName =
      typeof body['microsoftLanguageName'] === 'string' && body['microsoftLanguageName'].length > 0
        ? body['microsoftLanguageName']
        : (findLanguage(languageTag)?.microsoftName ?? 'English');

    try {
      const resolved = await isoCache.wrap(`${arch}|${microsoftLanguageName}`, () =>
        resolveWindowsIso({ arch, microsoftLanguageName }),
      );
      return {
        variantId: 'win11-consumer',
        arch: resolved.arch,
        language: languageTag,
        url: resolved.url,
        fileName: resolved.fileName,
        expiresAt: resolved.expiresAt,
        editions: windowsEditions.filter((e) => e.availableIn.includes('win11-consumer')).map((e) => e.id),
      };
    } catch (error) {
      return replyResolveError(reply, error);
    }
  });

  app.post('/api/windows/plan', async (request) => {
    const normalized = normalizeWindowsConfig(request.body);
    const issues = validateWindowsConfig(normalized);
    return {
      config: normalized,
      issues,
      valid: !hasErrors(issues),
      plan: hasErrors(issues) ? null : buildWindowsPlan(normalized),
    };
  });

  if (config.webRoot) {
    await app.register(fastifyStatic, { root: config.webRoot, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Not found' });
      return reply.sendFile('index.html');
    });
  }

  return app;
}

function replyResolveError(reply: { code: (n: number) => { send: (body: unknown) => unknown } }, error: unknown, extra: object = {}) {
  if (error instanceof MicrosoftResolveError) {
    return reply.code(502).send({
      error: error.message,
      code: error.code,
      hint: error.hint,
      fallbackUrl: 'https://www.microsoft.com/software-download/windows11',
      ...extra,
    });
  }
  return reply.code(500).send({
    error: 'Unexpected failure while talking to Microsoft.',
    code: 'internal',
    hint: 'Check the server log for details.',
    ...extra,
  });
}
