import type { Arch, EditionSelection, UiMode, WindowsBuildConfig } from '../types.js';
import { defaultWindowsConfig } from './defaults.js';
import { allPrivacyTweakIds } from './privacy.js';

function str(value: unknown, fallback: string, maxLength = 512): string {
  return typeof value === 'string' ? value.slice(0, maxLength) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' ? Math.trunc(value) : Number.NaN;
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

function stringList(value: unknown, maxItems: number, maxLength = 256): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').slice(0, maxItems).map((v) => v.slice(0, maxLength));
}

function edition(value: unknown, fallback: EditionSelection): EditionSelection {
  const raw = record(value);
  if (raw['kind'] === 'preselect' && typeof raw['editionId'] === 'string') {
    return { kind: 'preselect', editionId: raw['editionId'].slice(0, 64) };
  }
  if (raw['kind'] === 'ask-at-install') return { kind: 'ask-at-install' };
  return fallback;
}

/**
 * Coerces untrusted JSON into a complete, bounded configuration. Anything
 * missing or malformed falls back to the safe default rather than throwing, so
 * an older client can never crash the server or produce a half-built plan.
 */
export function normalizeWindowsConfig(input: unknown): WindowsBuildConfig {
  const raw = record(input);
  const base = defaultWindowsConfig(raw['mode'] === 'advanced' ? 'advanced' : 'easy');

  const image = record(raw['image']);
  const account = record(raw['account']);
  const region = record(raw['region']);
  const setup = record(raw['setup']);
  const disk = record(setup['disk']);
  const wifi = record(raw['wifi']);
  const debloat = record(raw['debloat']);

  const arch: Arch = image['arch'] === 'arm64' ? 'arm64' : 'x64';
  const mode: UiMode = base.mode;

  return {
    mode,
    image: {
      variantId: str(image['variantId'], base.image.variantId, 64),
      arch,
      language: str(image['language'], base.image.language, 32),
      edition: edition(image['edition'], base.image.edition),
    },
    account: {
      username: str(account['username'], base.account.username, 64).trim(),
      password: str(account['password'], base.account.password, 256),
      autoLogon: bool(account['autoLogon'], base.account.autoLogon),
      autoLogonCount: int(account['autoLogonCount'], base.account.autoLogonCount, 1, 999),
      administrator: bool(account['administrator'], base.account.administrator),
      skipSecurityQuestions: bool(account['skipSecurityQuestions'], base.account.skipSecurityQuestions),
    },
    region: {
      uiLanguage: str(region['uiLanguage'], base.region.uiLanguage, 32),
      userLocale: str(region['userLocale'], base.region.userLocale, 32),
      inputLocale: str(region['inputLocale'], base.region.inputLocale, 128),
      timeZone: str(region['timeZone'], base.region.timeZone, 64),
      geoId: str(region['geoId'], base.region.geoId, 8),
    },
    setup: {
      disk:
        disk['kind'] === 'wipe-disk'
          ? {
              kind: 'wipe-disk',
              diskId: int(disk['diskId'], 0, 0, 63),
              recoveryPartitionMb: int(disk['recoveryPartitionMb'], 750, 0, 10_000),
            }
          : { kind: 'interactive' },
      bypassRequirements: bool(setup['bypassRequirements'], base.setup.bypassRequirements),
      bypassNetworkRequirement: bool(setup['bypassNetworkRequirement'], base.setup.bypassNetworkRequirement),
      computerName: str(setup['computerName'], base.setup.computerName, 32).trim(),
      skipOobe: bool(setup['skipOobe'], base.setup.skipOobe),
      skipMicrosoftAccount: bool(setup['skipMicrosoftAccount'], base.setup.skipMicrosoftAccount),
      disableExpressSettings: bool(setup['disableExpressSettings'], base.setup.disableExpressSettings),
    },
    wifi: {
      enabled: bool(wifi['enabled'], base.wifi.enabled),
      ssid: str(wifi['ssid'], base.wifi.ssid, 64),
      password: str(wifi['password'], base.wifi.password, 128),
      hidden: bool(wifi['hidden'], base.wifi.hidden),
    },
    privacy: Array.isArray(raw['privacy'])
      ? stringList(raw['privacy'], 128, 64).filter((id) => allPrivacyTweakIds.includes(id))
      : base.privacy,
    debloat: {
      removeProvisionedApps: bool(debloat['removeProvisionedApps'], base.debloat.removeProvisionedApps),
      packages: Array.isArray(debloat['packages'])
        ? stringList(debloat['packages'], 256, 128).filter((p) => /^[A-Za-z0-9._-]+$/.test(p))
        : base.debloat.packages,
      disableOneDriveSetup: bool(debloat['disableOneDriveSetup'], base.debloat.disableOneDriveSetup),
      disableCopilot: bool(debloat['disableCopilot'], base.debloat.disableCopilot),
    },
    // Only reachable from the Advanced tab, and only ever run on the user's own PC.
    extraSetupCommands: stringList(raw['extraSetupCommands'], 32, 1024).filter((c) => !/[\r\n]/.test(c)),
  };
}
