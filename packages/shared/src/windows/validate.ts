import type { WindowsBuildConfig } from '../types.js';
import { findEdition } from './editions.js';
import { findPrivacyTweak } from './privacy.js';

export interface ValidationIssue {
  /** Dotted path into the config, e.g. `account.username`. */
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

/** Names Windows refuses to use for a local account. */
const reservedAccountNames = new Set([
  'administrator',
  'guest',
  'system',
  'network service',
  'local service',
  'defaultaccount',
  'wdagutilityaccount',
  'public',
  'default',
  'all users',
  'console',
  'anonymous logon',
]);

const invalidAccountChars = /["/\\[\]:;|=,+*?<>@]/;

export function validateWindowsConfig(config: WindowsBuildConfig): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const err = (field: string, message: string) => issues.push({ field, message, severity: 'error' });
  const warn = (field: string, message: string) => issues.push({ field, message, severity: 'warning' });

  const name = config.account.username.trim();
  if (name.length === 0) {
    err('account.username', 'Enter the user name for the account that will be created automatically.');
  } else {
    if (name.length > 20) err('account.username', 'Windows user names are limited to 20 characters.');
    if (invalidAccountChars.test(name)) err('account.username', 'User names cannot contain " / \\ [ ] : ; | = , + * ? < > @');
    if (name.endsWith('.')) err('account.username', 'User names cannot end with a period.');
    if (/^\s|\s$/.test(config.account.username)) err('account.username', 'User names cannot start or end with a space.');
    if (reservedAccountNames.has(name.toLowerCase())) err('account.username', `"${name}" is reserved by Windows. Pick a different name.`);
    if (config.setup.computerName.trim().toLowerCase() === name.toLowerCase()) {
      err('setup.computerName', 'The PC name must be different from the user name, otherwise Setup fails.');
    }
  }

  if (config.account.password.length === 0) {
    warn('account.password', 'No password means anyone with physical access can sign in. Fine for a test VM, risky for a laptop.');
  } else if (config.account.password.length > 127) {
    err('account.password', 'Passwords longer than 127 characters are not supported by unattended setup.');
  }

  if (config.account.autoLogon && config.account.password.length > 0) {
    warn(
      'account.autoLogon',
      'Automatic sign-in stores the password on the installed system in a recoverable form. Turn it off for anything that leaves your desk.',
    );
  }

  const computerName = config.setup.computerName.trim();
  if (computerName.length > 0) {
    if (computerName.length > 15) err('setup.computerName', 'PC names are limited to 15 characters.');
    if (!/^[A-Za-z0-9-]+$/.test(computerName)) err('setup.computerName', 'PC names may only contain letters, numbers and hyphens.');
    if (/^\d+$/.test(computerName)) err('setup.computerName', 'PC names cannot be all digits.');
  }

  if (config.image.edition.kind === 'preselect') {
    const edition = findEdition(config.image.edition.editionId);
    if (!edition) {
      err('image.edition', `Unknown Windows edition "${config.image.edition.editionId}".`);
    } else if (!edition.availableIn.includes(config.image.variantId)) {
      err('image.edition', `${edition.displayName} is not included in the selected ISO. Choose a different image or edition.`);
    } else if (!edition.arches.includes(config.image.arch)) {
      err('image.edition', `${edition.displayName} is not available for ${config.image.arch}.`);
    }
  }

  for (const id of config.privacy) {
    if (!findPrivacyTweak(id)) warn('privacy', `Ignoring unknown privacy option "${id}".`);
  }

  if (config.wifi.enabled) {
    if (config.wifi.ssid.trim().length === 0) err('wifi.ssid', 'Enter the Wi-Fi network name.');
    if (config.wifi.password.length > 0 && (config.wifi.password.length < 8 || config.wifi.password.length > 63)) {
      err('wifi.password', 'A WPA2/WPA3 passphrase must be between 8 and 63 characters.');
    }
    warn('wifi', 'The Wi-Fi passphrase is stored on the USB stick in clear text. Anyone holding the stick can read it.');
  }

  if (config.setup.disk.kind === 'wipe-disk') {
    warn(
      'setup.disk',
      `Automatic partitioning will erase every partition on disk ${config.setup.disk.diskId} of the target PC without asking again.`,
    );
    if (config.setup.disk.diskId < 0) err('setup.disk', 'Disk number must be 0 or greater.');
  }

  if (config.setup.bypassRequirements) {
    warn(
      'setup.bypassRequirements',
      'Installing on unsupported hardware is allowed by these registry shims, but Microsoft does not guarantee updates on such a PC.',
    );
  }

  if (config.region.inputLocale.trim().length > 0 && !/^[0-9a-fA-F]{4}:[0-9a-fA-F]{8}(;[0-9a-fA-F]{4}:[0-9a-fA-F]{8})*$/.test(config.region.inputLocale.trim())) {
    warn('region.inputLocale', 'Keyboard layout should look like 0409:00000409. Setup may fall back to the default layout.');
  }

  return issues;
}

export function hasErrors(issues: ValidationIssue[]): boolean {
  return issues.some((i) => i.severity === 'error');
}
