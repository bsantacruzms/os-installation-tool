import type { Arch, WindowsBuildConfig } from '../types.js';
import { el, leaf, renderXml, type XmlChild, type XmlNode } from '../xml.js';
import { findEdition } from './editions.js';
import { obfuscatePassword } from './password.js';

const WCM = 'http://schemas.microsoft.com/WMIConfig/2002/State';
const XSI = 'http://www.w3.org/2001/XMLSchema-instance';
const PUBLIC_KEY_TOKEN = '31bf3856ad364e35';

/** Path of the post-setup script, relative to the USB root. */
export const SETUP_SCRIPT_USB_PATH = 'sources/$OEM$/$$/Setup/Scripts/SetupComplete.cmd';
/** Where Windows Setup copies that script to on the installed system. */
export const SETUP_SCRIPT_INSTALLED_PATH = 'C:\\Windows\\Setup\\Scripts\\SetupComplete.cmd';

function peArch(arch: Arch): string {
  return arch === 'arm64' ? 'arm64' : 'amd64';
}

function component(name: string, arch: Arch, ...children: XmlChild[]): XmlNode {
  return el(
    'component',
    {
      name,
      processorArchitecture: peArch(arch),
      publicKeyToken: PUBLIC_KEY_TOKEN,
      language: 'neutral',
      versionScope: 'nonSxS',
    },
    ...children,
  );
}

function passwordNode(tag: 'Password' | 'AdministratorPassword', password: string): XmlNode {
  return el(
    tag,
    undefined,
    leaf('Value', password.length === 0 ? '' : obfuscatePassword(password, tag)),
    leaf('PlainText', 'false'),
  );
}

interface RegCommand {
  description: string;
  command: string;
}

function regAdd(key: string, name: string, type: string, value: string | number): string {
  return `reg.exe add "${key}" /v ${name} /t ${type} /d ${value} /f`;
}

function hardwareBypassCommands(): RegCommand[] {
  const lab = 'HKLM\\SYSTEM\\Setup\\LabConfig';
  return [
    { description: 'Allow install without a TPM 2.0 module', command: regAdd(lab, 'BypassTPMCheck', 'REG_DWORD', 1) },
    { description: 'Allow install without Secure Boot', command: regAdd(lab, 'BypassSecureBootCheck', 'REG_DWORD', 1) },
    { description: 'Allow install with less than 4 GB of RAM', command: regAdd(lab, 'BypassRAMCheck', 'REG_DWORD', 1) },
    { description: 'Allow install on a smaller disk', command: regAdd(lab, 'BypassStorageCheck', 'REG_DWORD', 1) },
    { description: 'Allow install on an unsupported CPU', command: regAdd(lab, 'BypassCPUCheck', 'REG_DWORD', 1) },
    {
      description: 'Allow upgrades on unsupported TPM or CPU',
      command: regAdd('HKLM\\SYSTEM\\Setup\\MoSetup', 'AllowUpgradesWithUnsupportedTPMOrCPU', 'REG_DWORD', 1),
    },
  ];
}

function runSynchronous(commands: RegCommand[], withCredentials: boolean): XmlNode | null {
  if (commands.length === 0) return null;
  return el(
    'RunSynchronous',
    undefined,
    ...commands.map((c, index) =>
      el(
        'RunSynchronousCommand',
        { 'wcm:action': 'add' },
        leaf('Description', c.description),
        leaf('Order', index + 1),
        leaf('Path', withCredentials ? c.command : c.command),
      ),
    ),
  );
}

