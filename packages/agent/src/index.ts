import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { generatePairingCode } from './security.js';
import { createAgentServer } from './server.js';
import { findWebRoot } from './static.js';
import { createPlatform } from './usb/writer.js';

const VERSION = '0.1.0';

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const host = process.env['OSIT_AGENT_HOST'] ?? '127.0.0.1';
const port = envInt('OSIT_AGENT_PORT', 5179);
// Scratch space, not a library. The ISO is deleted when the job ends unless the
// user asks to keep it, so this lives in the temp directory rather than $HOME.
const workDirectory = process.env['OSIT_AGENT_WORKDIR'] ?? join(tmpdir(), 'osit-scratch');
const pairingCode = process.env['OSIT_AGENT_CODE'] ?? generatePairingCode();

await mkdir(workDirectory, { recursive: true });

const webRoot = findWebRoot(dirname(fileURLToPath(import.meta.url)));

const server = createAgentServer({
  host,
  port,
  pairingCode,
  workDirectory,
  version: VERSION,
  webRoot,
  extraOrigins: (process.env['OSIT_AGENT_ORIGINS'] ?? '').split(',').map((o) => o.trim()).filter((o) => o.length > 0),
});

await server.listen();

const prerequisites = await createPlatform().checkPrerequisites().catch(() => ({ ok: false, missing: [] }));

console.log('');
console.log('  OS Installation Tool: local agent');
console.log('  ---------------------------------');
console.log(`  Listening on   http://${host}:${port}`);
console.log(`  Scratch space  ${workDirectory} (emptied after each build)`);
console.log(`  Platform       ${process.platform} ${process.arch}`);
console.log('');
console.log(`  Pairing code   ${pairingCode}`);
console.log('');
console.log('  Open https://bsantacruzms.github.io/os-installation-tool/ and enter');
console.log(`  that code, or if your browser blocks it, open http://${host}:${port}.`);
console.log('  Keep this window open while a USB stick is being written.');

if (!prerequisites.ok && prerequisites.missing.length > 0) {
  console.log('');
  console.log('  Before writing a USB stick, this needs fixing:');
  for (const item of prerequisites.missing) console.log(`   - ${item.tool}: ${item.hint}`);
}
console.log('');

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
