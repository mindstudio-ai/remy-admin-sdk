import { defineConfig } from 'tsup';

export default defineConfig([
  // The importable library: createAdminClient + the lazy `admin` default,
  // ops, errors, and every response type. dts so consumers get the full
  // typed surface.
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    clean: true,
    splitting: false,
    sourcemap: true,
  },
  // The CLI bin, bundled to a single executable file. The shebang comes from
  // the banner (sources carry none).
  {
    entry: ['src/prod.ts'],
    format: ['esm'],
    dts: false,
    clean: false,
    splitting: false,
    sourcemap: false,
    banner: { js: '#!/usr/bin/env node' },
  },
]);
