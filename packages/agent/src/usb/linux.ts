import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { UsbDevice } from '../../../shared/src/types.js';
import { commandExists, run, runOrThrow, runStreaming } from '../process.js';
import { splitWithWimlib } from './macos.js';
import { sanitizeVolumeLabel, type FormattedTarget, type LogFn, type MountedIso, type ProgressFn, type UsbPlatform } from './platform.js';

export class LinuxUsbPlatform implements UsbPlatform {
  readonly name = 'linux';

  async checkPrerequisites(): Promise<{ ok: boolean; missing: Array<{ tool: string; hint: string }> }> {
    const missing: Array<{ tool: string; hint: string }> = [];
    const required: Array<{ tool: string; probe: string[]; hint: string }> = [
      { tool: 'sgdisk', probe: ['--version'], hint: 'Install it with: sudo apt install gdisk (or dnf install gdisk)' },
      { tool: 'mkfs.vfat', probe: ['--help'], hint: 'Install it with: sudo apt install dosfstools' },
      { tool: 'rsync', probe: ['--version'], hint: 'Install it with: sudo apt install rsync' },
      { tool: 'wimlib-imagex', probe: ['--version'], hint: 'Install it with: sudo apt install wimtools' },
    ];
    for (const item of required) {
      if (!(await commandExists(item.tool, item.probe))) missing.push({ tool: item.tool, hint: item.hint });
    }
    if (process.getuid?.() !== 0) {
      missing.push({ tool: 'root privileges', hint: 'Partitioning a disk needs root. Start the agent with sudo.' });
    }
    return { ok: missing.length === 0, missing };
  }

  async partitionAndFormat(device: UsbDevice, label: string, log: LogFn): Promise<FormattedTarget> {
    const volumeLabel = sanitizeVolumeLabel(label);

    for (const mount of device.mountPoints) {
      await run('umount', [mount]);
    }

    log(`Wiping the partition table on ${device.id}.`);
    await runOrThrow('sgdisk', ['--zap-all', device.id]);
    // Type EF00 marks it as an EFI System Partition, which is what firmware looks for.
    await runOrThrow('sgdisk', ['--new', '1:0:0', '--typecode', '1:EF00', '--change-name', `1:${volumeLabel}`, device.id]);
    await run('partprobe', [device.id]);
    await run('udevadm', ['settle']);

    const partition = partitionPath(device.id, 1);
    log(`Creating a FAT32 filesystem on ${partition}.`);
    await runOrThrow('mkfs.vfat', ['-F', '32', '-n', volumeLabel, partition]);

    const mountPoint = await mkdtemp(join(tmpdir(), 'osit-usb-'));
    await runOrThrow('mount', [partition, mountPoint]);
    log(`Boot partition mounted at ${mountPoint}`);
    return { mountPath: mountPoint, handle: partition };
  }

  async mountIso(isoPath: string, log: LogFn): Promise<MountedIso> {
    const mountPoint = await mkdtemp(join(tmpdir(), 'osit-iso-'));
    await runOrThrow('mount', ['-o', 'loop,ro', isoPath, mountPoint]);
    log(`ISO mounted at ${mountPoint}`);
    return {
      path: mountPoint,
      unmount: async () => {
        await run('umount', [mountPoint]);
        await rm(mountPoint, { recursive: true, force: true });
      },
    };
  }

  async copyTree(from: string, to: string, excludeFiles: string[], progress: ProgressFn): Promise<void> {
    const args = ['-rL', '--info=progress2', '--no-inc-recursive'];
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
    await splitWithWimlib(sourceImage, destinationDir, maxMegabytes, progress);
  }

  async finish(target: FormattedTarget, device: UsbDevice, log: LogFn): Promise<void> {
    void device;
    log('Flushing writes and unmounting.');
    await run('sync', []);
    await run('umount', [target.mountPath]);
    await rm(target.mountPath, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** `/dev/sdb` becomes `/dev/sdb1`, but `/dev/nvme0n1` becomes `/dev/nvme0n1p1`. */
export function partitionPath(devicePath: string, index: number): string {
  return /\d$/.test(devicePath) ? `${devicePath}p${index}` : `${devicePath}${index}`;
}
