import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  packages: 'external',
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __osit_cr } from 'module'; const require = __osit_cr(import.meta.url);",
  },
  logLevel: 'info',
});
