import type { BusType, UsbDevice } from '../../../shared/src/types.js';
import { powershellJson } from '../process.js';

export interface RawWindowsDisk {
  Number: number;
  FriendlyName?: string | null;
  Size?: number | string | null;
  BusType?: string | null;
  IsSystem?: boolean | null;
  IsBoot?: boolean | null;
  Mounts?: string[] | null;
}

const WINDOWS_DISK_SCRIPT = `
$letters = @{}
Get-Partition -ErrorAction SilentlyContinue | ForEach-Object {
  if ($_.DriveLetter) {
    $n = [int]$_.DiskNumber
    if (-not $letters.ContainsKey($n)) { $letters[$n] = New-Object System.Collections.ArrayList }
    [void]$letters[$n].Add("$($_.DriveLetter):")
  }
}
$disks = Get-Disk -ErrorAction SilentlyContinue | ForEach-Object {
  $n = [int]$_.Number
  [pscustomobject]@{
    Number       = $n
    FriendlyName = [string]$_.FriendlyName
    Size         = [string]$_.Size
    BusType      = [string]$_.BusType
    IsSystem     = [bool]$_.IsSystem
    IsBoot       = [bool]$_.IsBoot
    Mounts       = @($letters[$n])
  }
}
ConvertTo-Json -Depth 4 -InputObject ([pscustomobject]@{ disks = @($disks) })
`;

function busTypeOf(raw: string | null | undefined): BusType {
  const value = (raw ?? '').toLowerCase();
  if (value === 'usb') return 'usb';
  if (value === 'sd' || value === 'mmc') return 'sd';
  if (value.length === 0 || value === 'unknown') return 'unknown';
  return 'internal';
}

export function parseWindowsDisks(payload: unknown): UsbDevice[] {
  const raw = (payload as { disks?: unknown })?.disks;
  const disks: RawWindowsDisk[] = Array.isArray(raw) ? (raw as RawWindowsDisk[]) : raw ? [raw as RawWindowsDisk] : [];

  return disks
    .filter((disk) => Number.isFinite(Number(disk.Number)))
    .map((disk) => {
      const bus = busTypeOf(disk.BusType);
      return {
        id: `\\\\.\\PHYSICALDRIVE${Number(disk.Number)}`,
        description: (disk.FriendlyName ?? '').trim() || `Disk ${disk.Number}`,
        sizeBytes: Number(disk.Size ?? 0) || 0,
        bus,
        removable: bus === 'usb' || bus === 'sd',
        isSystem: Boolean(disk.IsSystem) || Boolean(disk.IsBoot),
        mountPoints: (disk.Mounts ?? []).filter((m): m is string => typeof m === 'string' && m.length > 0),
      };
    });
}

/** Disk number is what diskpart and PowerShell storage cmdlets actually take. */
export function windowsDiskNumber(deviceId: string): number {
  const match = /PHYSICALDRIVE(\d+)$/i.exec(deviceId);
  if (!match?.[1]) throw new Error(`Not a Windows physical drive path: ${deviceId}`);
  return Number(match[1]);
}

export async function listWindowsDevices(): Promise<UsbDevice[]> {
  return parseWindowsDisks(await powershellJson<unknown>(WINDOWS_DISK_SCRIPT));
}
