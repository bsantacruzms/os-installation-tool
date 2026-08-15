import type { Arch } from '../types.js';

/**
 * Microsoft has no documented ISO API. The software-download site drives a
 * private JSON connector, and this module speaks that same protocol so the ISO
 * is fetched from Microsoft directly. Nothing is mirrored or repackaged.
 *
 * This is the one piece of the tool that cannot run in a browser: the endpoints
 * send no CORS headers, and the handshake needs headers a page may not set. It
 * runs in the local agent, which also means the requests come from the user's
 * own connection rather than a data centre Microsoft is likely to block.
 *
 * The parsing helpers are pure so they can be tested without touching the
 * network; `resolveWindowsIso` is the only function that makes requests.
 */

const PRODUCT_PAGE = 'https://www.microsoft.com/en-us/software-download/windows11';
/** Referer the connector insists on for the final link call. */
const LINK_REFERER = 'https://www.microsoft.com/software-download/windows11';
const SESSION_URL = 'https://vlscppe.microsoft.com/tags';
const OVDF_ORIGIN = 'https://ov-df.microsoft.com';
const CONNECTOR = 'https://www.microsoft.com/software-download-connector/api';
/** Constants the download page sends with every connector call. */
const PROFILE = '606624d44113';
const ORG_ID = 'y6jn8c31';
const INSTANCE_ID = '560dc9f3-1aa5-4a2f-b63c-9e18f8d0e175';

/**
 * Product edition ids used if the page markup changes. Microsoft treats ARM64
 * as a separate product rather than an architecture of the same one.
 */
const FALLBACK_EDITION_IDS: Record<Arch, string> = { x64: '3321', arm64: '3324' };

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

export interface ProductEditionOption {
  id: string;
  label: string;
}

export interface SkuOption {
  id: string;
  language: string;
  localizedLanguage: string;
}

export interface DownloadOption {
  uri: string;
  fileName: string;
  arch: Arch | 'unknown';
  sizeBytes?: number;
}

export class MicrosoftResolveError extends Error {
  readonly code: string;
  readonly hint: string;

  constructor(code: string, message: string, hint: string) {
    super(message);
    this.name = 'MicrosoftResolveError';
    this.code = code;
    this.hint = hint;
  }
}

/* ------------------------------------------------------------------ *
 * Pure parsing
 * ------------------------------------------------------------------ */

export function parseProductEditionOptions(html: string): ProductEditionOption[] {
  const options: ProductEditionOption[] = [];
  const re = /<option\s+[^>]*value="(\d{3,6})"[^>]*>([^<]+)<\/option>/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(html)) !== null) {
    const id = match[1];
    const label = match[2];
    if (!id || !label) continue;
    const clean = label.replace(/\s+/g, ' ').trim();
    if (clean.length === 0) continue;
    if (options.some((o) => o.id === id)) continue;
    options.push({ id, label: clean });
  }
  return options;
}

export function pickProductEdition(options: ProductEditionOption[], arch: Arch): ProductEditionOption | undefined {
  const wanted = arch === 'arm64' ? /arm\s*64/i : /\bx64\b|64-bit/i;
  const windows11 = options.filter((o) => /windows\s*11/i.test(o.label));
  const pool = windows11.length > 0 ? windows11 : options;
  return pool.find((o) => wanted.test(o.label));
}

/** DownloadType is Microsoft's own architecture code: 0 = x86, 1 = x64, 2 = ARM64. */
export function archFromDownloadType(type: unknown): Arch | 'unknown' {
  if (type === 1) return 'x64';
  if (type === 2) return 'arm64';
  return 'unknown';
}

interface ConnectorErrorEnvelope {
  Errors?: Array<{ Type?: number; Value?: string }>;
}

function connectorErrors(payload: ConnectorErrorEnvelope): string[] {
  return (payload?.Errors ?? []).map((e) => e.Value ?? `error ${e.Type ?? 'unknown'}`).filter((v) => v.length > 0);
}

function asRecord(payload: unknown): Record<string, unknown> {
  return typeof payload === 'object' && payload !== null ? (payload as Record<string, unknown>) : {};
}

export function parseSkus(payload: unknown): SkuOption[] {
  const raw = asRecord(payload)['Skus'];
  const skus = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  return skus
    .map((sku) => ({
      id: String(sku['Id'] ?? ''),
      language: String(sku['Language'] ?? ''),
      localizedLanguage: String(sku['LocalizedLanguage'] ?? sku['Language'] ?? ''),
    }))
    .filter((s) => s.id.length > 0);
}