function diskConfiguration(config: WindowsBuildConfig): XmlNode | null {
  const disk = config.setup.disk;
  if (disk.kind !== 'wipe-disk') return null;

  const recoveryMb = Math.max(0, disk.recoveryPartitionMb);
  const hasRecovery = recoveryMb > 0;

  const creates: XmlNode[] = [
    el('CreatePartition', { 'wcm:action': 'add' }, leaf('Order', 1), leaf('Type', 'EFI'), leaf('Size', 300)),
    el('CreatePartition', { 'wcm:action': 'add' }, leaf('Order', 2), leaf('Type', 'MSR'), leaf('Size', 16)),
  ];
  const modifies: XmlNode[] = [
    el(
      'ModifyPartition',
      { 'wcm:action': 'add' },
      leaf('Order', 1),
      leaf('PartitionID', 1),
      leaf('Format', 'FAT32'),
      leaf('Label', 'System'),
    ),
    el('ModifyPartition', { 'wcm:action': 'add' }, leaf('Order', 2), leaf('PartitionID', 2)),
  ];

  if (hasRecovery) {
    creates.push(el('CreatePartition', { 'wcm:action': 'add' }, leaf('Order', 3), leaf('Type', 'Primary'), leaf('Extend', 'true')));
    creates.push(el('CreatePartition', { 'wcm:action': 'add' }, leaf('Order', 4), leaf('Type', 'Primary'), leaf('Size', recoveryMb)));
    modifies.push(
      el(
        'ModifyPartition',
        { 'wcm:action': 'add' },
        leaf('Order', 3),
        leaf('PartitionID', 3),
        leaf('Format', 'NTFS'),
        leaf('Label', 'Windows'),
        leaf('Letter', 'C'),
      ),
    );
    modifies.push(
      el(
        'ModifyPartition',
        { 'wcm:action': 'add' },
        leaf('Order', 4),
        leaf('PartitionID', 4),
        leaf('Format', 'NTFS'),
        leaf('Label', 'Recovery'),
        leaf('TypeID', 'DE94BBA4-06D1-4D40-A16A-BFD50179D6AC'),
      ),
    );
  } else {
    creates.push(el('CreatePartition', { 'wcm:action': 'add' }, leaf('Order', 3), leaf('Type', 'Primary'), leaf('Extend', 'true')));
    modifies.push(
      el(
        'ModifyPartition',
        { 'wcm:action': 'add' },
        leaf('Order', 3),
        leaf('PartitionID', 3),
        leaf('Format', 'NTFS'),
        leaf('Label', 'Windows'),
        leaf('Letter', 'C'),
      ),
    );
  }

  return el(
    'DiskConfiguration',
    undefined,
    leaf('WillShowUI', 'OnError'),
    el(
      'Disk',
      { 'wcm:action': 'add' },
      leaf('DiskID', disk.diskId),
      leaf('WillWipeDisk', 'true'),
      el('CreatePartitions', undefined, ...creates),
      el('ModifyPartitions', undefined, ...modifies),
    ),
  );
}

function imageInstall(config: WindowsBuildConfig): XmlNode | null {
  const preselect = config.image.edition.kind === 'preselect' ? findEdition(config.image.edition.editionId) : undefined;
  const wipe = config.setup.disk.kind === 'wipe-disk';
  if (!preselect && !wipe) return null;

  const osImage: XmlChild[] = [];
  if (preselect) {
    osImage.push(
      el(
        'InstallFrom',
        undefined,
        el('MetaData', { 'wcm:action': 'add' }, leaf('Key', '/IMAGE/NAME'), leaf('Value', preselect.imageName)),
      ),
    );
  }
  if (wipe) {
    osImage.push(el('InstallTo', undefined, leaf('DiskID', config.setup.disk.kind === 'wipe-disk' ? config.setup.disk.diskId : 0), leaf('PartitionID', 3)));
  }
  osImage.push(leaf('WillShowUI', 'OnError'));

  return el('ImageInstall', undefined, el('OSImage', undefined, ...osImage));
}

function userData(config: WindowsBuildConfig): XmlNode {
  const preselect = config.image.edition.kind === 'preselect' ? findEdition(config.image.edition.editionId) : undefined;
  const children: XmlChild[] = [];
  if (preselect) {
    children.push(el('ProductKey', undefined, leaf('Key', preselect.genericKey), leaf('WillShowUI', 'OnError')));
  }
  children.push(leaf('AcceptEula', 'true'));
  return el('UserData', undefined, ...children);
}

