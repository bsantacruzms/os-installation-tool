import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UsbDevice } from '../../../shared/src/types.js';
import { commandExists, run, runOrThrow, runStreaming } from '../process.js';
import { sanitizeVolumeLabel, type FormattedTarget, type LogFn, type MountedIso, type ProgressFn, type UsbPlatform } from './platform.js';

export class MacUsbPlatform implements UsbPlatform {
  readonly name = 'macos';

  async checkPrerequisites(): Promise<{ ok: boolean; missing: Array<{ tool: string; hint: string }> }> {
    const missing: Array<{ tool: string; hint: string }> = [];
    if (!(await commandExists('diskutil', ['list']))) {
      missing.push({ tool: 'diskutil', hint: 'diskutil ships with macOS. Something is very wrong if it is missing.' });
    }
    if (!(await commandExists('hdiutil', ['help']))) {
      missing.push({ tool: 'hdiutil', hint: 'hdiutil ships with macOS and is needed to mount the ISO.' });
    }
    if (!(await commandExists('wimlib-imagex', ['--version']))) {
      missing.push({
        tool: 'wimlib-imagex',
        hint: 'Needed to split install.wim so it fits on FAT32. Install it with: brew install wimlib',
      });
    }
    // Checked up front so a large download is not wasted.
    if (process.getuid?.() !== 0) {
      missing.push({ tool: 'root privileges', hint: 'Erasing a disk needs root. Start the helper with sudo.' });
    }
    return { ok: missing.length === 0, missing };
  }

  async partitionAndFormat(device: UsbDevice, label: string, log: LogFn): Promise<FormattedTarget> {
    const volumeLabel = sanitizeVolumeLabel(label);
    log(`Erasing ${device.id} as a single GPT/FAT32 volume named ${volumeLabel}.`);
    await runOrThrow('diskutil', ['eraseDisk', 'MS-DOS', volumeLabel, 'GPT', device.id]);

    const info = await runOrThrow('diskutil', ['info', '-plist', `${device.id}s1`]);
    const mountPoint = /<key>MountPoint<\/key>\s*<string>([^<]+)<\/string>/.exec(info.stdout)?.[1];
    if (!mountPoint) throw new Error('The USB stick was formatted but macOS did not mount it.');
    log(`Boot partition mounted at ${mountPoint}`);
    return { mountPath: mountPoint, handle: device.id };
  }

  async mountIso(isoPath: string, log: LogFn): Promise<MountedIso> {
    const mountPoint = await mkdtemp(join(tmpdir(), 'osit-iso-'));
    await runOrThrow('hdiutil', ['attach', '-nobrowse', '-readonly', '-mountpoint', mountPoint, isoPath]);
    log(`ISO mounted at ${mountPoint}`);
    return {
      path: mountPoint,
      unmount: async () => {
        await run('hdiutil', ['detach', mountPoint, '-force']);
        await rm(mountPoint, { recursive: true, force: true });
      },
    };
  }

  async copyTree(from: string, to: string, excludeFiles: string[], progress: ProgressFn): Promise<void> {
    const args = ['-a', '--info=progress2', '--no-inc-recursive'];
    for (const file of excludeFiles) args.push('--exclude', file);
    args.push(`${from.replace(/\/$/, '')}/`, to);

    const result = await runStreaming('rsync', args, (line) => {
      const percent = /(\d{1,3})%/.exec(line)?.[1];
      progress(percent ? Number(percent) / 100 : null, 'Copying installer files');
    });
    if (result.code !== 0) {
      throw new Error(`Copying the installer files failed (rsync exit ${result.code}). ${result.stderr.trim().slice(0, 300)}`);
    }
  }

  async splitImage(sourceImage: string, destinationDir: string, maxMegabytes: number, progress: ProgressFn): Promise<void> {
    progress(null, 'Splitting the Windows image for FAT32');
    await splitWithWimlib(sourceImage, destinationDir, maxMegabytes, progress);
  }

  async finish(target: FormattedTarget, device: UsbDevice, log: LogFn): Promise<void> {
    void target;
    log('Ejecting the USB stick.');
    await run('diskutil', ['eject', device.id]);
  }
}

export async function splitWithWimlib(
  sourceImage: string,
  destinationDir: string,
  maxMegabytes: number,
  progress: ProgressFn,
): Promise<void> {
  const target = join(destinationDir, 'install.swm');
  const result = await runStreaming('wimlib-imagex', ['split', sourceImage, target, String(maxMegabytes)], (line) => {
    const percent = /(\d{1,3})%/.exec(line)?.[1];
    progress(percent ? Number(percent) / 100 : null, 'Splitting the Windows image for FAT32');
  });
  if (result.code !== 0) {
    throw new Error(
      `wimlib-imagex could not split the Windows image (exit ${result.code}). ${(result.stderr || result.stdout).trim().slice(-300)}`,
    );
  }
}
