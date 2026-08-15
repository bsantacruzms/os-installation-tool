import { build } from 'esbuild';

await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/index.mjs',
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  // Fastify and its plugins do CommonJS interop tricks that break when bundled.
  packages: 'external',
  banner: {
    js: "import { createRequire as __osit_cr } from 'module'; const require = __osit_cr(import.meta.url);",
  },
  logLevel: 'info',
});
