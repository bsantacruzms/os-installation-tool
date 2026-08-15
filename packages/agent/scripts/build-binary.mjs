import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/**
 * Produces a single executable using Node's built-in SEA support, so the helper
 * is one file the user downloads and runs. No third-party packer, no install.
 *
 * Cross-compiling is not possible: each platform's binary must be built on that
 * platform, which is what the release workflow's matrix is for.
 */
const outDir = 'dist/bin';
const isWindows = process.platform === 'win32';
const target = join(outDir, isWindows ? 'osit-agent.exe' : 'osit-agent');

mkdirSync(outDir, { recursive: true });
rmSync(target, { force: true });

writeFileSync(
  'dist/sea-config.json',
  JSON.stringify({ main: 'dist/agent-sea.cjs', output: 'dist/agent-sea.blob', disableExperimentalSEAWarning: true }, null, 2),
);

console.log('Generating the SEA blob...');
execFileSync(process.execPath, ['--experimental-sea-config', 'dist/sea-config.json'], { stdio: 'inherit' });

console.log(`Copying the node runtime to ${target}...`);
copyFileSync(process.execPath, target);

// A signature over the original bytes will not survive injection.
if (isWindows) {
  try {
    execFileSync('signtool', ['remove', '/s', target], { stdio: 'ignore' });
  } catch {
    // Unsigned to begin with on most runners, which is fine.
  }
} else if (process.platform === 'darwin') {
  try {
    execFileSync('codesign', ['--remove-signature', target], { stdio: 'ignore' });
  } catch {
    // Same again.
  }
}

console.log('Injecting the blob...');
// Invoked through node rather than a shell, so nothing here is re-parsed.
execFileSync(
  process.execPath,
  [
    require.resolve('postject/dist/cli.js'),
    target,
    'NODE_SEA_BLOB',
    'dist/agent-sea.blob',
    '--sentinel-fuse',
    'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
    ...(process.platform === 'darwin' ? ['--macho-segment-name', 'NODE_SEA'] : []),
  ],
  { stdio: 'inherit' },
);

if (process.platform === 'darwin') {
  console.log('Re-signing so macOS will run it...');
  execFileSync('codesign', ['--sign', '-', target], { stdio: 'inherit' });
}

const size = statSync(target).size;
console.log(`\nBuilt ${target} (${(size / 1024 / 1024).toFixed(1)} MB)`);