/** Microsoft names languages like `English (United States)`; we match loosely. */
export function pickSku(skus: SkuOption[], microsoftLanguageName: string): SkuOption | undefined {
  const target = microsoftLanguageName.trim().toLowerCase();
  return (
    skus.find((s) => s.language.toLowerCase() === target) ??
    skus.find((s) => s.localizedLanguage.toLowerCase() === target) ??
    skus.find((s) => s.language.toLowerCase().startsWith(target)) ??
    skus.find((s) => s.language.toLowerCase().includes(target))
  );
}

export function fileNameFromUrl(url: string): string {
  try {
    const path = new URL(url).pathname;
    const last = path.split('/').filter(Boolean).pop();
    return last && last.length > 0 ? decodeURIComponent(last) : 'windows.iso';
  } catch {
    return 'windows.iso';
  }
}

export function archFromFileName(fileName: string): Arch | 'unknown' {
  if (/arm64/i.test(fileName)) return 'arm64';
  if (/x64/i.test(fileName)) return 'x64';
  return 'unknown';
}

export function parseDownloadOptions(payload: unknown): DownloadOption[] {
  const raw = asRecord(payload)['ProductDownloadOptions'];
  const list = Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : [];
  return list
    .map((entry) => {
      const uri = String(entry['Uri'] ?? '');
      const fileName = fileNameFromUrl(uri);
      const byType = archFromDownloadType(entry['DownloadType']);
      return { uri, fileName, arch: byType === 'unknown' ? archFromFileName(fileName) : byType };
    })
    .filter((o) => o.uri.startsWith('https://'));
}

export function pickDownloadOption(options: DownloadOption[], arch: Arch): DownloadOption | undefined {
  return options.find((o) => o.arch === arch) ?? (options.length === 1 ? options[0] : undefined);
}

/* ------------------------------------------------------------------ *
 * Network
 * ------------------------------------------------------------------ */

async function fetchText(url: string, init: RequestInit = {}, timeoutMs = 20_000): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'Accept-Language': 'en-US,en;q=0.9',
        ...(init.headers ?? {}),
      },
    });
    if (!response.ok) {
      throw new MicrosoftResolveError(
        'http-error',
        `Microsoft returned HTTP ${response.status} for ${new URL(url).pathname}.`,
        'This usually clears up on its own. Try again in a minute, or download the ISO manually and use "Use my own ISO".',
      );
    }
    return await response.text();
  } catch (error) {
    if (error instanceof MicrosoftResolveError) throw error;
    if (error instanceof Error && error.name === 'AbortError') {
      throw new MicrosoftResolveError('timeout', 'Microsoft did not respond in time.', 'Check your internet connection and try again.');
    }
    throw new MicrosoftResolveError(
      'network',
      `Could not reach Microsoft: ${error instanceof Error ? error.message : String(error)}`,
      'Check your internet connection, or download the ISO manually and use "Use my own ISO".',
    );
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson<T>(url: string, referer: string): Promise<T> {
  const text = await fetchText(url, { headers: { Referer: referer, Accept: 'application/json, text/plain, */*' } });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new MicrosoftResolveError(
      'bad-response',
      'Microsoft returned something that was not JSON.',
      'Microsoft blocks automated downloads from data centre IP ranges. Run the server on a normal connection, or use "Use my own ISO".',
    );
  }
}

export interface ResolvedIso {
  url: string;
  fileName: string;
  arch: Arch;
  language: string;
  expiresAt: string;
  sizeBytes?: number;
}

export interface ResolveOptions {
  arch: Arch;
  /** Microsoft's own language name, e.g. `English (United States)`. */
  microsoftLanguageName: string;
  /** Injected in tests. */
  sessionId?: string;
}

/** Microsoft download links stop working after roughly 24 hours. */
const LINK_LIFETIME_MS = 24 * 60 * 60 * 1000;

export interface OvdfChallenge {
  w: string;
  rticks: string;
}

/** `mdt.js` is a script whose body carries the two values the reply must echo. */
export function parseOvdfChallenge(script: string): OvdfChallenge | null {
  const w = /[?&]w=([A-Fa-f0-9]+)/.exec(script)?.[1];
  const rticks = /rticks\s*=\s*"\+?(\d+)/.exec(script)?.[1] ?? /rticks["'=\s]+(\d+)/.exec(script)?.[1];
  return w && rticks ? { w, rticks } : null;
}

/**
 * Microsoft gates the connector behind a session that must be registered with
 * two separate fingerprinting services first. Skipping either one makes the
 * final call come back as "Sentinel marked this request as rejected".
 */
