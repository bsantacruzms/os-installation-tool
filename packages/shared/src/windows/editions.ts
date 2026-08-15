import type { Arch } from '../types.js';

export interface WindowsEdition {
  id: string;
  /** Must match the `/IMAGE/NAME` value inside `sources/install.wim`. */
  imageName: string;
  displayName: string;
  /**
   * Generic setup key published by Microsoft. It only tells Setup which edition
   * to lay down; it does NOT activate Windows and is not a licence.
   */
  genericKey: string;
  /** Editions ordinary users should see first. */
  common: boolean;
  /** ISO variants that actually contain this edition. */
  availableIn: string[];
  arches: Arch[];
  note?: string;
}

/**
 * Generic Volume Licence / setup keys as published by Microsoft in the
 * "KMS client setup keys" documentation. They select an edition during Setup.
 */
export const windowsEditions: readonly WindowsEdition[] = [
  {
    id: 'home',
    imageName: 'Windows 11 Home',
    displayName: 'Windows 11 Home',
    genericKey: 'TX9XD-98N7V-6WMQ6-BX7FG-H8Q99',
    common: true,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'home-n',
    imageName: 'Windows 11 Home N',
    displayName: 'Windows 11 Home N',
    genericKey: '3KHY7-WNT83-DGQKR-F7HPR-844BM',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
    note: 'European edition without Media Player and related media technologies.',
  },
  {
    id: 'home-single-language',
    imageName: 'Windows 11 Home Single Language',
    displayName: 'Windows 11 Home Single Language',
    genericKey: '7HNRX-D7KGG-3K4RQ-4WPJ4-YTDFH',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'pro',
    imageName: 'Windows 11 Pro',
    displayName: 'Windows 11 Pro',
    genericKey: 'W269N-WFGWX-YVC9B-4J6C9-T83GX',
    common: true,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'pro-n',
    imageName: 'Windows 11 Pro N',
    displayName: 'Windows 11 Pro N',
    genericKey: 'MH37W-N47XK-V7XM9-C7227-GCQG9',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'pro-education',
    imageName: 'Windows 11 Pro Education',
    displayName: 'Windows 11 Pro Education',
    genericKey: '6TP4R-GNPTD-KYYHQ-7B7DP-J447Y',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'pro-workstations',
    imageName: 'Windows 11 Pro for Workstations',
    displayName: 'Windows 11 Pro for Workstations',
    genericKey: 'NRG8B-VKK3Q-CXVCJ-9G2XF-6Q84J',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'education',
    imageName: 'Windows 11 Education',
    displayName: 'Windows 11 Education',
    genericKey: 'NW6C2-QMPVW-D7KKK-3GKT6-VCFB2',
    common: false,
    availableIn: ['win11-consumer'],
    arches: ['x64', 'arm64'],
  },
  {
    id: 'enterprise',
    imageName: 'Windows 11 Enterprise',
    displayName: 'Windows 11 Enterprise',
    genericKey: 'NPPR9-FWDCX-D2C8J-H872K-2YT43',
    common: true,
    availableIn: ['win11-enterprise-eval'],
    arches: ['x64', 'arm64'],
    note: 'Not present on the consumer ISO. Requires the Enterprise evaluation ISO or volume licensing media.',
  },
  {
    id: 'enterprise-ltsc',
    imageName: 'Windows 11 Enterprise LTSC',
    displayName: 'Windows 11 Enterprise LTSC 2024',
    genericKey: 'M7XTQ-FN8P6-TTKYV-9D4CC-J462D',
    common: false,
    availableIn: ['win11-ltsc-eval'],
    arches: ['x64', 'arm64'],
    note: 'Long term servicing channel: no Store apps, 5 year support, feature-frozen.',
  },
] as const;

export function findEdition(id: string): WindowsEdition | undefined {
  return windowsEditions.find((e) => e.id === id);
}

export function editionsForVariant(variantId: string, arch?: Arch): WindowsEdition[] {
  return windowsEditions.filter(
    (e) => e.availableIn.includes(variantId) && (arch === undefined || e.arches.includes(arch)),
  );
}
