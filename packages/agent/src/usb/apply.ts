import { mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';

import type { BuildPlan, InjectedFile, RemovedPath } from '../../../shared/src/types.js';

export class UnsafePathError extends Error {
  constructor(path: string) {
    super(`Refusing to touch "${path}": it points outside the USB stick.`);
    this.name = 'UnsafePathError';
  }
}

/**
 * The plan arrives over HTTP, so its paths are untrusted. Anything that is
 * absolute, has a drive letter, or climbs out of the root is rejected before a
 * single byte is written.
 */
export function resolveWithinRoot(root: string, relativePath: string): string {
  if (relativePath.length === 0) throw new UnsafePathError(relativePath);
  if (isAbsolute(relativePath) || /^[a-zA-Z]:/.test(relativePath) || relativePath.startsWith('\\\\')) {
    throw new UnsafePathError(relativePath);
  }
  const normalizedRoot = resolve(root);
  const target = resolve(normalizedRoot, relativePath);
  const rel = relative(normalizedRoot, target);
  if (rel.length === 0 || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    throw new UnsafePathError(relativePath);
  }
  return target;
}

export async function writeInjectedFile(root: string, file: InjectedFile): Promise<string> {
  const target = resolveWithinRoot(root, file.path);
  await mkdir(join(target, '..'), { recursive: true });
  await writeFile(target, file.content, { encoding: file.encoding });
  return target;
}

export async function removePlannedPath(root: string, entry: RemovedPath): Promise<boolean> {
  const target = resolveWithinRoot(root, entry.path);
  try {
    await stat(target);
  } catch {
    return false;
  }
  await rm(target, { recursive: true, force: true });
  return true;
}

export interface ApplyResult {
  written: string[];
  removed: string[];
}

export async function applyPlan(root: string, plan: BuildPlan, log: (message: string) => void): Promise<ApplyResult> {
  const written: string[] = [];
  const removed: string[] = [];

  for (const entry of plan.removedPaths) {
    if (await removePlannedPath(root, entry)) {
      removed.push(entry.path);
      log(`Removed ${entry.path}: ${entry.purpose}`);
    }
  }

  for (const file of plan.injectedFiles) {
    await writeInjectedFile(root, file);
    written.push(file.path);
    log(`Wrote ${file.path}: ${file.purpose}`);
  }

  return { written, removed };
}
