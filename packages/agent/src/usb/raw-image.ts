import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { copyFile, mkdir, mkdtemp, open, realpath, rm, stat, type FileHandle } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import type { CreateUsbRequest, UsbDevice } from '../../../shared/src/types.js';
import { findLinuxImage } from '../../../shared/src/linux/catalog.js';
import { assertSafeTarget, findDevice, listDevices } from '../devices/index.js';
import { windowsDiskNumber } from '../devices/windows.js';
import { downloadFile, sha256File } from '../download.js';
import { runOrThrow } from '../process.js';
import { preparePersistentUbuntu } from './ubuntu-persistence.js';
import { isWindowsElevated } from './windows.js';
import { writeUbuntuFiles } from './ubuntu-iso.js';
import { writeSignedGrub } from './signed-grub.js';
import type { WriterOptions } from './writer.js';

type Selection = NonNullable<CreateUsbRequest['linux']>;

export function checkLinuxTarget(device: UsbDevice | undefined, selection: Selection): asserts device is UsbDevice {
  assertSafeTarget(device, { requireRemovable: true });
  if (!['usb', 'sd'].includes(device.bus) || device.sizeBytes !== selection.targetBytes || device.description !== selection.targetName)
    throw new Error('The confirmed USB drive no longer matches. Refresh the drive list and select it again.');
}

/** Uses existing handles only: never creates/truncates a path supplied as a device. */
export async function writeAndVerifyImage(
  input: FileHandle, output: FileHandle, bytes: number, capacity: number, expected: string,
  signal: AbortSignal, progress: (verify: boolean, fraction: number) => void,
) {
  if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes % 512 || bytes > capacity)
    throw new Error('The image is empty, not sector-aligned, or too large for the selected drive.');
  const buffer = Buffer.alloc(4 * 1024 * 1024);
  // Invalidate the previous backup GPT, if it lies beyond the new image.
  signal.throwIfAborted();
  if (capacity - bytes >= 4096 && capacity % 4096 === 0) {
    if ((await output.write(buffer, 0, 4096, capacity - 4096)).bytesWritten !== 4096)
      throw new Error('Could not clear the old partition-table signature.');
  }
  // Write the boot sectors last so an automounter cannot activate the new
  // filesystem while its contents are still being copied.
  const head = Math.min(bytes, buffer.length);
  for (const verify of [false, true]) {
    const hash = createHash('sha256');
    for (let done = 0; done < bytes;) {
      signal.throwIfAborted();
      const offset = verify ? done : (head + done) % bytes;
      const count = Math.min(buffer.length, bytes - offset, bytes - done);
      const { bytesRead } = await (verify ? output : input).read(buffer, 0, count, offset);
      if (bytesRead !== count) throw new Error('Short read while imaging the drive.');
      if (verify) hash.update(buffer.subarray(0, count));
      else if ((await output.write(buffer, 0, count, offset)).bytesWritten !== count)
        throw new Error('Short write to the USB drive.');
      done += count;
      progress(verify, done / bytes);
    }
    if (!verify) await output.sync();
    else if (hash.digest('hex') !== expected) throw new Error('USB read-back verification failed.');
  }
}

