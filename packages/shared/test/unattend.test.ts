import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { defaultWindowsConfig } from '../src/windows/defaults.js';
import { buildAutounattendXml, buildWifiProfileXml } from '../src/windows/unattend.js';
import { buildSetupCompleteScript } from '../src/windows/scripts.js';
import { buildWindowsPlan } from '../src/windows/plan.js';
import { validateWindowsConfig, hasErrors } from '../src/windows/validate.js';
import { obfuscatePassword } from '../src/windows/password.js';
import { findEdition } from '../src/windows/editions.js';
import type { WindowsBuildConfig } from '../src/types.js';

function config(overrides: (c: WindowsBuildConfig) => void = () => {}): WindowsBuildConfig {
  const c = defaultWindowsConfig('advanced');
  c.account.username = 'brian';
  overrides(c);
  return c;
}

describe('password obfuscation', () => {
  it('matches the base64 UTF-16LE + element-name scheme Windows expects', () => {
    const encoded = obfuscatePassword('p@ssw0rd', 'Password');
    const decoded = Buffer.from(encoded, 'base64').toString('utf16le');
    assert.equal(decoded, 'p@ssw0rdPassword');
  });

  it('appends AdministratorPassword for the administrator element', () => {
    const decoded = Buffer.from(obfuscatePassword('abc', 'AdministratorPassword'), 'base64').toString('utf16le');
    assert.equal(decoded, 'abcAdministratorPassword');
  });

  it('handles non-ASCII characters', () => {
    const decoded = Buffer.from(obfuscatePassword('pässwörd€', 'Password'), 'base64').toString('utf16le');
    assert.equal(decoded, 'pässwörd€Password');
  });
});

describe('autounattend.xml', () => {
  it('creates the requested local administrator account', () => {
    const xml = buildAutounattendXml(config((c) => { c.account.password = 'hunter2'; }));
    assert.match(xml, /<Name>brian<\/Name>/);
    assert.match(xml, /<Group>Administrators<\/Group>/);
    assert.match(xml, /<LocalAccount wcm:action="add">/);
    assert.equal(Buffer.from(/<Password>\s*<Value>([^<]*)<\/Value>/.exec(xml)![1]!, 'base64').toString('utf16le'), 'hunter2Password');
  });

  it('hides the Microsoft account screens and declines express settings', () => {
    const xml = buildAutounattendXml(config());
    assert.match(xml, /<HideOnlineAccountScreens>true<\/HideOnlineAccountScreens>/);
    assert.match(xml, /<HideLocalAccountScreen>true<\/HideLocalAccountScreen>/);
    assert.match(xml, /<ProtectYourPC>3<\/ProtectYourPC>/);
  });

  it('adds the BypassNRO switch so setup finishes offline', () => {
    const xml = buildAutounattendXml(config());
    assert.match(xml, /BypassNRO/);
  });

  it('emits the hardware bypass keys only when requested', () => {
    assert.match(buildAutounattendXml(config()), /BypassTPMCheck/);
    const without = buildAutounattendXml(config((c) => { c.setup.bypassRequirements = false; }));
    assert.doesNotMatch(without, /BypassTPMCheck/);
  });

  it('pins the edition and its generic key when one is preselected', () => {
    const xml = buildAutounattendXml(config((c) => { c.image.edition = { kind: 'preselect', editionId: 'pro' }; }));
    assert.match(xml, /<Value>Windows 11 Pro<\/Value>/);
    assert.match(xml, new RegExp(findEdition('pro')!.genericKey));
  });

  it('omits the product key when the edition is chosen at install time', () => {
    const xml = buildAutounattendXml(config());
    assert.doesNotMatch(xml, /<ProductKey>/);
    assert.doesNotMatch(xml, /<ImageInstall>/);
  });

  it('only wipes a disk when explicitly asked to', () => {
    assert.doesNotMatch(buildAutounattendXml(config()), /WillWipeDisk/);
    const xml = buildAutounattendXml(config((c) => { c.setup.disk = { kind: 'wipe-disk', diskId: 0, recoveryPartitionMb: 750 }; }));
    assert.match(xml, /<WillWipeDisk>true<\/WillWipeDisk>/);
    assert.match(xml, /<Type>EFI<\/Type>/);
    assert.match(xml, /<Type>MSR<\/Type>/);
    assert.match(xml, /<Label>Recovery<\/Label>/);
    assert.match(xml, /<Letter>C<\/Letter>/);
  });

  it('escapes XML metacharacters coming from user input', () => {
    const xml = buildAutounattendXml(config((c) => {
      c.account.username = 'a<b>&c';
      c.setup.computerName = 'PC&1';
    }));
    assert.match(xml, /<Name>a&lt;b&gt;&amp;c<\/Name>/);
    assert.match(xml, /<ComputerName>PC&amp;1<\/ComputerName>/);
    assert.doesNotMatch(xml, /<Name>a<b>/);
  });

  it('uses the arm64 component architecture for arm64 images', () => {
    const xml = buildAutounattendXml(config((c) => { c.image.arch = 'arm64'; }));
    assert.match(xml, /processorArchitecture="arm64"/);
    assert.doesNotMatch(xml, /processorArchitecture="amd64"/);
  });

  it('only enables automatic sign-in when asked', () => {
    assert.doesNotMatch(buildAutounattendXml(config()), /<AutoLogon>/);
    const xml = buildAutounattendXml(config((c) => { c.account.autoLogon = true; c.account.autoLogonCount = 3; }));
    assert.match(xml, /<AutoLogon>/);
    assert.match(xml, /<LogonCount>3<\/LogonCount>/);
  });

  it('is well formed enough to have balanced settings passes', () => {
    const xml = buildAutounattendXml(config());
    assert.equal((xml.match(/<settings /g) ?? []).length, 3);
    assert.equal((xml.match(/<\/settings>/g) ?? []).length, 3);
    assert.match(xml, /pass="windowsPE"/);
    assert.match(xml, /pass="specialize"/);
    assert.match(xml, /pass="oobeSystem"/);
  });
});