async function registerSession(sessionId: string): Promise<void> {
  await fetchText(`${SESSION_URL}?org_id=${ORG_ID}&session_id=${sessionId}`, { headers: { Referer: PRODUCT_PAGE } });

  const script = await fetchText(
    `${OVDF_ORIGIN}/mdt.js?instanceId=${INSTANCE_ID}&PageId=si&session_id=${sessionId}`,
    { headers: { Referer: PRODUCT_PAGE } },
  );
  const challenge = parseOvdfChallenge(script);
  if (!challenge) {
    throw new MicrosoftResolveError(
      'challenge',
      'Microsoft changed its anti-automation challenge and it could not be answered.',
      'Download the ISO manually from Microsoft and use "Use my own ISO".',
    );
  }

  await fetchText(
    `${OVDF_ORIGIN}/?session_id=${sessionId}&CustomerId=${INSTANCE_ID}&PageId=si` +
      `&w=${challenge.w}&mdt=${Date.now()}&rticks=${challenge.rticks}`,
    { headers: { Referer: PRODUCT_PAGE } },
  );
}

async function productEditionId(arch: Arch): Promise<string> {
  try {
    const html = await fetchText(PRODUCT_PAGE);
    const edition = pickProductEdition(parseProductEditionOptions(html), arch);
    if (edition) return edition.id;
  } catch {
    // Fall through to the known ids rather than failing outright.
  }
  const fallback = FALLBACK_EDITION_IDS[arch];
  if (!fallback) {
    throw new MicrosoftResolveError(
      'no-edition',
      `Microsoft's download page did not offer a Windows 11 ${arch} image.`,
      'Microsoft may have changed the page layout. Use "Use my own ISO" until this is updated.',
    );
  }
  return fallback;
}

async function fetchSkus(editionId: string, sessionId: string): Promise<SkuOption[]> {
  const payload = await fetchJson<ConnectorErrorEnvelope>(
    `${CONNECTOR}/getskuinformationbyproductedition?profile=${PROFILE}&productEditionId=${editionId}` +
      `&SKU=undefined&friendlyFileName=undefined&Locale=en-US&sessionID=${sessionId}`,
    PRODUCT_PAGE,
  );
  const errors = connectorErrors(payload);
  if (errors.length > 0) throw blocked(errors);
  return parseSkus(payload);
}

export async function resolveWindowsIso(options: ResolveOptions): Promise<ResolvedIso> {
  // Microsoft ties a session to the last SKU list it served, so each
  // architecture needs its own freshly registered session.
  const sessionId = options.sessionId ?? crypto.randomUUID();
  const editionId = await productEditionId(options.arch);

  await registerSession(sessionId);

  const skus = await fetchSkus(editionId, sessionId);
  const sku = pickSku(skus, options.microsoftLanguageName);
  if (!sku) {
    throw new MicrosoftResolveError(
      'no-language',
      `Microsoft does not offer a Windows 11 ISO in "${options.microsoftLanguageName}".`,
      `Available languages: ${skus.map((s) => s.language).join(', ') || 'none returned'}.`,
    );
  }

  const linkPayload = await fetchJson<ConnectorErrorEnvelope>(
    `${CONNECTOR}/GetProductDownloadLinksBySku?profile=${PROFILE}&productEditionId=undefined` +
      `&SKU=${encodeURIComponent(sku.id)}&friendlyFileName=undefined&Locale=en-US&sessionID=${sessionId}`,
    LINK_REFERER,
  );
  const linkErrors = connectorErrors(linkPayload);
  if (linkErrors.length > 0) throw blocked(linkErrors);

  const downloads = parseDownloadOptions(linkPayload);
  const download = pickDownloadOption(downloads, options.arch);
  if (!download) {
    throw new MicrosoftResolveError(
      'no-download',
      'Microsoft returned no usable download link.',
      'Try again in a few minutes, or use "Use my own ISO".',
    );
  }

  return {
    url: download.uri,
    fileName: download.fileName,
    arch: options.arch,
    language: sku.language,
    expiresAt: new Date(Date.now() + LINK_LIFETIME_MS).toISOString(),
  };
}

function blocked(errors: string[]): MicrosoftResolveError {
  return new MicrosoftResolveError(
    'blocked',
    `Microsoft refused the request: ${errors.join('; ')}`,
    'Microsoft rate limits this endpoint and blocks data centre IP ranges. Wait a few minutes and retry, or download the ISO manually and use "Use my own ISO".',
  );
}

/** Language list for a given architecture, used to populate the Advanced tab. */
export async function listWindowsLanguages(arch: Arch, sessionId = crypto.randomUUID()): Promise<SkuOption[]> {
  const editionId = await productEditionId(arch);
  await registerSession(sessionId);
  return fetchSkus(editionId, sessionId);
}
