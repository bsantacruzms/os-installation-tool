import type { ImageVariant, JobProgress, UsbDevice, WindowsBuildConfig, BuildPlan } from '@shared/types.js';
import { commonLanguages, windowsImageVariants, type LanguageOption } from '@shared/windows/catalog.js';
import { defaultDebloatPackages, defaultWindowsConfig } from '@shared/windows/defaults.js';
import { windowsEditions, type WindowsEdition } from '@shared/windows/editions.js';
import { buildWindowsPlan } from '@shared/windows/plan.js';
import { privacyTweaks, type PrivacyTweak } from '@shared/windows/privacy.js';
import { hasErrors, validateWindowsConfig, type ValidationIssue } from '@shared/windows/validate.js';

export interface Catalog {
  images: ImageVariant[];
  editions: WindowsEdition[];
  privacyTweaks: PrivacyTweak[];
  languages: LanguageOption[];
  defaultPackages: string[];
  defaults: { easy: WindowsBuildConfig; advanced: WindowsBuildConfig };
}

/**
 * Everything except the Microsoft download link is pure logic, so it runs right
 * here in the browser. That keeps the site a plain static bundle, and it means
 * the user name, password and Wi-Fi key never leave the machine.
 */
export function loadCatalog(): Catalog {
  return {
    images: [...windowsImageVariants],
    editions: [...windowsEditions],
    privacyTweaks: [...privacyTweaks],
    languages: [...commonLanguages],
    defaultPackages: [...defaultDebloatPackages],
    defaults: { easy: defaultWindowsConfig('easy'), advanced: defaultWindowsConfig('advanced') },
  };
}

export interface PlanResult {
  issues: ValidationIssue[];
  valid: boolean;
  plan: BuildPlan | null;
}

export function buildPlan(config: WindowsBuildConfig): PlanResult {
  const issues = validateWindowsConfig(config);
  const valid = !hasErrors(issues);
  return { issues, valid, plan: valid ? buildWindowsPlan(config) : null };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
    readonly fallbackUrl?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/* ------------------------------------------------------------------ *
 * Local agent
 * ------------------------------------------------------------------ */

export interface AgentInfoResponse {
  version: string;
  platform: string;
  arch: string;
  elevated: boolean;
  workDirectory: string;
  capabilities: Record<string, boolean>;
}

export interface ResolvedIsoResponse {
  url: string;
  fileName: string;
  arch: string;
  language: string;
  expiresAt: string;
}

export const DEFAULT_AGENT_URL = 'http://127.0.0.1:5179';

/** When the agent is serving this page itself, talk to it on its own origin. */
export function guessAgentUrl(): string {
  if (typeof location !== 'undefined' && location.port === '5179') return location.origin;
  return DEFAULT_AGENT_URL;
}

export class AgentClient {
  constructor(
    readonly baseUrl: string,
    private readonly code: string,
  ) {}

  private async call<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.code}`,
        ...(init?.headers ?? {}),
      },
    });
    const text = await response.text();
    const body: unknown = text.length > 0 ? JSON.parse(text) : {};
    if (!response.ok) {
      const detail = body as { error?: string; hint?: string; fallbackUrl?: string };
      throw new ApiError(detail.error ?? `The agent returned status ${response.status}.`, detail.hint, detail.fallbackUrl);
    }
    return body as T;
  }

  static async ping(baseUrl: string): Promise<{ agent: string; version: string; platform: string }> {
    const response = await fetch(`${baseUrl}/agent/ping`);
    if (!response.ok) throw new ApiError('The agent did not answer.');
    return (await response.json()) as { agent: string; version: string; platform: string };
  }

  info() {
    return this.call<AgentInfoResponse>('/agent/info');
  }

  devices() {
    return this.call<{ devices: UsbDevice[] }>('/agent/devices').then((r) => r.devices);
  }

  /** Runs on the user's own connection, which Microsoft is far less likely to block. */
  resolveIso(arch: string, language: string, microsoftLanguageName: string) {
    return this.call<ResolvedIsoResponse>('/agent/resolve-iso', {
      method: 'POST',
      body: JSON.stringify({ arch, language, microsoftLanguageName }),
    });
  }

  createJob(body: unknown) {
    return this.call<{ jobId: string; progress: JobProgress }>('/agent/jobs', { method: 'POST', body: JSON.stringify(body) });
  }

  cancel(jobId: string) {
    return this.call<{ cancelled: boolean }>(`/agent/jobs/${jobId}/cancel`, { method: 'POST' });
  }

  /** Live progress over server-sent events. Returns a function that stops it. */
  subscribe(onProgress: (progress: JobProgress) => void, onLog: (message: string) => void): () => void {
    const url = `${this.baseUrl}/agent/events?code=${encodeURIComponent(this.code)}`;
    const source = new EventSource(url);
    source.onmessage = (event) => {
      try {
        const message = JSON.parse(String(event.data)) as { type: string; progress?: JobProgress; message?: string };
        if (message.type === 'progress' && message.progress) onProgress(message.progress);
        if (message.type === 'log' && message.message) onLog(message.message);
      } catch {
        // A malformed frame is not worth tearing the UI down for.
      }
    };
    return () => source.close();
  }
}
