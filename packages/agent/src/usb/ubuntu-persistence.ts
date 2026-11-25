import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { runOrThrow } from '../process.js';

export function enableCasperPersistence(config: string): string {
  let found = false;
  const updated = config.replace(/^([ \t]*linux(?:efi)?[ \t]+\/casper\/vmlinuz\S*)([^\r\n]*)/gm, (_, kernel: string, args: string) => {
    found = true;
    return `${kernel} persistent${args}`;
  });
  if (!found) throw new Error('This Ubuntu image has an unrecognized GRUB layout; the USB has not been touched.');
  return updated;
}

/** Rebuild only a scratch image. Neither xorriso nor mke2fs receives a device path. */
export async function preparePersistentUbuntu(dir: string, iso: string, signal: AbortSignal): Promise<string> {
  if (process.platform === 'win32') throw new Error('The portable Windows helper supports standard Linux media only.');
  const scratch = await mkdtemp(join(dir, 'casper-'));
  const out = join(dir, 'persistent.iso');
  const tool = (name: string, args: string[]) => runOrThrow(name, args, { signal });
  try {
    const xorriso = (args: string[]) => tool('xorriso', ['-abort_on', 'SORRY', ...args]);
    await xorriso(['-osirrox', 'on', '-indev', iso, '-extract', '/boot/grub/grub.cfg', `${scratch}/grub.cfg`,
      '-extract', '/md5sum.txt', `${scratch}/md5sum.txt`]);
    const cfgPath = join(scratch, 'grub.cfg');
    const cfg = enableCasperPersistence(await readFile(cfgPath, 'utf8'));
    const sumsPath = join(scratch, 'md5sum.txt');
    const sums = (await readFile(sumsPath, 'utf8')).replace(/^[a-f0-9]{32}( [ *](?:\.\/)?boot\/grub\/grub\.cfg)$/gm,
      `${createHash('md5').update(cfg).digest('hex')}$1`);
    // Extracted files may inherit read-only ISO permissions. Replace our copies.
    await rm(cfgPath);
    await rm(sumsPath);
    await writeFile(cfgPath, cfg);
    await writeFile(sumsPath, sums);
    await tool('mke2fs', ['-q', '-t', 'ext4', '-F', '-L', 'writable', '-b', '4096', `${scratch}/overlay.img`, '262144']);
    await xorriso(['-indev', iso, '-outdev', out, '-overwrite', 'on',
      '-map', cfgPath, '/boot/grub/grub.cfg', '-map', sumsPath, '/md5sum.txt',
      '-boot_image', 'any', 'replay', '-append_partition', '4', '0x83', `${scratch}/overlay.img`]);
    return out;
  } catch (error) {
    throw new Error(`Cannot prepare Ubuntu persistence. Check xorriso and e2fsprogs on the helper host. ${String(error)}`);
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
