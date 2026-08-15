import type { BusType, UsbDevice } from '../../../shared/src/types.js';
import { runOrThrow } from '../process.js';

interface LsblkNode {
  name?: string;
  path?: string;
  size?: number | string;
  type?: string;
  tran?: string | null;
  rm?: boolean | string;
  hotplug?: boolean | string;
  model?: string | null;
  vendor?: string | null;
  mountpoint?: string | null;
  mountpoints?: Array<string | null>;
  children?: LsblkNode[];
}

function truthy(value: boolean | string | undefined): boolean {
  return value === true || value === '1' || value === 'true';
}

function busTypeOf(tran: string | null | undefined, removable: boolean): BusType {
  const value = (tran ?? '').toLowerCase();
  if (value === 'usb') return 'usb';
  if (value === 'mmc') return 'sd';
  if (value.length > 0) return 'internal';
  return removable ? 'usb' : 'unknown';
}

function collectMounts(node: LsblkNode): string[] {
  const mounts: string[] = [];
  const push = (value: string | null | undefined) => {
    if (typeof value === 'string' && value.length > 0) mounts.push(value);
  };
  push(node.mountpoint);
  for (const m of node.mountpoints ?? []) push(m);
  for (const child of node.children ?? []) mounts.push(...collectMounts(child));
  return [...new Set(mounts)];
}

export function parseLsblk(payload: unknown): UsbDevice[] {
  const devices = (payload as { blockdevices?: LsblkNode[] })?.blockdevices ?? [];
  return devices
    .filter((node) => (node.type ?? 'disk') === 'disk' && typeof node.path === 'string')
    .map((node) => {
      const removable = truthy(node.rm) || truthy(node.hotplug);
      const mounts = collectMounts(node);
      const label = [node.vendor, node.model].map((v) => (v ?? '').trim()).filter((v) => v.length > 0).join(' ');
      return {
        id: node.path as string,
        description: label || (node.name ?? 'disk'),
        sizeBytes: Number(node.size ?? 0) || 0,
        bus: busTypeOf(node.tran, removable),
        removable,
        // `/` or `/boot` living on this disk means it is the running system.
        isSystem: mounts.some((m) => m === '/' || m === '/boot' || m.startsWith('/boot/')),
        mountPoints: mounts,
      };
    });
}

export async function listLinuxDevices(): Promise<UsbDevice[]> {
  const result = await runOrThrow('lsblk', [
    '--json',
    '--bytes',
    '--output',
    'NAME,PATH,SIZE,TYPE,TRAN,RM,HOTPLUG,MODEL,VENDOR,MOUNTPOINTS',
  ]);
  return parseLsblk(JSON.parse(result.stdout));
}
