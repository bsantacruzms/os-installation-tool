import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { UsbDevice } from '../../../shared/src/types.js';
import { windowsDiskNumber } from '../devices/windows.js';
import { downloadFile, sha256File } from '../download.js';
import { powershellJson, runOrThrow } from '../process.js';
import { WindowsUsbPlatform } from './windows.js';
import { prepareClearedGpt } from './windows-gpt.js';
import type { WriterEvents } from './writer.js';

// Ubuntu resolute/main amd64: pin both the container and the exact signed member.
const loaders = [
  { deb: 's/shim-signed/shim-signed_1.59+15.8-0ubuntu2_amd64.deb',
    sha: 'f8ed71ce2d91a304b6d5eb84997f846f331b554578bc02dbfe78e13ad8ac81a9',
    archive: 'data.tar.xz', member: './usr/lib/shim/shimx64.nx.efi.signed.latest',
    digest: '4e35f09f7ef5349acc5594f4af927a414ea52be128bc5d959288e0f6e9fd7a30', name: 'BOOTX64.EFI' },
  { deb: 'g/grub2-signed/grub-efi-amd64-signed_1.215+2.14-2ubuntu1_amd64.deb',
    sha: '603fe7db065634780d9576bab48fce8143a0451697c5be75a6cdb1f6a5e39188',
    archive: 'data.tar.zst', member: './usr/lib/grub/x86_64-efi-signed/grubx64.efi.signed',
    digest: '33e1d46cb68e41a293c767750078bbdb857ad7c1197a2206dea737bc9ccb8dbf', name: 'grubx64.efi' },
] as const;

// Both destinations are fresh. Create only children, parent first: recursive mkdir
// can try to create the Windows volume-GUID root itself (the marker lives at root).
async function createBootDirectories(root: string) {
  for (const dir of ['EFI', 'EFI/BOOT', 'EFI/ubuntu', 'casper']) await mkdir(join(root, dir));
}

export async function copySignedBootFiles(source: string, target: string, entries: string[], signal: AbortSignal) {
  signal.throwIfAborted();
  await createBootDirectories(target);
  for (const file of entries) {
    signal.throwIfAborted();
    const src = join(source, file), dest = join(target, file);
    await copyFile(src, dest);
    if (await sha256File(src) !== await sha256File(dest)) throw new Error(`USB verification failed: ${file}`);
  }
}

/** GRUB reads only FAT. Ubuntu's initramfs locates the intact ISO on the data volume. */
export async function stageSignedBoot(scratch: string, isoRoot: string, signal: AbortSignal) {
  const boot = join(scratch, 'boot-tree');
  await mkdir(boot);
  await createBootDirectories(boot);
  const entries: string[] = [];
  for (const loader of loaders) {
    const cwd = await mkdtemp(join(scratch, 'package-'));
    const pkg = join(cwd, 'loader.deb');
    await downloadFile({ url: `https://archive.ubuntu.com/ubuntu/pool/main/${loader.deb}`, destination: pkg, sha256: loader.sha, httpsOnly: true, signal });
    await runOrThrow('tar.exe', ['-xf', pkg, loader.archive], { cwd, signal });
    await runOrThrow('tar.exe', ['-xf', loader.archive, loader.member], { cwd, signal });
    const binary = join(cwd, loader.member);
    if (await sha256File(binary) !== loader.digest) throw new Error('Signed bootloader fingerprint mismatch; USB not touched.');
    const dest = join('EFI', 'BOOT', loader.name);
    await copyFile(binary, join(boot, dest));
    entries.push(dest);
  }
  for (const file of ['casper/vmlinuz', 'casper/initrd']) {
    signal.throwIfAborted();
    await copyFile(join(isoRoot, file), join(boot, file));
    entries.push(file);
  }
  const id = randomUUID();
  const isoName = `ubuntu-${id}.iso`;
  // The removable-media path and Ubuntu's compiled-in vendor prefix both find the same menu.
  const cfg = `set timeout=10\nsearch --file --set=root /${id}.tag\n` +
    ['', ' nomodeset'].map(option => `menuentry 'Try or install Ubuntu${option ? ' (safe graphics)' : ''}' {
  linux /casper/vmlinuz boot=casper iso-scan/filename=/ISO/${isoName}${option} ---
  initrd /casper/initrd
}\n`).join('');
  for (const file of ['EFI/ubuntu/grub.cfg', 'EFI/BOOT/grub.cfg', `${id}.tag`]) {
    await writeFile(join(boot, file), file.endsWith('.cfg') ? cfg : '');
    entries.push(file);
  }
  return { boot, entries, isoName };
}

