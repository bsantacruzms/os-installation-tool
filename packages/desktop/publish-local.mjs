import { copyFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const name = 'OS-Installation-Tool.exe';
const output = fileURLToPath(new URL('../../_output/', import.meta.url));
const pending = join(output, `${name}.${randomUUID()}.tmp`);
await mkdir(output, { recursive: true });
try {
  await copyFile(new URL(`./dist/${name}`, import.meta.url), pending);
  // Keep the previous working build intact if the EXE is in use.
  await rename(pending, join(output, name));
} finally {
  await rm(pending, { force: true });
}
