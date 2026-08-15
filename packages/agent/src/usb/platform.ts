import type { UsbDevice } from '../../../shared/src/types.js';

export interface FormattedTarget {
  /** Directory the USB boot partition is reachable at (`E:\` or `/Volumes/x`). */
  mountPath: string;
  /** Platform specific handle used when finishing up. */
  handle?: string;
}

export interface MountedIso {
  path: string;
  unmount(): Promise<void>;
}

export type LogFn = (message: string) => void;
export type ProgressFn = (fraction: number | null, message: string) => void;

export interface UsbPlatform {
  readonly name: string;
  /** External tools that must be present, with a human readable install hint. */
  checkPrerequisites(): Promise<{ ok: boolean; missing: Array<{ tool: string; hint: string }> }>;
  partitionAndFormat(device: UsbDevice, label: string, log: LogFn): Promise<FormattedTarget>;
  mountIso(isoPath: string, log: LogFn): Promise<MountedIso>;
  copyTree(from: string, to: string, excludeFiles: string[], progress: ProgressFn): Promise<void>;
  /** Splits `sources/install.wim` into `install*.swm` chunks below the FAT32 limit. */
  splitImage(sourceImage: string, destinationDir: string, maxMegabytes: number, progress: ProgressFn): Promise<void>;
  finish(target: FormattedTarget, device: UsbDevice, log: LogFn): Promise<void>;
}

/** FAT32 cannot hold a single file of 4 GiB or more. */
export const FAT32_MAX_FILE_BYTES = 4 * 1024 * 1024 * 1024 - 1;

/** Windows' own FAT32 formatter refuses to go beyond 32 GB. */
export const WINDOWS_FAT32_MAX_MB = 32_000;

/** FAT32 labels are 11 characters, upper case, and a small character set. */
export function sanitizeVolumeLabel(label: string): string {
  const cleaned = label
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 11);
  return cleaned.length > 0 ? cleaned : 'INSTALLER';
}