describe('SetupComplete.cmd', () => {
  it('loads and unloads the default user hive exactly once', () => {
    const script = buildSetupCompleteScript(config());
    assert.equal((script.match(/reg\.exe load /g) ?? []).length, 1);
    assert.equal((script.match(/reg\.exe unload /g) ?? []).length, 1);
  });

  it('applies the recommended telemetry and advertising policies', () => {
    const script = buildSetupCompleteScript(config());
    assert.match(script, /DataCollection.*AllowTelemetry/);
    assert.match(script, /AdvertisingInfo.*DisabledByGroupPolicy/);
    assert.match(script, /TurnOffWindowsCopilot/);
  });

  it('skips privacy work entirely when every tweak is off', () => {
    const script = buildSetupCompleteScript(config((c) => { c.privacy = []; c.debloat.removeProvisionedApps = false; c.debloat.disableOneDriveSetup = false; }));
    assert.doesNotMatch(script, /reg\.exe add/);
    assert.match(script, /exit \/b 0/);
  });

  it('uses CRLF line endings so cmd.exe can parse it', () => {
    const script = buildSetupCompleteScript(config());
    assert.ok(script.includes('\r\n'));
    assert.doesNotMatch(script, /[^\r]\n/);
  });
});

describe('build plan', () => {
  it('injects the answer file and the post-setup scripts', () => {
    const plan = buildWindowsPlan(config());
    const paths = plan.injectedFiles.map((f) => f.path);
    assert.ok(paths.includes('autounattend.xml'));
    assert.ok(paths.includes('sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd'));
    assert.ok(paths.includes('OSIT/SetupComplete.cmd'));
    assert.ok(paths.includes('sources/$OEM$/$$/Setup/Scripts/Debloat.ps1'));
  });

  it('removes ei.cfg so the edition picker appears', () => {
    const plan = buildWindowsPlan(config());
    assert.deepEqual(plan.removedPaths.map((p) => p.path), ['sources/ei.cfg']);
  });

  it('keeps ei.cfg when a single edition is preselected', () => {
    const plan = buildWindowsPlan(config((c) => { c.image.edition = { kind: 'preselect', editionId: 'pro' }; }));
    assert.equal(plan.removedPaths.length, 0);
  });

  it('warns loudly before a destructive disk wipe', () => {
    const plan = buildWindowsPlan(config((c) => { c.setup.disk = { kind: 'wipe-disk', diskId: 1, recoveryPartitionMb: 0 }; }));
    assert.ok(plan.warnings.some((w) => w.includes('disk 1')));
  });

  it('adds a Wi-Fi profile only when Wi-Fi is configured', () => {
    assert.ok(!buildWindowsPlan(config()).injectedFiles.some((f) => f.path.endsWith('wifi.xml')));
    const plan = buildWindowsPlan(config((c) => { c.wifi = { enabled: true, ssid: 'Home', password: 'supersecret', hidden: false }; }));
    assert.ok(plan.injectedFiles.some((f) => f.path.endsWith('wifi.xml')));
    assert.ok(plan.warnings.some((w) => w.includes('Wi-Fi')));
  });
});