function windowsPeSettings(config: WindowsBuildConfig): XmlNode {
  const arch = config.image.arch;
  const setupChildren: XmlChild[] = [
    el('ComplianceCheck', undefined, leaf('DisplayReport', 'Never')),
    diskConfiguration(config),
    imageInstall(config),
    config.setup.bypassRequirements ? runSynchronous(hardwareBypassCommands(), false) : null,
    userData(config),
  ];

  return el(
    'settings',
    { pass: 'windowsPE' },
    component(
      'Microsoft-Windows-International-Core-WinPE',
      arch,
      leaf('InputLocale', config.region.inputLocale),
      el('SetupUILanguage', undefined, leaf('UILanguage', config.region.uiLanguage)),
      leaf('SystemLocale', config.region.userLocale),
      leaf('UILanguage', config.region.uiLanguage),
      leaf('UserLocale', config.region.userLocale),
    ),
    component('Microsoft-Windows-Setup', arch, ...setupChildren),
  );
}

function specializeCommands(config: WindowsBuildConfig): RegCommand[] {
  const commands: RegCommand[] = [
    {
      // Belt and braces: `sources\$OEM$` normally delivers these, but some media
      // layouts skip it, so also pull them straight off the installer stick.
      description: 'Copy post-setup scripts from the installer media',
      command:
        'cmd.exe /c for %d in (D E F G H I J K L M N O P Q R S T U V W X Y Z) do ' +
        '@if exist "%d:\\OSIT\\SetupComplete.cmd" xcopy /y /e /i "%d:\\OSIT\\*" "%SystemRoot%\\Setup\\Scripts\\"',
    },
  ];

  if (config.setup.bypassNetworkRequirement) {
    commands.push({
      description: 'Allow finishing setup without an internet connection',
      command: regAdd('HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\OOBE', 'BypassNRO', 'REG_DWORD', 1),
    });
  }
  if (config.account.skipSecurityQuestions) {
    commands.push({
      description: 'Do not demand password reset security questions',
      command: regAdd('HKLM\\SOFTWARE\\Policies\\Microsoft\\Windows\\System', 'NoLocalPasswordResetQuestions', 'REG_DWORD', 1),
    });
  }
  if (config.setup.bypassRequirements) {
    commands.push({
      description: 'Keep the unsupported hardware shims after the first reboot',
      command: regAdd('HKLM\\SYSTEM\\Setup\\MoSetup', 'AllowUpgradesWithUnsupportedTPMOrCPU', 'REG_DWORD', 1),
    });
  }
  return commands;
}

function specializeSettings(config: WindowsBuildConfig): XmlNode | null {
  const arch = config.image.arch;
  const commands = specializeCommands(config);
  const computerName = config.setup.computerName.trim();
  const timeZone = config.region.timeZone.trim();

  const shellChildren: XmlChild[] = [];
  if (computerName.length > 0) shellChildren.push(leaf('ComputerName', computerName));
  if (timeZone.length > 0) shellChildren.push(leaf('TimeZone', timeZone));

  const components: XmlChild[] = [];
  if (shellChildren.length > 0) components.push(component('Microsoft-Windows-Shell-Setup', arch, ...shellChildren));
  if (commands.length > 0) components.push(component('Microsoft-Windows-Deployment', arch, runSynchronous(commands, true)));
  if (components.length === 0) return null;

  return el('settings', { pass: 'specialize' }, ...components);
}

function oobeNode(config: WindowsBuildConfig): XmlNode {
  const children: XmlChild[] = [];
  if (config.setup.skipOobe) {
    children.push(leaf('HideEULAPage', 'true'));
    children.push(leaf('HideOEMRegistrationScreen', 'true'));
  }
  if (config.setup.skipMicrosoftAccount) {
    children.push(leaf('HideLocalAccountScreen', 'true'));
    children.push(leaf('HideOnlineAccountScreens', 'true'));
  }
  if (config.setup.skipOobe && !config.wifi.enabled) {
    children.push(leaf('HideWirelessSetupInOOBE', 'true'));
  }
  // 3 = do not turn on "recommended" settings, which is the privacy-preserving choice.
  children.push(leaf('ProtectYourPC', config.setup.disableExpressSettings ? 3 : 1));
  return el('OOBE', undefined, ...children);
}

