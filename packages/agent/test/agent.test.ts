import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, parse, relative } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { assertSafeTarget, findDevice } from '../src/devices/index.js';
import { parseLsblk } from '../src/devices/linux.js';
import { parseDiskutilPlist } from '../src/devices/macos.js';
import { parseWindowsDisks, windowsDiskNumber } from '../src/devices/windows.js';
import { parseCreateUsbRequest, RequestValidationError, sanitizeFileName } from '../src/request.js';
import { codesMatch, generatePairingCode, isAllowedOrigin, normalizeCode } from '../src/security.js';
import { applyPlan, resolveWithinRoot, UnsafePathError } from '../src/usb/apply.js';
import { partitionPath } from '../src/usb/linux.js';
import { sanitizeVolumeLabel } from '../src/usb/platform.js';
import type { UsbDevice } from '../../shared/src/types.js';
import { checkLinuxTarget, writeAndVerifyImage } from '../src/usb/raw-image.js';
import { enableCasperPersistence } from '../src/usb/ubuntu-persistence.js';
import { inspectUbuntuTree, copyUbuntuTree } from '../src/usb/ubuntu-iso.js';
import { prepareClearedGpt } from '../src/usb/windows-gpt.js';
import { copySignedBootFiles } from '../src/usb/signed-grub.js';
import { runOrThrow } from '../src/process.js';

