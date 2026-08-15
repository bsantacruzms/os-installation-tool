import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