function firstLogonCommands(config: WindowsBuildConfig): XmlNode | null {
  const commands: Array<{ command: string; description: string }> = [];

  if (config.wifi.enabled && config.wifi.ssid.trim().length > 0) {
    commands.push({
      command: 'cmd.exe /c netsh wlan add profile filename="C:\\Windows\\Setup\\Scripts\\wifi.xml" user=all',
      description: 'Import the pre-configured Wi-Fi network',
    });
    commands.push({
      command: `cmd.exe /c netsh wlan connect name="${config.wifi.ssid.trim()}"`,
      description: 'Connect to the pre-configured Wi-Fi network',
    });
  }

  for (const extra of config.extraSetupCommands) {
    const trimmed = extra.trim();
    if (trimmed.length > 0) commands.push({ command: trimmed, description: 'User supplied command' });
  }

  if (commands.length === 0) return null;

  return el(
    'FirstLogonCommands',
    undefined,
    ...commands.map((c, index) =>
      el(
        'SynchronousCommand',
        { 'wcm:action': 'add' },
        leaf('Order', index + 1),
        leaf('CommandLine', c.command),
        leaf('Description', c.description),
        leaf('RequiresUserInput', 'false'),
      ),
    ),
  );
}

function oobeSystemSettings(config: WindowsBuildConfig): XmlNode {
  const arch = config.image.arch;
  const username = config.account.username.trim();
  const children: XmlChild[] = [];

  if (config.account.autoLogon && username.length > 0) {
    children.push(
      el(
        'AutoLogon',
        undefined,
        passwordNode('Password', config.account.password),
        leaf('Enabled', 'true'),
        leaf('LogonCount', Math.max(1, config.account.autoLogonCount)),
        leaf('Username', username),
      ),
    );
  }

  children.push(firstLogonCommands(config));
  children.push(oobeNode(config));

  if (username.length > 0) {
    children.push(
      el(
        'UserAccounts',
        undefined,
        el(
          'LocalAccounts',
          undefined,
          el(
            'LocalAccount',
            { 'wcm:action': 'add' },
            passwordNode('Password', config.account.password),
            leaf('Description', 'Local account created by the OS Installation Tool'),
            leaf('DisplayName', username),
            leaf('Group', config.account.administrator ? 'Administrators' : 'Users'),
            leaf('Name', username),
          ),
        ),
      ),
    );
  }

  const international = component(
    'Microsoft-Windows-International-Core',
    arch,
    leaf('InputLocale', config.region.inputLocale),
    leaf('SystemLocale', config.region.userLocale),
    leaf('UILanguage', config.region.uiLanguage),
    leaf('UserLocale', config.region.userLocale),
  );

  return el('settings', { pass: 'oobeSystem' }, component('Microsoft-Windows-Shell-Setup', arch, ...children), international);
}

/** Builds the `autounattend.xml` that Windows Setup picks up from the USB root. */
export function buildAutounattendXml(config: WindowsBuildConfig): string {
  const root = el(
    'unattend',
    {
      xmlns: 'urn:schemas-microsoft-com:unattend',
      'xmlns:wcm': WCM,
      'xmlns:xsi': XSI,
    },
    windowsPeSettings(config),
    specializeSettings(config),
    oobeSystemSettings(config),
  );
  return renderXml(root);
}

/** Profile consumed by `netsh wlan add profile`. */
export function buildWifiProfileXml(ssid: string, password: string, hidden: boolean): string {
  const ssidHex = Array.from(new TextEncoder().encode(ssid))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

  const security =
    password.length > 0
      ? el(
          'security',
          undefined,
          el('authEncryption', undefined, leaf('authentication', 'WPA2PSK'), leaf('encryption', 'AES'), leaf('useOneX', 'false')),
          el('sharedKey', undefined, leaf('keyType', 'passPhrase'), leaf('protected', 'false'), leaf('keyMaterial', password)),
        )
      : el('security', undefined, el('authEncryption', undefined, leaf('authentication', 'open'), leaf('encryption', 'none'), leaf('useOneX', 'false')));

  const root = el(
    'WLANProfile',
    { xmlns: 'http://www.microsoft.com/networking/WLAN/profile/v1' },
    leaf('name', ssid),
    el('SSIDConfig', undefined, el('SSID', undefined, leaf('hex', ssidHex), leaf('name', ssid)), hidden ? leaf('nonBroadcast', 'true') : null),
    leaf('connectionType', 'ESS'),
    leaf('connectionMode', 'auto'),
    el('MSM', undefined, security),
  );
  return renderXml(root);
}
