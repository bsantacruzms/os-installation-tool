import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePairingCode } from './security.js';
import { createAgentServer } from './server.js';
import { findWebRoot } from './static.js';
import { createPlatform } from './usb/writer.js';

const VERSION = '0.1.0';
const SITE = 'https://bsantacruzms.github.io/os-installation-tool/';

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Wrapped rather than top level, because a single executable must be CommonJS. */
async function main(): Promise<void> {
  const host = process.env['OSIT_AGENT_HOST'] ?? '127.0.0.1';
  const port = envInt('OSIT_AGENT_PORT', 5179);
  // Scratch space, not a library. The ISO is deleted when the job ends unless
  // the user asks to keep it, so this lives in temp rather than $HOME.
  const workDirectory = process.env['OSIT_AGENT_WORKDIR'] ?? join(tmpdir(), 'osit-scratch');
  const pairingCode = process.env['OSIT_AGENT_CODE'] ?? generatePairingCode();

  await mkdir(workDirectory, { recursive: true });

  const server = createAgentServer({
    host,
    port,
    pairingCode,
    workDirectory,
    version: VERSION,
    webRoot: findWebRoot(dirname(fileURLToPath(import.meta.url))),
    extraOrigins: (process.env['OSIT_AGENT_ORIGINS'] ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter((o) => o.length > 0),
  });

  await server.listen();

  const prerequisites = await createPlatform()
    .checkPrerequisites()
    .catch(() => ({ ok: false, missing: [] as Array<{ tool: string; hint: string }> }));

  console.log('');
  console.log('  OS Installation Tool - helper');
  console.log('  =============================');
  console.log('');
  console.log(`  Pairing code   ${pairingCode}`);
  console.log('');
  console.log(`  1. Open  ${SITE}`);
  console.log('  2. Type that pairing code into the page.');
  console.log('');
  console.log(`  No internet, or your browser blocks it? Open http://${host}:${port}`);
  console.log('  instead: this window serves the same page by itself.');
  console.log('');
  console.log(`  Scratch space  ${workDirectory} (emptied after every build)`);
  console.log(`  Platform       ${process.platform} ${process.arch}`);

  if (!prerequisites.ok && prerequisites.missing.length > 0) {
    console.log('');
    console.log('  Before writing a USB stick, this needs fixing:');
    for (const item of prerequisites.missing) console.log(`   - ${item.tool}: ${item.hint}`);
  }
  console.log('');
  console.log('  Keep this window open while a USB stick is being written.');
  console.log('');

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      void server.close().then(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(`\n  The helper could not start: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