async function prepareTarget(device: UsbDevice) {
  if (process.platform === 'win32') {
    const n = windowsDiskNumber(device.id);
    const name = Buffer.from(device.description, 'utf8').toString('base64');
    await runOrThrow('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
$disk = Get-Disk -Number ${n}
$name = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${name}'))
if ($disk.IsBoot -or $disk.IsSystem -or $disk.IsReadOnly -or $disk.BusType -notin 'USB','SD','MMC' -or $disk.Size -ne ${device.sizeBytes} -or $disk.FriendlyName.Trim() -ne $name) { throw 'USB target changed or is protected.' }
if ($disk.PartitionStyle -ne 'RAW') { $disk | Clear-Disk -RemoveData -RemoveOEM -Confirm:$false }`]);
    return device.id;
  }
  if (process.platform === 'darwin') {
    if (!/^\/dev\/disk\d+$/.test(device.id)) throw new Error('Expected a whole external disk.');
    await runOrThrow('diskutil', ['unmountDisk', device.id]);
    return device.id.replace('/dev/disk', '/dev/rdisk');
  }
  if (process.platform !== 'linux' || !(await stat(device.id)).isBlockDevice())
    throw new Error('Expected a Linux block device.');
  for (const mount of [...device.mountPoints].sort((a, b) => b.length - a.length))
    await runOrThrow('umount', ['--', mount]);
  return device.id;
}

export async function createLinuxUsb({ request, workDirectory, events, signal }: WriterOptions, selection: Selection) {
  const image = findLinuxImage(selection.imageId);
  if (!image || (selection.persistent && image.id !== 'ubuntu-desktop')) throw new Error('Unsupported Linux image or persistence option.');
  if (!(process.platform === 'win32' ? await isWindowsElevated() : process.getuid?.() === 0))
    throw new Error('Restart the helper as Administrator (Windows) or root before writing a USB.');
  const getTarget = async () => {
    const device = findDevice(await listDevices(), request.deviceId);
    checkLinuxTarget(device, selection);
    return device;
  };
  const original = await getTarget();
  await mkdir(workDirectory, { recursive: true });
  const work = await realpath(workDirectory);
  for (const mount of original.mountPoints) {
    const rel = relative(mount.endsWith(':') ? `${mount}\\` : mount, work);
    if (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
      throw new Error('The helper scratch directory must not be on the target USB.');
  }
  const dir = await mkdtemp(join(work, 'linux-'));
  const iso = join(dir, image.fileName);
  let kept = false;
  try {
    if (request.iso.kind === 'local') {
      if (!isAbsolute(request.iso.path) || !(await stat(request.iso.path)).isFile()) throw new Error('Choose a regular ISO file using its full path.');
      events.onPhase('verifying', 'Staging and verifying your ISO against the official checksum');
      await copyFile(request.iso.path, iso);
      if (await sha256File(iso) !== image.sha256) throw new Error('The local ISO does not match the selected official release.');
    } else {
      events.onPhase('downloading', `Downloading and verifying ${image.name}`);
      await downloadFile({ url: image.url, destination: iso, sha256: image.sha256, signal, httpsOnly: true,
        onProgress: (p) => {
          const fraction = p.bytesTotal ? p.bytesDone / p.bytesTotal : null;
          events.onProgress('downloading', fraction, (fraction ?? 0) * 0.5, `Downloading ${image.fileName}`, p);
        } });
    }
    signal.throwIfAborted();
    if (selection.writeMode === 'iso') {
      if (process.platform !== 'win32' || image.id !== 'ubuntu-desktop' || selection.persistent)
        throw new Error('ISO file mode requires standard Ubuntu Desktop on Windows.');
      await writeUbuntuFiles(iso, getTarget, events, signal);
    } else if (selection.writeMode === 'signed-grub') {
      if (process.platform !== 'win32' || image.id !== 'ubuntu-desktop' || selection.persistent)
        throw new Error('Unsupported signed GRUB configuration.');
      await writeSignedGrub(iso, image.sha256, getTarget, events, signal);
    } else await writeRaw();
    if (request.keepIso && request.iso.kind === 'url') {
      kept = true;
      events.onLog(`Kept the verified official ISO at ${iso}`);
    }
  } finally {
    if (!kept) await rm(dir, { recursive: true, force: true });
    else if (selection.persistent) await rm(join(dir, 'persistent.iso'), { force: true });
  }

  async function writeRaw() {
    let path = iso;
    let digest = image!.sha256;
    if (selection.persistent) {
      events.onPhase('verifying', 'Building Ubuntu Desktop media with a 1 GiB writable partition');
      path = await preparePersistentUbuntu(dir, iso, signal);
      digest = await sha256File(path);
    }
    const input = await open(path, 'r');
    try {
      const { size } = await input.stat();
      const device = await getTarget();
      if (!size || size % 512 || size > device.sizeBytes) throw new Error('The prepared image does not fit this USB drive.');
      signal.throwIfAborted();
      events.onPhase('imaging', `Erasing ${device.description} and writing ${image!.name}`);
      const target = await prepareTarget(device);
      await getTarget();
      signal.throwIfAborted();
      const output = await open(target, constants.O_RDWR | (process.platform === 'linux' ? constants.O_EXCL : 0));
      try {
        let last = 0;
        await writeAndVerifyImage(input, output, size, device.sizeBytes, digest, signal, (verify, fraction) => {
          if (Date.now() - last < 250 && fraction !== 1) return;
          last = Date.now();
          events.onProgress(verify ? 'verifying' : 'imaging', fraction, (verify ? 0.8 : 0.5) + fraction * (verify ? 0.2 : 0.3),
            verify ? 'Checking the written USB against the prepared image' : 'Writing the bootable disk image');
        });
      } finally { await output.close(); }
    } finally { await input.close(); }
  }
}
