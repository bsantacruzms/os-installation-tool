import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { CreateUsbRequest, JobPhase, UsbDevice } from '../../../shared/src/types.js';
import { assertSafeTarget, findDevice, listDevices } from '../devices/index.js';
import { downloadFile } from '../download.js';
import { applyPlan } from './apply.js';
import { LinuxUsbPlatform } from './linux.js';
import { MacUsbPlatform } from './macos.js';
import { FAT32_MAX_FILE_BYTES, type UsbPlatform } from './platform.js';
import { WindowsUsbPlatform } from './windows.js';

export function createPlatform(platform: NodeJS.Platform = process.platform): UsbPlatform {
  switch (platform) {
    case 'win32':
      return new WindowsUsbPlatform();
    case 'darwin':
      return new MacUsbPlatform();
    case 'linux':
      return new LinuxUsbPlatform();
    default:
      throw new Error(`Writing USB sticks is not supported on ${platform}.`);
  }
}

export interface PhaseWeight {
  phase: JobPhase;
  weight: number;
}

/** Rough share of total wall clock time, used to keep one progress bar honest. */
const WEIGHTS_WITH_DOWNLOAD: PhaseWeight[] = [
  { phase: 'downloading', weight: 0.55 },
  { phase: 'partitioning', weight: 0.03 },
  { phase: 'extracting', weight: 0.24 },
  { phase: 'splitting-wim', weight: 0.13 },
  { phase: 'injecting', weight: 0.02 },
  { phase: 'finalizing', weight: 0.03 },
];

const WEIGHTS_LOCAL_ISO: PhaseWeight[] = [
  { phase: 'partitioning', weight: 0.06 },
  { phase: 'extracting', weight: 0.55 },
  { phase: 'splitting-wim', weight: 0.3 },
  { phase: 'injecting', weight: 0.04 },
  { phase: 'finalizing', weight: 0.05 },
];

export interface WriterEvents {
  onPhase(phase: JobPhase, message: string): void;
  onProgress(phase: JobPhase, fraction: number | null, overall: number, message: string, extra?: { bytesDone?: number; bytesTotal?: number; bytesPerSecond?: number; etaSeconds?: number }): void;
  onLog(message: string): void;
}

export interface WriterOptions {
  request: CreateUsbRequest;
  workDirectory: string;
  signal: AbortSignal;
  events: WriterEvents;
  platform?: UsbPlatform;
}

async function sizeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).size;
  } catch {
    return 0;
  }
}

/** Finds the one file on the media that FAT32 cannot hold. */
export async function findOversizedInstallImage(isoRoot: string): Promise<{ path: string; name: string; bytes: number } | null> {
  for (const name of ['install.wim', 'install.esd']) {
    const path = join(isoRoot, 'sources', name);
    const bytes = await sizeOf(path);
    if (bytes > FAT32_MAX_FILE_BYTES) return { path, name, bytes };
  }
  return null;
}

export async function createBootableUsb(options: WriterOptions): Promise<void> {
  const { request, events, signal } = options;
  const platform = options.platform ?? createPlatform();

  const weights = request.iso.kind === 'url' ? WEIGHTS_WITH_DOWNLOAD : WEIGHTS_LOCAL_ISO;
  let completed = 0;
  let currentWeight = 0;

  const beginPhase = (phase: JobPhase, message: string) => {
    completed += currentWeight;
    currentWeight = weights.find((w) => w.phase === phase)?.weight ?? 0;
    events.onPhase(phase, message);
    events.onProgress(phase, 0, completed, message);
  };
  const report = (
    phase: JobPhase,
    fraction: number | null,
    message: string,
    extra?: { bytesDone?: number; bytesTotal?: number; bytesPerSecond?: number; etaSeconds?: number },
  ) => {
    const overall = Math.min(0.999, completed + currentWeight * (fraction ?? 0));
    events.onProgress(phase, fraction, overall, message, extra);
  };
  const throwIfCancelled = () => {
    if (signal.aborted) throw new Error('Cancelled.');
  };

  const prerequisites = await platform.checkPrerequisites();
  if (!prerequisites.ok) {
    const details = prerequisites.missing.map((m) => `${m.tool}: ${m.hint}`).join('\n');
    throw new Error(`This computer is missing something the agent needs:\n${details}`);
  }

  const device = findDevice(await listDevices(), request.deviceId);
  assertSafeTarget(device, { requireRemovable: request.requireRemovable });
  throwIfCancelled();

  // ---- ISO ----------------------------------------------------------------
  const isoSource = request.iso;
  let isoPath: string;
  if (isoSource.kind === 'url') {
    beginPhase('downloading', `Downloading ${isoSource.fileName} from Microsoft`);
    isoPath = join(options.workDirectory, isoSource.fileName);
    const download = await downloadFile({
      url: isoSource.url,
      destination: isoPath,
      ...(isoSource.sha256 ? { sha256: isoSource.sha256 } : {}),
      signal,
      onProgress: (progress) => {
        const fraction = progress.bytesTotal > 0 ? progress.bytesDone / progress.bytesTotal : null;
        report('downloading', fraction, `Downloading ${isoSource.fileName}`, progress);
      },
    });
    events.onLog(`${download.resumed ? 'Resumed and finished' : 'Downloaded'} ${download.bytes} bytes to ${isoPath}`);
  } else {
    isoPath = isoSource.path;
    if ((await sizeOf(isoPath)) === 0) throw new Error(`Cannot read the ISO at ${isoPath}.`);
    events.onLog(`Using the ISO already on disk at ${isoPath}`);
  }
  throwIfCancelled();

  // ---- Format -------------------------------------------------------------
  beginPhase('partitioning', `Erasing ${device.description}`);
  const target = await platform.partitionAndFormat(device, request.volumeLabel, events.onLog);
  throwIfCancelled();

  const iso = await platform.mountIso(isoPath, events.onLog);
  try {
    // ---- Copy -------------------------------------------------------------
    const oversized = await findOversizedInstallImage(iso.path);
    if (oversized) {
      events.onLog(
        `sources/${oversized.name} is ${(oversized.bytes / 1024 ** 3).toFixed(1)} GB, which FAT32 cannot store. It will be split.`,
      );
    }

    beginPhase('extracting', 'Copying the installer files to the USB stick');
    await platform.copyTree(iso.path, target.mountPath, oversized ? [oversized.name] : [], (fraction, message) =>
      report('extracting', fraction, message),
    );
    throwIfCancelled();

    // ---- Split ------------------------------------------------------------
    if (oversized) {
      beginPhase('splitting-wim', 'Splitting the Windows image so it fits on FAT32');
      // 3800 MB keeps every chunk comfortably below the 4 GiB FAT32 limit.
      await platform.splitImage(oversized.path, join(target.mountPath, 'sources'), 3800, (fraction, message) =>
        report('splitting-wim', fraction, message),
      );
      throwIfCancelled();
    }

    // ---- Inject -----------------------------------------------------------
    beginPhase('injecting', 'Applying your settings to the USB stick');
    const applied = await applyPlan(target.mountPath, request.plan, events.onLog);
    report('injecting', 1, `Wrote ${applied.written.length} files, removed ${applied.removed.length}`);
  } finally {
    await iso.unmount().catch((error: unknown) => events.onLog(`Could not unmount the ISO: ${String(error)}`));
  }

  // ---- Finish -------------------------------------------------------------
  beginPhase('finalizing', 'Finishing up');
  await platform.finish(target, device, events.onLog);
  report('finalizing', 1, 'Done');
}
