import type { WindowsBuildConfig } from '../types.js';
import { findPrivacyTweak, type RegistryOp } from './privacy.js';

/** Temporary mount point for `C:\Users\Default\NTUSER.DAT`. */
const DEFAULT_USER_HIVE = 'HKU\\OSIT_DEFAULT';

function batchQuote(value: string): string {
  // Batch has no escape for `"`, so a value containing one cannot be passed safely.
  return `"${value.replace(/"/g, '')}"`;
}

function regAddLine(op: RegistryOp): string {
  const root = op.hive === 'HKLM' ? 'HKLM' : DEFAULT_USER_HIVE;
  return `reg.exe add ${batchQuote(`${root}\\${op.key}`)} /v ${batchQuote(op.name)} /t ${op.type} /d ${batchQuote(String(op.value))} /f`;
}

export interface WindowsScripts {
  setupComplete: string;
  debloat: string | null;
}

/**
 * `SetupComplete.cmd` is run once by Windows Setup as SYSTEM, after the install
 * finishes and before the first sign-in. That is the earliest point at which the
 * installed registry is writable, which is why every tweak lives here rather
 * than in the unattend file.
 */
export function buildSetupCompleteScript(config: WindowsBuildConfig): string {
  const selected = config.privacy.map(findPrivacyTweak).filter((t): t is NonNullable<typeof t> => t !== undefined);

  const machineOps: RegistryOp[] = [];
  const defaultUserOps: RegistryOp[] = [];
  const commands: string[] = [];

  for (const tweak of selected) {
    for (const op of tweak.registry) {
      (op.hive === 'HKLM' ? machineOps : defaultUserOps).push(op);
    }
    for (const cmd of tweak.commands ?? []) commands.push(cmd);
  }

  if (config.debloat.disableOneDriveSetup) {
    commands.push('reg.exe delete "HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Run" /v OneDriveSetup /f');
  }

  const lines: string[] = [
    '@echo off',
    'setlocal EnableExtensions',
    'set "OSITLOG=%SystemRoot%\\Temp\\osit-setup.log"',
    'echo ===== OS Installation Tool: post-setup configuration =====>>"%OSITLOG%"',
    'echo Started %DATE% %TIME%>>"%OSITLOG%"',
    '',
  ];

  if (machineOps.length > 0) {
    lines.push('echo --- machine-wide settings --->>"%OSITLOG%"');
    for (const op of machineOps) lines.push(`${regAddLine(op)} >>"%OSITLOG%" 2>&1`);
    lines.push('');
  }

  if (defaultUserOps.length > 0) {
    lines.push('echo --- default user profile (applies to every new account) --->>"%OSITLOG%"');
    lines.push(`reg.exe load "${DEFAULT_USER_HIVE}" "%SystemDrive%\\Users\\Default\\NTUSER.DAT" >>"%OSITLOG%" 2>&1`);
    lines.push('if errorlevel 1 (echo Could not load the default user hive, skipping per-user settings.>>"%OSITLOG%") else (');
    for (const op of defaultUserOps) lines.push(`  ${regAddLine(op)} >>"%OSITLOG%" 2>&1`);
    lines.push(`  reg.exe unload "${DEFAULT_USER_HIVE}" >>"%OSITLOG%" 2>&1`);
    lines.push(')');
    lines.push('');
  }

  if (commands.length > 0) {
    lines.push('echo --- services and scheduled tasks --->>"%OSITLOG%"');
    for (const cmd of commands) lines.push(`${cmd} >>"%OSITLOG%" 2>&1`);
    lines.push('');
  }

  if (config.debloat.removeProvisionedApps && config.debloat.packages.length > 0) {
    lines.push('echo --- removing preinstalled apps --->>"%OSITLOG%"');
    lines.push(
      'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "%SystemRoot%\\Setup\\Scripts\\Debloat.ps1" >>"%OSITLOG%" 2>&1',
    );
    lines.push('');
  }

  for (const extra of config.extraSetupCommands) {
    const trimmed = extra.trim();
    if (trimmed.length > 0) lines.push(`${trimmed} >>"%OSITLOG%" 2>&1`);
  }

  lines.push('echo Finished %DATE% %TIME%>>"%OSITLOG%"');
  lines.push('exit /b 0');

  return `${lines.join('\r\n')}\r\n`;
}

export function buildDebloatScript(config: WindowsBuildConfig): string | null {
  if (!config.debloat.removeProvisionedApps || config.debloat.packages.length === 0) return null;

  const list = config.debloat.packages
    .map((p) => `    '${p.replace(/'/g, "''")}'`)
    .join(',\r\n');

  return [
    '# Removes preinstalled Store apps for the current image and for every future user.',
    '# Failures are logged and ignored: a missing app must never block setup.',
    '$ErrorActionPreference = "Continue"',
    '',
    '$targets = @(',
    list,
    ')',
    '',
    'foreach ($target in $targets) {',
    '    try {',
    '        Get-AppxProvisionedPackage -Online |',
    '            Where-Object { $_.DisplayName -eq $target } |',
    '            ForEach-Object {',
    '                Write-Output "Removing provisioned package $($_.DisplayName)"',
    '                Remove-AppxProvisionedPackage -Online -PackageName $_.PackageName -ErrorAction SilentlyContinue | Out-Null',
    '            }',
    '    } catch {',
    '        Write-Output "Provisioned removal failed for ${target}: $($_.Exception.Message)"',
    '    }',
    '',
    '    try {',
    '        Get-AppxPackage -AllUsers -Name $target -ErrorAction SilentlyContinue |',
    '            ForEach-Object {',
    '                Write-Output "Removing installed package $($_.Name)"',
    '                Remove-AppxPackage -Package $_.PackageFullName -AllUsers -ErrorAction SilentlyContinue | Out-Null',
    '            }',
    '    } catch {',
    '        Write-Output "Package removal failed for ${target}: $($_.Exception.Message)"',
    '    }',
    '}',
    '',
    'Write-Output "App removal pass complete."',
    '',
  ].join('\r\n');
}
