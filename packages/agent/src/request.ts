import type { BuildPlan, CreateUsbRequest, FileEncoding, InjectedFile, RemovedPath } from '../../shared/src/types.js';

export class RequestValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new RequestValidationError('Expected a JSON object.');
  return value as Record<string, unknown>;
}

function requiredString(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new RequestValidationError(`"${field}" is required.`);
  }
  if (value.length > maxLength) throw new RequestValidationError(`"${field}" is too long.`);
  return value;
}

/** Blocks loopback and RFC1918 literals so the agent cannot be aimed inwards. */
function assertPublicHttpsUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new RequestValidationError('The ISO URL is not a valid URL.');
  }
  if (url.protocol !== 'https:') throw new RequestValidationError('ISO downloads must use https.');

  const host = url.hostname.toLowerCase();
  const blocked =
    host === 'localhost' ||
    host === '::1' ||
    host === '[::1]' ||
    /^127\./.test(host) ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^169\.254\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);
  if (blocked) throw new RequestValidationError('The ISO URL points at a private address, which is not allowed.');
  return url.toString();
}

function parseInjectedFile(value: unknown, index: number): InjectedFile {
  const raw = record(value);
  const encoding = raw['encoding'];
  if (encoding !== 'utf8' && encoding !== 'utf16le') {
    throw new RequestValidationError(`injectedFiles[${index}].encoding must be utf8 or utf16le.`);
  }
  const content = raw['content'];
  if (typeof content !== 'string') throw new RequestValidationError(`injectedFiles[${index}].content must be a string.`);
  if (content.length > 4 * 1024 * 1024) throw new RequestValidationError(`injectedFiles[${index}] is too large.`);

  return {
    path: requiredString(raw['path'], `injectedFiles[${index}].path`, 400),
    content,
    encoding: encoding as FileEncoding,
    purpose: typeof raw['purpose'] === 'string' ? raw['purpose'].slice(0, 300) : '',
  };
}

function parseRemovedPath(value: unknown, index: number): RemovedPath {
  const raw = record(value);
  return {
    path: requiredString(raw['path'], `removedPaths[${index}].path`, 400),
    purpose: typeof raw['purpose'] === 'string' ? raw['purpose'].slice(0, 300) : '',
  };
}

function parsePlan(value: unknown): BuildPlan {
  const raw = record(value);
  const injected = Array.isArray(raw['injectedFiles']) ? raw['injectedFiles'] : [];
  const removed = Array.isArray(raw['removedPaths']) ? raw['removedPaths'] : [];
  if (injected.length > 200) throw new RequestValidationError('The plan contains too many files.');

  const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').slice(0, 100).map((v) => v.slice(0, 500)) : [];

  return {
    injectedFiles: injected.map(parseInjectedFile),
    removedPaths: removed.map(parseRemovedPath),
    summary: strings(raw['summary']),
    bootSteps: strings(raw['bootSteps']),
    warnings: strings(raw['warnings']),
  };
}

export function parseCreateUsbRequest(body: unknown): CreateUsbRequest {
  const raw = record(body);
  const iso = record(raw['iso']);

  const parsedIso: CreateUsbRequest['iso'] =
    iso['kind'] === 'local'
      ? { kind: 'local', path: requiredString(iso['path'], 'iso.path', 4096) }
      : {
          kind: 'url',
          url: assertPublicHttpsUrl(requiredString(iso['url'], 'iso.url', 4096)),
          fileName: sanitizeFileName(requiredString(iso['fileName'], 'iso.fileName', 200)),
          ...(typeof iso['sizeBytes'] === 'number' ? { sizeBytes: iso['sizeBytes'] } : {}),
          ...(typeof iso['sha256'] === 'string' && /^[a-fA-F0-9]{64}$/.test(iso['sha256']) ? { sha256: iso['sha256'] } : {}),
        };

  return {
    deviceId: requiredString(raw['deviceId'], 'deviceId', 512),
    iso: parsedIso,
    plan: parsePlan(raw['plan']),
    volumeLabel: typeof raw['volumeLabel'] === 'string' ? raw['volumeLabel'].slice(0, 32) : 'WIN11',
    // Defaults to on: writing to a non-removable disk must be a deliberate choice.
    requireRemovable: raw['requireRemovable'] !== false,
  };
}

/** Keeps a server supplied name from escaping the download directory. */
export function sanitizeFileName(name: string): string {
  const base = name.replace(/[\\/]/g, '').replace(/[^A-Za-z0-9._-]/g, '_');
  const trimmed = base.replace(/^\.+/, '');
  return trimmed.length > 0 ? trimmed.slice(0, 150) : 'image.iso';
}