it('prepares cleared RAW, GPT and MBR targets without masking storage failures', { skip: process.platform !== 'win32' }, async () => {
  // All storage commands are shadowed; no real disks are queried or modified.
  await runOrThrow('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `
$ErrorActionPreference = 'Stop'
function Get-Disk($Path) { return $disk }
function Initialize-Disk($Path, $PartitionStyle) {
  $calls.Add('init')
  if ($case -eq 'failure') { throw 'Simulated storage failure' }
  $disk.PartitionStyle = 'GPT'
}
function Set-Disk($Path, $PartitionStyle) { $calls.Add('convert'); $disk.PartitionStyle = 'GPT' }
foreach ($case in 'RAW','GPT','MBR','failure','occupied') {
  $calls = New-Object 'System.Collections.Generic.List[string]'
  $n = 9999
  $disk = [pscustomobject]@{ Path='mock'; Number=$n; PartitionStyle=$case; NumberOfPartitions=0 }
  if ($case -eq 'failure') { $disk.PartitionStyle = 'RAW' }
  if ($case -eq 'occupied') { $disk.PartitionStyle = 'GPT'; $disk.NumberOfPartitions = 1 }
  try { ${prepareClearedGpt} }
  catch {
    if ($case -eq 'failure' -and $_.Exception.Message -eq 'Simulated storage failure') { continue }
    if ($case -eq 'occupied' -and $_.Exception.Message -like '*not empty*' -and !$calls.Count) { continue }
    throw
  }
  $expected = @{ RAW='init'; MBR='convert'; GPT='' }
  if (!$expected.ContainsKey($case) -or ($calls -join ',') -ne $expected[$case] -or $disk.PartitionStyle -ne 'GPT') {
    throw "Unexpected outcome for $case"
  }
}
exit 0`]);
});

describe('Linux imaging', () => {
  it('copies nested EFI files and the root marker via a Windows volume GUID', { skip: process.platform !== 'win32' }, async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osit-volume-copy-'));
    try {
      const drive = parse(dir).root;
      assert.match(drive, /^[a-z]:\\$/i);
      const { stdout } = await runOrThrow('mountvol.exe', [drive, '/L']);
      const volume = stdout.trim();
      assert.match(volume, /^\\\\\?\\Volume\{[0-9a-f-]{36}\}\\$/i);
      const source = join(dir, 'source'), target = join(dir, 'target');
      await mkdir(source);
      await mkdir(target);
      const entries = ['EFI/BOOT/BOOTX64.EFI', 'EFI/ubuntu/grub.cfg', 'casper/initrd', 'marker.tag'];
      await mkdir(join(source, 'EFI/BOOT'), { recursive: true });
      await mkdir(join(source, 'EFI/ubuntu'));
      await mkdir(join(source, 'casper'));
      for (const file of entries) await writeFile(join(source, file), file);
      await copySignedBootFiles(source, join(volume, relative(drive, target)), entries, new AbortController().signal);
      for (const file of entries) assert.equal(await readFile(join(target, file), 'utf8'), file);
    } finally { await rm(dir, { recursive: true, force: true }); }
  });
  const body = { family: 'linux', imageId: 'ubuntu-desktop', persistent: false, targetName: 'USB', targetBytes: 10000, deviceId: '/dev/sdb' };
  it('keeps older clients in raw mode and rejects unsupported file-mode combinations', () => {
    assert.equal(parseCreateUsbRequest(body).linux?.writeMode, 'raw');
    assert.throws(() => parseCreateUsbRequest({ ...body, writeMode: 'invalid' }), /write mode/);
    assert.throws(() => parseCreateUsbRequest({ ...body, writeMode: 'iso', imageId: 'kali-installer' }), /ISO file mode/);
    for (const change of [{ persistent: true }, { imageId: 'ubuntu-server' }]) {
      assert.throws(() => parseCreateUsbRequest({ ...body, ...change, writeMode: 'signed-grub' }), /Signed GRUB mode/);
    }
    if (process.platform === 'win32') assert.equal(parseCreateUsbRequest({ ...body, writeMode: 'signed-grub' }).linux?.writeMode, 'signed-grub');
    else assert.throws(() => parseCreateUsbRequest({ ...body, writeMode: 'signed-grub' }), /Windows/);
    if (process.platform === 'win32') assert.equal(parseCreateUsbRequest({ ...body, writeMode: 'iso' }).linux?.writeMode, 'iso');
    else assert.throws(() => parseCreateUsbRequest({ ...body, writeMode: 'iso' }), /Windows helper/);
  });
  it('preflights the Ubuntu tree before copying its EFI, live and hidden files', async () => {
    const root = await mkdtemp(join(tmpdir(), 'osit-iso-test-'));
    const signal = new AbortController().signal;
    const target = await mkdtemp(join(tmpdir(), 'osit-fat-test-'));
    try {
      await assert.rejects(inspectUbuntuTree(root, 2 ** 30, signal), /bootx64/);
      for (const dir of ['EFI/BOOT', 'boot/grub', 'casper', '.disk']) await mkdir(join(root, dir), { recursive: true });
      for (const p of ['EFI/BOOT/BOOTX64.EFI', 'EFI/BOOT/grubx64.efi', 'boot/grub/grub.cfg', 'casper/vmlinuz', 'casper/initrd', '.disk/info'])
        await writeFile(join(root, p), p);
      await assert.rejects(inspectUbuntuTree(root, 1024, signal), /not fit/);
      await copyUbuntuTree(root, target, await inspectUbuntuTree(root, 2 ** 30, signal), signal, () => {});
      assert.equal(await readFile(join(target, '.disk/info'), 'utf8'), '.disk/info');
    } finally { await Promise.all([root, target].map(dir => rm(dir, { recursive: true, force: true }))); }
  });
  it('derives the source in the helper and refuses incompatible options or replacement devices', () => {
    const job = parseCreateUsbRequest(body);
    assert.equal(job.iso.kind, 'url');
    assert.throws(() => parseCreateUsbRequest({ ...body, iso: { url: 'https://example.org/fake.iso' } }), /official/);
    assert.throws(() => parseCreateUsbRequest({ ...body, imageId: 'ubuntu-server', persistent: true }), /Persistence/);
    if (process.platform === 'win32')
      assert.throws(() => parseCreateUsbRequest({ ...body, persistent: true }), /portable Windows helper/);
    else assert.equal(parseCreateUsbRequest({ ...body, persistent: true }).linux?.persistent, true);
    assert.throws(() => checkLinuxTarget({ id: body.deviceId, bus: 'usb', removable: true, isSystem: false, mountPoints: [],
      description: 'Replacement', sizeBytes: body.targetBytes }, job.linux!), /no longer matches/);
  });
  it('only modifies Casper kernel lines and rejects unknown boot layouts', () => {
    assert.equal(enableCasperPersistence(' linux /casper/vmlinuz ---\ninitrd /casper/initrd'), ' linux /casper/vmlinuz persistent ---\ninitrd /casper/initrd');
    assert.throws(() => enableCasperPersistence('linux /boot/vmlinuz'), /unrecognized/);
  });
  it('checks capacity and cancellation before erasing; writes and verifies a multi-chunk image', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'osit-raw-test-'));
    const bytes = Buffer.alloc(5 * 1024 * 1024 + 512, 0x95);
    bytes[0] = 0xb2;
    const hash = createHash('sha256').update(bytes).digest('hex');
    const source = await open(join(dir, 'source'), 'wx+');
    const target = await open(join(dir, 'target'), 'wx+');
    const signal = new AbortController().signal;
    try {
      await source.writeFile(bytes);
      await assert.rejects(writeAndVerifyImage(source, target, bytes.length, 512, hash, signal, () => {}), /too large/);
      await assert.rejects(writeAndVerifyImage(source, target, bytes.length, bytes.length, hash, AbortSignal.abort(), () => {}));
      assert.equal((await target.stat()).size, 0);
      await writeAndVerifyImage(source, target, bytes.length, bytes.length, hash, signal, () => {});
      await assert.rejects(writeAndVerifyImage(source, target, bytes.length, bytes.length, 'bad digest', signal, () => {}), /read-back/);
    } finally {
      await Promise.all([source.close(), target.close()]);
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe('windows disk parsing', () => {
  const payload = {
    disks: [
      { Number: 0, FriendlyName: 'Samsung SSD 990', Size: '2000398934016', BusType: 'NVMe', IsSystem: true, IsBoot: true, Mounts: ['C:'] },
      { Number: 2, FriendlyName: 'SanDisk Ultra USB', Size: '61530439680', BusType: 'USB', IsSystem: false, IsBoot: false, Mounts: ['E:'] },
    ],
  };

  it('maps disks to device paths and bus types', () => {
    const devices = parseWindowsDisks(payload);
    assert.equal(devices.length, 2);
    assert.equal(devices[1]!.id, '\\\\.\\PHYSICALDRIVE2');
    assert.equal(devices[1]!.bus, 'usb');
    assert.equal(devices[1]!.removable, true);
    assert.equal(devices[0]!.bus, 'internal');
    assert.equal(devices[0]!.isSystem, true);
  });

  it('handles PowerShell collapsing a single disk into an object', () => {
    const devices = parseWindowsDisks({ disks: payload.disks[1] });
    assert.equal(devices.length, 1);
    assert.equal(devices[0]!.sizeBytes, 61530439680);
  });

  it('extracts the disk number needed by the storage cmdlets', () => {
    assert.equal(windowsDiskNumber('\\\\.\\PHYSICALDRIVE12'), 12);
    assert.throws(() => windowsDiskNumber('/dev/sdb'), /physical drive/i);
  });
});

describe('linux disk parsing', () => {
  const payload = {
    blockdevices: [
      { name: 'sda', path: '/dev/sda', size: 512110190592, type: 'disk', tran: 'sata', rm: false, mountpoints: [null], children: [{ name: 'sda1', mountpoints: ['/'] }] },
      { name: 'sdb', path: '/dev/sdb', size: 30752636928, type: 'disk', tran: 'usb', rm: true, vendor: 'SanDisk ', model: 'Ultra ', mountpoints: ['/media/usb'] },
      { name: 'loop0', path: '/dev/loop0', size: 100, type: 'loop' },
    ],
  };

  it('keeps only whole disks and detects the system disk', () => {
    const devices = parseLsblk(payload);
    assert.equal(devices.length, 2);
    assert.equal(devices[0]!.isSystem, true);
    assert.equal(devices[1]!.isSystem, false);
    assert.equal(devices[1]!.bus, 'usb');
    assert.equal(devices[1]!.description, 'SanDisk Ultra');
  });

  it('names partitions correctly for both naming schemes', () => {
    assert.equal(partitionPath('/dev/sdb', 1), '/dev/sdb1');
    assert.equal(partitionPath('/dev/nvme0n1', 1), '/dev/nvme0n1p1');
    assert.equal(partitionPath('/dev/mmcblk0', 2), '/dev/mmcblk0p2');
  });
});

describe('macos disk parsing', () => {
  const plist = `<plist><dict>
    <key>DeviceIdentifier</key><string>disk4</string>
    <key>DeviceNode</key><string>/dev/disk4</string>
    <key>MediaName</key><string>SanDisk Extreme</string>
    <key>TotalSize</key><integer>64023257088</integer>
    <key>BusProtocol</key><string>USB</string>
    <key>Internal</key><false/>
    <key>RemovableMediaOrExternalDevice</key><true/>
  </dict></plist>`;

  it('reads the keys the tool cares about', () => {
    const device = parseDiskutilPlist(plist, 'disk4');
    assert.equal(device.id, '/dev/disk4');
    assert.equal(device.description, 'SanDisk Extreme');
    assert.equal(device.sizeBytes, 64023257088);
    assert.equal(device.bus, 'usb');
    assert.equal(device.removable, true);
    assert.equal(device.isSystem, false);
  });
});

describe('target safety checks', () => {
  const usb: UsbDevice = {
    id: '\\\\.\\PHYSICALDRIVE2',
    description: 'SanDisk Ultra USB',
    sizeBytes: 61530439680,
    bus: 'usb',
    removable: true,
    isSystem: false,
    mountPoints: ['E:'],
  };
  const systemDisk: UsbDevice = { ...usb, id: '\\\\.\\PHYSICALDRIVE0', description: 'Samsung SSD', bus: 'internal', removable: false, isSystem: true };

  it('accepts a plain removable stick', () => {
    assert.doesNotThrow(() => assertSafeTarget(usb, { requireRemovable: true }));
  });

  it('never lets the system disk be erased, even with checks relaxed', () => {
    assert.throws(() => assertSafeTarget(systemDisk, { requireRemovable: false }), /runs from/);
  });

  it('refuses a fixed disk unless the removable check is turned off', () => {
    const external = { ...systemDisk, isSystem: false };
    assert.throws(() => assertSafeTarget(external, { requireRemovable: true }), /removable/);
    assert.doesNotThrow(() => assertSafeTarget(external, { requireRemovable: false }));
  });

  it('rejects a device that reports no media', () => {
    assert.throws(() => assertSafeTarget({ ...usb, sizeBytes: 0 }, { requireRemovable: true }), /no media/);
  });

  it('rejects a device that has gone away', () => {
    assert.throws(() => assertSafeTarget(undefined, { requireRemovable: true }), /no longer connected/);
    assert.equal(findDevice([usb], '\\\\.\\physicaldrive2')?.id, usb.id);
  });
});

describe('pairing code', () => {
  it('generates a readable grouped code', () => {
    const code = generatePairingCode();
    assert.match(code, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    assert.equal(normalizeCode(code).length, 12);
  });

  it('compares codes ignoring case, spaces and dashes', () => {
    assert.equal(codesMatch('ABCD-EFGH-JKLM', 'abcdefghjklm'), true);
    assert.equal(codesMatch('ABCD-EFGH-JKLM', 'abcd efgh jklm'), true);
    assert.equal(codesMatch('ABCD-EFGH-JKLM', 'ABCD-EFGH-JKLN'), false);
    assert.equal(codesMatch('ABCD-EFGH-JKLM', ''), false);
    assert.equal(codesMatch('ABCD-EFGH-JKLM', undefined), false);
  });

  it('trusts localhost pages and the official site, nothing else', () => {
    assert.equal(isAllowedOrigin('http://localhost:5173'), true);
    assert.equal(isAllowedOrigin('http://127.0.0.1:5178'), true);
    assert.equal(isAllowedOrigin('https://os.brionicx.com'), true);
    assert.equal(isAllowedOrigin(undefined), true);
    assert.equal(isAllowedOrigin('https://evil.example'), false);
    // A lookalike host must not be accepted just because it contains the name.
    assert.equal(isAllowedOrigin('https://os.brionicx.com.evil.example'), false);
    assert.equal(isAllowedOrigin('http://os.brionicx.com'), false);
    assert.equal(isAllowedOrigin('https://evil.example', ['https://evil.example']), true);
  });
});

describe('request validation', () => {
  const base = {
    deviceId: '\\\\.\\PHYSICALDRIVE2',
    iso: { kind: 'url', url: 'https://software.download.prss.microsoft.com/x/Win11.iso', fileName: 'Win11.iso' },
    plan: { injectedFiles: [{ path: 'autounattend.xml', content: '<x/>', encoding: 'utf8', purpose: 'test' }], removedPaths: [], summary: [], warnings: [] },
    volumeLabel: 'WIN11',
  };

  it('accepts a well formed request and defaults the removable check to on', () => {
    const parsed = parseCreateUsbRequest(base);
    assert.equal(parsed.requireRemovable, true);
    assert.equal(parsed.plan.injectedFiles.length, 1);
  });

  it('does not keep the downloaded ISO unless asked to', () => {
    assert.equal(parseCreateUsbRequest(base).keepIso, false);
    assert.equal(parseCreateUsbRequest({ ...base, keepIso: true }).keepIso, true);
    // Anything other than a real true must not be read as consent to keep it.
    assert.equal(parseCreateUsbRequest({ ...base, keepIso: 'yes' }).keepIso, false);
    assert.equal(parseCreateUsbRequest({ ...base, keepIso: 1 }).keepIso, false);
  });

  it('rejects non-https ISO URLs', () => {
    assert.throws(() => parseCreateUsbRequest({ ...base, iso: { ...base.iso, url: 'http://example.com/a.iso' } }), RequestValidationError);
  });

  it('rejects ISO URLs aimed at private addresses', () => {
    for (const host of ['http://localhost/a.iso', 'https://127.0.0.1/a.iso', 'https://192.168.1.5/a.iso', 'https://10.0.0.1/a.iso', 'https://169.254.169.254/a.iso']) {
      assert.throws(() => parseCreateUsbRequest({ ...base, iso: { ...base.iso, url: host } }), RequestValidationError, host);
    }
  });

  it('rejects an unknown text encoding', () => {
    const plan = { ...base.plan, injectedFiles: [{ path: 'a.txt', content: 'x', encoding: 'binary', purpose: '' }] };
    assert.throws(() => parseCreateUsbRequest({ ...base, plan }), RequestValidationError);
  });

  it('strips path separators from the download file name', () => {
    assert.equal(sanitizeFileName('../../etc/passwd'), 'etcpasswd');
    assert.equal(sanitizeFileName('Win11_25H2_English_x64.iso'), 'Win11_25H2_English_x64.iso');
    assert.equal(sanitizeFileName('...'), 'image.iso');
  });
});

describe('plan application', () => {
  let root = '';

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'osit-test-'));
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('refuses to escape the USB root, whatever the host separator is', () => {
    const hostile = [
      '../evil.txt',
      '..\\evil.txt',
      '/etc/passwd',
      '\\\\server\\share\\evil.txt',
      'C:\\Windows\\evil.txt',
      'c:/windows/evil.txt',
      'a/../../b',
      'a\\..\\..\\b',
      'sources/../../evil.txt',
      './../evil.txt',
      '..',
      '.',
      '',
    ];
    for (const bad of hostile) {
      assert.throws(() => resolveWithinRoot(root, bad), UnsafePathError, bad);
    }
  });

  it('accepts backslash separated paths as ordinary nested paths', () => {
    const resolved = resolveWithinRoot(root, 'sources\\$OEM$\\$$\\Setup\\Scripts\\SetupComplete.cmd');
    assert.ok(resolved.startsWith(root));
    assert.ok(resolved.endsWith('SetupComplete.cmd'));
  });

  it('resolves ordinary nested paths', () => {
    const resolved = resolveWithinRoot(root, 'sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd');
    assert.ok(resolved.startsWith(root));
    assert.ok(resolved.endsWith('SetupComplete.cmd'));
  });

  it('writes injected files and deletes removed ones', async () => {
    await mkdir(join(root, 'sources'), { recursive: true });
    await writeFile(join(root, 'sources', 'ei.cfg'), 'Professional');

    const messages: string[] = [];
    const result = await applyPlan(
      root,
      {
        injectedFiles: [
          { path: 'autounattend.xml', content: '<unattend/>', encoding: 'utf8', purpose: 'answers setup' },
          { path: 'OSIT/SetupComplete.cmd', content: '@echo off', encoding: 'utf8', purpose: 'post setup' },
        ],
        removedPaths: [
          { path: 'sources/ei.cfg', purpose: 'show the edition picker' },
          { path: 'sources/not-there.cfg', purpose: 'missing files are fine' },
        ],
        summary: [],
        bootSteps: [],
        warnings: [],
      },
      (message) => messages.push(message),
    );

    assert.deepEqual(result.written, ['autounattend.xml', 'OSIT/SetupComplete.cmd']);
    assert.deepEqual(result.removed, ['sources/ei.cfg']);
    assert.equal(await readFile(join(root, 'autounattend.xml'), 'utf8'), '<unattend/>');
    assert.equal(await readFile(join(root, 'OSIT', 'SetupComplete.cmd'), 'utf8'), '@echo off');
    assert.ok(messages.some((m) => m.includes('Removed sources/ei.cfg')));
  });
});

describe('volume labels', () => {
  it('fits the FAT32 rules', () => {
    assert.equal(sanitizeVolumeLabel('Windows 11 Installer'), 'WINDOWS11IN');
    assert.equal(sanitizeVolumeLabel('win-11_usb'), 'WIN-11_USB');
    assert.equal(sanitizeVolumeLabel('!!!'), 'INSTALLER');
  });
});
