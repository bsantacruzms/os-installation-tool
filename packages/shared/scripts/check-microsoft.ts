import { resolveWindowsIso, listWindowsLanguages } from '../src/windows/microsoft.js';

/**
 * Hits Microsoft's real download service. Not part of `npm test`, because it
 * depends on the network and on Microsoft not rate limiting this IP.
 *
 *   npx tsx scripts/check-microsoft.ts
 */
const arch = (process.argv[2] === 'arm64' ? 'arm64' : 'x64') as 'x64' | 'arm64';
const language = process.argv[3] ?? 'English (United States)';

try {
  const languages = await listWindowsLanguages(arch);
  console.log(`Languages offered for ${arch}: ${languages.length}`);
  console.log(languages.slice(0, 5).map((l) => ` - ${l.language}`).join('\n'));

  const resolved = await resolveWindowsIso({ arch, microsoftLanguageName: language });
  console.log('\nResolved ISO');
  console.log(`  file:    ${resolved.fileName}`);
  console.log(`  arch:    ${resolved.arch}`);
  console.log(`  expires: ${resolved.expiresAt}`);
  console.log(`  host:    ${new URL(resolved.url).host}`);

  const head = await fetch(resolved.url, { method: 'HEAD' });
  console.log(`  HEAD:    ${head.status} ${head.headers.get('content-length') ?? 'no length'}`);
} catch (error) {
  const e = error as { code?: string; message?: string; hint?: string };
  console.error(`FAILED [${e.code ?? 'unknown'}] ${e.message ?? error}`);
  if (e.hint) console.error(`HINT: ${e.hint}`);
  process.exitCode = 1;
}
