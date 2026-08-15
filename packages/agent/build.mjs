import { build } from 'esbuild';

const sea = process.argv.includes('--sea');

await build({
  entryPoints: ['src/index.ts'],
  outfile: sea ? 'dist/agent-sea.cjs' : 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  // Node's single executable format takes a CommonJS entry point.
  format: sea ? 'cjs' : 'esm',
  sourcemap: !sea,
  minify: sea,
  // The agent has no runtime dependencies, so the SEA build can inline everything.
  ...(sea ? {} : { packages: 'external' }),
  // esbuild only accepts an identifier or JSON here, so the real expression
  // goes in the banner and this just points at it.
  define: sea ? { 'import.meta.url': '__ositEntryUrl' } : {},
  banner: sea
    ? { js: "const __ositEntryUrl = require('url').pathToFileURL(__filename).href;" }
    : {
        js: "#!/usr/bin/env node\nimport { createRequire as __osit_cr } from 'module'; const require = __osit_cr(import.meta.url);",
      },
  logLevel: 'info',
});