const MiB = 1024 ** 2;
const espMiB = 512;
const guidVolume = /^\\\\\?\\Volume\{[0-9a-f-]{36}\}\\$/i;

export async function writeSignedGrub(iso: string, digest: string, getTarget: () => Promise<UsbDevice>, events: WriterEvents, signal: AbortSignal) {
  const scratch = await mkdtemp(join(dirname(iso), 'signed-'));
  try {
    const isoBytes = (await stat(iso)).size;
    const minBytes = isoBytes + (espMiB + 128) * MiB;
    if ((await getTarget()).sizeBytes < minBytes) throw new Error('Drive too small for the ISO and the separate FAT32 boot partition.');
    events.onPhase('verifying', 'Preparing official signed Ubuntu boot files before erasing the USB');
    const mounted = await new WindowsUsbPlatform().mountIso(iso, events.onLog);
    const stage = await stageSignedBoot(scratch, mounted.path, signal).finally(() => mounted.unmount());
    const bootBytes = (await Promise.all(stage.entries.map(p => stat(join(stage.boot, p))))).reduce((n, s) => n + s.size, 0);
    if (bootBytes > (espMiB - 16) * MiB) throw new Error('Signed boot files exceed the reserved boot partition.');
    const device = await getTarget();
    signal.throwIfAborted();
    const n = windowsDiskNumber(device.id);
    const name = Buffer.from(device.description).toString('base64');
    events.onPhase('partitioning', `Creating signed boot and ISO partitions on ${device.description}`);
    const volumes = await powershellJson<{ boot: string; data: string }>(`
$ErrorActionPreference = 'Stop'
$n = ${n}
$disk = Get-Disk -Number $n
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}'))
if ($disk.IsBoot -or $disk.IsSystem -or $disk.IsOffline -or $disk.IsReadOnly -or $disk.BusType -notin 'USB','SD','MMC' -or $disk.Size -ne ${device.sizeBytes} -or $disk.FriendlyName.Trim() -ne $name) { throw 'USB target changed or is protected.' }
if ($disk.PartitionStyle -ne 'RAW') { $disk | Clear-Disk -RemoveData -RemoveOEM -Confirm:$false }
${prepareClearedGpt}
$p = New-Partition -DiskNumber ${n} -Size ${espMiB}MB -GptType '{c12a7328-f81f-11d2-ba4b-00a0c93ec93b}'
$boot = Format-Volume -Partition $p -FileSystem FAT32 -NewFileSystemLabel OSITBOOT -Force -Confirm:$false
$p = New-Partition -DiskNumber ${n} -UseMaximumSize -AssignDriveLetter
$data = Format-Volume -Partition $p -FileSystem NTFS -NewFileSystemLabel OSITISO -Force -Confirm:$false
[pscustomobject]@{boot=$boot.Path;data=$data.Path} | ConvertTo-Json`);
    if (!guidVolume.test(volumes.boot) || !guidVolume.test(volumes.data) || volumes.boot.toLowerCase() === volumes.data.toLowerCase())
      throw new Error('Windows did not return two distinct USB volume paths.');
    await getTarget();
    events.onPhase('extracting', 'Copying signed boot files and intact ISO');
    await copySignedBootFiles(stage.boot, volumes.boot, stage.entries, signal);
    signal.throwIfAborted();
    await mkdir(join(volumes.data, 'ISO'));
    const usbIso = join(volumes.data, 'ISO', stage.isoName);
    await copyFile(iso, usbIso);
    signal.throwIfAborted();
    events.onPhase('verifying', 'Verifying the ISO from the USB');
    if (await sha256File(usbIso) !== digest) throw new Error('USB ISO verification failed.');
    await runOrThrow('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      `$ErrorActionPreference='Stop'; Write-VolumeCache -Path '${volumes.boot}','${volumes.data}'`]);
    signal.throwIfAborted();
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
