import type { UsbDevice } from '../../../shared/src/types.js';
import { listLinuxDevices } from './linux.js';
import { listMacDevices } from './macos.js';
import { listWindowsDevices } from './windows.js';

export async function listDevices(): Promise<UsbDevice[]> {
  switch (process.platform) {
    case 'win32':
      return listWindowsDevices();
    case 'darwin':
      return listMacDevices();
    case 'linux':
      return listLinuxDevices();
    default:
      throw new Error(`Listing drives is not supported on ${process.platform}.`);
  }
}

export interface SafetyCheckOptions {
  requireRemovable: boolean;
}

/**
 * The last line of defence before anything is erased. Refuses the system disk
 * outright: no option and no override can turn that off.
 */
export function assertSafeTarget(device: UsbDevice | undefined, options: SafetyCheckOptions): asserts device is UsbDevice {
  if (!device) throw new Error('That drive is no longer connected. Unplug and replug it, then refresh the list.');

  if (device.isSystem) {
    throw new Error(`${device.description} is the drive this computer runs from. It will never be erased by this tool.`);
  }
  if (device.sizeBytes <= 0) {
    throw new Error(`${device.description} reports a size of zero, which usually means no media is inserted.`);
  }
  if (options.requireRemovable && !device.removable) {
    throw new Error(
      `${device.description} does not look like removable media. Turn off the removable-only safety check if you are certain.`,
    );
  }
}

export function findDevice(devices: UsbDevice[], id: string): UsbDevice | undefined {
  return devices.find((d) => d.id.toLowerCase() === id.toLowerCase());
}
