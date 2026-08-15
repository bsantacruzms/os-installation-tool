import type { BusType, UsbDevice } from '../../../shared/src/types.js';
import { run, runOrThrow } from '../process.js';

export interface RawDiskutilInfo {
  DeviceIdentifier?: string;
  DeviceNode?: string;
  MediaName?: string;
  IORegistryEntryName?: string;
  TotalSize?: number;
  Size?: number;
  BusProtocol?: string;
  Internal?: boolean;
  RemovableMedia?: boolean;
  RemovableMediaOrExternalDevice?: boolean;
  SystemImage?: boolean;
  MountPoint?: string;
  APFSPhysicalStores?: unknown;
}

function busTypeOf(protocol: string | undefined, internal: boolean): BusType {
  const value = (protocol ?? '').toLowerCase();
  if (value === 'usb') return 'usb';
  if (value === 'secure digital' || value === 'sd') return 'sd';
  if (internal) return 'internal';
  return value.length > 0 ? 'internal' : 'unknown';
}

export function parseDiskutilInfo(info: RawDiskutilInfo, mountPoints: string[] = []): UsbDevice {
  const identifier = info.DeviceIdentifier ?? '';
  const internal = info.Internal === true;
  return {
    id: info.DeviceNode ?? `/dev/${identifier}`,
    description: (info.MediaName ?? info.IORegistryEntryName ?? identifier).trim() || identifier,
    sizeBytes: Number(info.TotalSize ?? info.Size ?? 0) || 0,
    bus: busTypeOf(info.BusProtocol, internal),
    removable: info.RemovableMedia === true || info.RemovableMediaOrExternalDevice === true || !internal,
    isSystem: mountPoints.includes('/') || info.SystemImage === true,
    mountPoints: [...new Set([...(info.MountPoint ? [info.MountPoint] : []), ...mountPoints])].filter((m) => m.length > 0),
  };
}

export async function listMacDevices(): Promise<UsbDevice[]> {
  const list = await runOrThrow('diskutil', ['list', '-plist']);
  const identifiers = [...list.stdout.matchAll(/<string>(disk\d+)<\/string>/g)]
    .map((m) => m[1])
    .filter((id): id is string => typeof id === 'string');

  const devices: UsbDevice[] = [];
  for (const id of [...new Set(identifiers)]) {
    const info = await run('diskutil', ['info', '-plist', id]);
    if (info.code !== 0) continue;
    devices.push(parseDiskutilPlist(info.stdout, id));
  }
  return devices;
}

/**
 * Reads the handful of keys we need straight out of the plist XML. A full plist
 * parser would be nicer, but this keeps the agent dependency free and the
 * relevant keys are all flat scalars.
 */
export function parseDiskutilPlist(plist: string, identifier: string): UsbDevice {
  const scalar = (key: string): string | undefined => {
    const match = new RegExp(`<key>${key}</key>\\s*<(string|integer|real)>([^<]*)</\\1>`).exec(plist);
    return match?.[2];
  };
  const flag = (key: string): boolean | undefined => {
    const match = new RegExp(`<key>${key}</key>\\s*<(true|false)/>`).exec(plist);
    return match ? match[1] === 'true' : undefined;
  };

  const info: RawDiskutilInfo = {
    DeviceIdentifier: scalar('DeviceIdentifier') ?? identifier,
    DeviceNode: scalar('DeviceNode'),
    MediaName: scalar('MediaName'),
    IORegistryEntryName: scalar('IORegistryEntryName'),
    TotalSize: Number(scalar('TotalSize') ?? scalar('Size') ?? 0),
    BusProtocol: scalar('BusProtocol'),
    Internal: flag('Internal'),
    RemovableMedia: flag('RemovableMedia'),
    RemovableMediaOrExternalDevice: flag('RemovableMediaOrExternalDevice'),
    SystemImage: flag('SystemImage'),
    MountPoint: scalar('MountPoint'),
  };
  return parseDiskutilInfo(info);
}
