import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { Resvg } from '@resvg/resvg-js';

if (!existsSync('../web/dist/index.html')) throw new Error('Build packages/web first.');
mkdirSync('build', { recursive: true });
const icon = new Resvg(readFileSync('../web/public/icon.svg'), { fitTo: { mode: 'width', value: 512 } });
writeFileSync('build/os.png', icon.render().asPng());
execFileSync(process.execPath, ['scripts/embed-web.mjs'], { cwd: '../agent', stdio: 'inherit' });
await build({ entryPoints: ['main.ts'], outfile: 'build/main.cjs', bundle: true, platform: 'node',
  format: 'cjs', target: 'node22', external: ['electron'] });
