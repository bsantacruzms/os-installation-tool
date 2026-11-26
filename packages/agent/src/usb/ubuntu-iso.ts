import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { UsbDevice } from '../../../shared/src/types.js';
import { powershellJson, runOrThrow } from '../process.js';
import { windowsDiskNumber } from '../devices/windows.js';
import { FAT32_MAX_FILE_BYTES, WINDOWS_FAT32_MAX_MB } from './platform.js';
import { WindowsUsbPlatform } from './windows.js';
import { prepareClearedGpt } from './windows-gpt.js';
import type { WriterEvents } from './writer.js';

const MiB = 1024 ** 2;
const cluster = 8192;

export async function inspectUbuntuTree(root: string, capacity: number, signal: AbortSignal) {
  const files: string[] = [];
  const directories: string[] = [];
  let required = 16 * MiB; // FATs, directories, and rounding overhead.
  async function visit(dir: string) {
    for (const entry of await readdir(join(root, dir), { withFileTypes: true })) {
      signal.throwIfAborted();
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        directories.push(path);
        await visit(path);
      } else {
        if (!entry.isFile()) throw new Error(`Cannot represent ${path} on FAT32. Use raw image mode.`);
        const { size } = await stat(join(root, path));
        if (size > FAT32_MAX_FILE_BYTES) throw new Error(`${path} exceeds FAT32's file limit. Use raw image mode.`);
        required += Math.ceil(size / cluster) * cluster;
        files.push(path);
      }
    }
  }
  await visit('');
  const names = new Set(files.map(p => p.replace(/\\/g, '/').toLowerCase()));
  for (const file of ['efi/boot/bootx64.efi', 'efi/boot/grubx64.efi', 'boot/grub/grub.cfg', 'casper/vmlinuz', 'casper/initrd', '.disk/info']) {
    if (!names.has(file)) throw new Error(`ISO file mode cannot find ${file}. Use raw image mode.`);
  }
  const partitionMiB = Math.min(WINDOWS_FAT32_MAX_MB, Math.floor(capacity / MiB) - 16);
  if (partitionMiB * MiB < required) throw new Error('The Ubuntu files will not fit the FAT32 partition. Select a larger drive.');
  return { files, directories, partitionMiB };
}

export async function copyUbuntuTree(source: string, target: string, tree: Awaited<ReturnType<typeof inspectUbuntuTree>>,
  signal: AbortSignal, progress: (fraction: number) => void) {
  for (const dir of tree.directories) {
    signal.throwIfAborted();
    await mkdir(join(target, dir));
  }
  for (const [i, file] of tree.files.entries()) {
    signal.throwIfAborted();
    const dst = join(target, file);
    const hash = createHash('sha256');
    const input = createReadStream(join(source, file));
    input.on('data', chunk => hash.update(chunk));
    await pipeline(input, createWriteStream(dst, { flags: 'wx' }), { signal });
    const check = createHash('sha256');
    await pipeline(createReadStream(dst), check, { signal });
    if (!hash.digest().equals(check.digest())) throw new Error(`USB read-back verification failed for ${file}.`);
    progress((i + 1) / tree.files.length);
  }
}

export async function writeUbuntuFiles(isoPath: string, getTarget: () => Promise<UsbDevice>, events: WriterEvents, signal: AbortSignal) {
  const iso = await new WindowsUsbPlatform().mountIso(isoPath, events.onLog);
  try {
    events.onPhase('verifying', 'Checking Ubuntu UEFI files, FAT32 limits and target capacity');
    const tree = await inspectUbuntuTree(iso.path, (await getTarget()).sizeBytes, signal);
    const device = await getTarget();
    signal.throwIfAborted();
    const n = windowsDiskNumber(device.id);
    const name = Buffer.from(device.description).toString('base64');
    events.onPhase('partitioning', `Creating a GPT/FAT32 volume on ${device.description}`);
    const volume = await powershellJson<{ path: string; letter: string }>(`
$ErrorActionPreference = 'Stop'
$n = ${n}
$disk = Get-Disk -Number $n
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}'))
if ($disk.IsBoot -or $disk.IsSystem -or $disk.IsReadOnly -or $disk.BusType -notin 'USB','SD','MMC' -or $disk.Size -ne ${device.sizeBytes} -or $disk.FriendlyName.Trim() -ne $name) { throw 'USB target changed or is protected.' }
if ($disk.PartitionStyle -ne 'RAW') { $disk | Clear-Disk -RemoveData -RemoveOEM -Confirm:$false }
${prepareClearedGpt}
$p = New-Partition -DiskNumber ${n} -Size ${tree.partitionMiB}MB -AssignDriveLetter
$v = Format-Volume -Partition $p -FileSystem FAT32 -AllocationUnitSize ${cluster} -NewFileSystemLabel UBUNTU -Confirm:$false -Force
[pscustomobject]@{ path = $v.Path; letter = [string]$p.DriveLetter } | ConvertTo-Json`);
    // Bind every subsequent file operation to the new volume, not a reusable drive letter.
    if (!/^\\\\\?\\Volume\{[0-9a-f-]{36}\}\\$/i.test(volume.path) || !/^[A-Z]$/i.test(volume.letter))
      throw new Error('Windows did not return a mounted FAT32 USB volume.');
    await getTarget();
    events.onPhase('extracting', `Copying and verifying Ubuntu files on ${volume.letter}:`);
    await copyUbuntuTree(iso.path, volume.path, tree, signal, fraction =>
      events.onProgress('extracting', fraction, 0.5 + 0.49 * fraction, 'Copying and verifying Ubuntu files'));
    events.onPhase('finalizing', 'Flushing the verified FAT32 volume');
    await runOrThrow('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Get-Volume -Path '${volume.path}' | Write-VolumeCache`]);
  } finally { await iso.unmount(); }
}
