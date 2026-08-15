import { join } from 'node:path';

import type { UsbDevice } from '../../../shared/src/types.js';
import { commandExists, powershellJson, run, runStreaming } from '../process.js';
import { windowsDiskNumber } from '../devices/windows.js';
import {
  sanitizeVolumeLabel,
  WINDOWS_FAT32_MAX_MB,
  type FormattedTarget,
  type LogFn,
  type MountedIso,
  type ProgressFn,
  type UsbPlatform,
} from './platform.js';

const MB = 1024 * 1024;

async function ps<T>(script: string): Promise<T> {
  return powershellJson<T>(script);
}

export class WindowsUsbPlatform implements UsbPlatform {
  readonly name = 'windows';

  async checkPrerequisites(): Promise<{ ok: boolean; missing: Array<{ tool: string; hint: string }> }> {
    const missing: Array<{ tool: string; hint: string }> = [];
    if (!(await commandExists('powershell.exe', ['-NoProfile', '-Command', '$PSVersionTable.PSVersion.Major']))) {
      missing.push({ tool: 'powershell.exe', hint: 'Windows PowerShell ships with Windows. Check that it is on PATH.' });
    }
    if (!(await commandExists('robocopy.exe', ['/?']))) {
      missing.push({ tool: 'robocopy.exe', hint: 'Robocopy ships with Windows. Check that C:\\Windows\\System32 is on PATH.' });
    }
    if (!(await commandExists('dism.exe', ['/?']))) {
      missing.push({ tool: 'dism.exe', hint: 'DISM ships with Windows and is needed to split install.wim for FAT32.' });
    }
    return { ok: missing.length === 0, missing };
  }

  async partitionAndFormat(device: UsbDevice, label: string, log: LogFn): Promise<FormattedTarget> {
    const diskNumber = windowsDiskNumber(device.id);
    const volumeLabel = sanitizeVolumeLabel(label);

    // FAT32 is required for UEFI to boot, and Windows refuses to create one
    // larger than 32 GB, so anything above that becomes a second exFAT volume.
    const totalMb = Math.floor(device.sizeBytes / MB);
    const bootMb = Math.min(totalMb - 16, WINDOWS_FAT32_MAX_MB);
    if (bootMb < 6_000) {
      throw new Error(`${device.description} is only ${Math.round(device.sizeBytes / MB / 1024)} GB. A Windows 11 installer needs at least 8 GB.`);
    }
    const dataMb = totalMb - bootMb - 16;

    log(`Erasing disk ${diskNumber} and creating a ${Math.round(bootMb / 1024)} GB FAT32 boot partition.`);

    const script = `
$ErrorActionPreference = 'Stop'
$n = ${diskNumber}
Get-Disk -Number $n | Set-Disk -IsReadOnly $false -ErrorAction SilentlyContinue
Get-Disk -Number $n | Clear-Disk -RemoveData -RemoveOEM -Confirm:$false
Initialize-Disk -Number $n -PartitionStyle GPT -ErrorAction SilentlyContinue
$boot = New-Partition -DiskNumber $n -Size ${bootMb}MB -AssignDriveLetter
Format-Volume -Partition $boot -FileSystem FAT32 -NewFileSystemLabel '${volumeLabel}' -Force -Confirm:$false | Out-Null
${dataMb > 1024
        ? `$data = New-Partition -DiskNumber $n -UseMaximumSize -AssignDriveLetter
Format-Volume -Partition $data -FileSystem exFAT -NewFileSystemLabel '${volumeLabel.slice(0, 6)}DATA' -Force -Confirm:$false | Out-Null`
        : ''}
$boot = Get-Partition -DiskNumber $n -PartitionNumber $boot.PartitionNumber
ConvertTo-Json -InputObject ([pscustomobject]@{ letter = [string]$boot.DriveLetter })
`;

    const result = await ps<{ letter?: string }>(script);
    const letter = (result.letter ?? '').trim();
    if (letter.length === 0) {
      throw new Error('The USB stick was formatted but Windows did not assign it a drive letter.');
    }
    log(`Boot partition is ${letter}:`);
    return { mountPath: `${letter}:\\`, handle: String(diskNumber) };
  }

  async mountIso(isoPath: string, log: LogFn): Promise<MountedIso> {
    const script = `
$ErrorActionPreference = 'Stop'
$img = Mount-DiskImage -ImagePath '${isoPath.replace(/'/g, "''")}' -PassThru
Start-Sleep -Milliseconds 500
$letter = ($img | Get-Volume).DriveLetter
ConvertTo-Json -InputObject ([pscustomobject]@{ letter = [string]$letter })
`;
    const { letter } = await ps<{ letter?: string }>(script);
    if (!letter) throw new Error('Windows mounted the ISO but did not give it a drive letter.');
    log(`ISO mounted at ${letter}:`);

    return {
      path: `${letter}:\\`,
      unmount: async () => {
        await run('powershell.exe', [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Dismount-DiskImage -ImagePath '${isoPath.replace(/'/g, "''")}' | Out-Null`,
        ]);
      },
    };
  }

  async copyTree(from: string, to: string, excludeFiles: string[], progress: ProgressFn): Promise<void> {
    const args = [from, to, '/E', '/NJH', '/NJS', '/NDL', '/NC', '/NS', '/R:2', '/W:2'];
    for (const file of excludeFiles) args.push('/XF', file);

    const result = await runStreaming('robocopy.exe', args, (line) => {
      const trimmed = line.trim();
      if (trimmed.length > 0 && !trimmed.startsWith('---')) progress(null, trimmed.slice(0, 120));
    });

    // Robocopy uses a bit field: anything below 8 means files were copied.
    if (result.code >= 8) {
      throw new Error(`Copying the installer files failed (robocopy exit ${result.code}). ${result.stderr.trim().slice(0, 300)}`);
    }
  }

  async splitImage(sourceImage: string, destinationDir: string, maxMegabytes: number, progress: ProgressFn): Promise<void> {
    const target = join(destinationDir, 'install.swm');
    const result = await runStreaming(
      'dism.exe',
      ['/English', '/Split-Image', `/ImageFile:${sourceImage}`, `/SWMFile:${target}`, `/FileSize:${maxMegabytes}`],
      (line) => {
        const percent = /(\d{1,3}(?:\.\d)?)%/.exec(line)?.[1];
        progress(percent ? Math.min(1, Number(percent) / 100) : null, 'Splitting the Windows image for FAT32');
      },
    );
    if (result.code !== 0) {
      throw new Error(`DISM could not split the Windows image (exit ${result.code}). ${result.stdout.trim().slice(-300)}`);
    }
  }

  async finish(target: FormattedTarget, device: UsbDevice, log: LogFn): Promise<void> {
    void device;
    const drive = target.mountPath.replace(/[\\/]+$/, '');
    log('Flushing write caches.');
    await run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `Write-VolumeCache -DriveLetter '${drive.replace(':', '')}' -ErrorAction SilentlyContinue`,
    ]);
  }
}

/** Used by the writer to confirm elevation before touching a disk. */
export async function isWindowsElevated(): Promise<boolean> {
  const result = await run('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
  ]);
  return /true/i.test(result.stdout);
}