describe('boot walkthrough', () => {
  it('tells the user to clear the old partitions at the drive screen', () => {
    const steps = buildWindowsPlan(config()).bootSteps;
    assert.ok(steps.some((s) => /boot from it/i.test(s)));
    assert.ok(steps.some((s) => /delete every partition/i.test(s)));
    assert.ok(steps.some((s) => /unallocated space/i.test(s)));
  });

  it('does not promise a drive screen that automatic partitioning removes', () => {
    const steps = buildWindowsPlan(config((c) => { c.setup.disk = { kind: 'wipe-disk', diskId: 0, recoveryPartitionMb: 750 }; })).bootSteps;
    assert.ok(!steps.some((s) => /delete every partition/i.test(s)));
    assert.ok(steps.some((s) => /erases disk 0/i.test(s)));
  });

  it('mentions the edition prompt only when the edition is chosen at install time', () => {
    assert.ok(buildWindowsPlan(config()).bootSteps.some((s) => /edition/i.test(s)));
    const preselected = buildWindowsPlan(config((c) => { c.image.edition = { kind: 'preselect', editionId: 'pro' }; })).bootSteps;
    assert.ok(!preselected.some((s) => /Pick the edition/i.test(s)));
  });

  it('ends at the sign-in state the account settings actually produce', () => {
    assert.ok(buildWindowsPlan(config()).bootSteps.some((s) => s.includes('waits at the sign-in screen for "brian"')));
    const auto = buildWindowsPlan(config((c) => { c.account.autoLogon = true; })).bootSteps;
    assert.ok(auto.some((s) => s.includes('signs straight into "brian"')));
  });
});

describe('wifi profile', () => {
  it('encodes the SSID as hex and embeds the passphrase', () => {
    const xml = buildWifiProfileXml('MyNet', 'supersecret', false);
    assert.match(xml, /<hex>4D794E6574<\/hex>/);
    assert.match(xml, /<keyMaterial>supersecret<\/keyMaterial>/);
    assert.match(xml, /WPA2PSK/);
  });

  it('produces an open profile when there is no passphrase', () => {
    const xml = buildWifiProfileXml('Guest', '', true);
    assert.match(xml, /<authentication>open<\/authentication>/);
    assert.match(xml, /<nonBroadcast>true<\/nonBroadcast>/);
  });
});

describe('validation', () => {
  it('accepts a sensible default configuration', () => {
    assert.equal(hasErrors(validateWindowsConfig(config())), false);
  });

  it('requires a user name', () => {
    const issues = validateWindowsConfig(config((c) => { c.account.username = ''; }));
    assert.ok(issues.some((i) => i.field === 'account.username' && i.severity === 'error'));
  });

  it('rejects names Windows reserves', () => {
    for (const name of ['Administrator', 'guest', 'DefaultAccount']) {
      const issues = validateWindowsConfig(config((c) => { c.account.username = name; }));
      assert.ok(issues.some((i) => i.field === 'account.username' && i.severity === 'error'), name);
    }
  });

  it('rejects a PC name equal to the user name', () => {
    const issues = validateWindowsConfig(config((c) => { c.setup.computerName = 'brian'; }));
    assert.ok(issues.some((i) => i.field === 'setup.computerName' && i.severity === 'error'));
  });

  it('rejects illegal characters and over-long names', () => {
    assert.ok(hasErrors(validateWindowsConfig(config((c) => { c.account.username = 'bad\\name'; }))));
    assert.ok(hasErrors(validateWindowsConfig(config((c) => { c.account.username = 'x'.repeat(21); }))));
    assert.ok(hasErrors(validateWindowsConfig(config((c) => { c.setup.computerName = 'toolongcomputername'; }))));
  });

  it('rejects an edition that is not on the selected image', () => {
    const issues = validateWindowsConfig(config((c) => { c.image.edition = { kind: 'preselect', editionId: 'enterprise' }; }));
    assert.ok(issues.some((i) => i.field === 'image.edition' && i.severity === 'error'));
  });

  it('warns rather than fails for an empty password', () => {
    const issues = validateWindowsConfig(config((c) => { c.account.password = ''; }));
    assert.equal(hasErrors(issues), false);
    assert.ok(issues.some((i) => i.field === 'account.password' && i.severity === 'warning'));
  });

  it('rejects a too-short Wi-Fi passphrase', () => {
    const issues = validateWindowsConfig(config((c) => { c.wifi = { enabled: true, ssid: 'Net', password: 'short', hidden: false }; }));
    assert.ok(issues.some((i) => i.field === 'wifi.password' && i.severity === 'error'));
  });
});
