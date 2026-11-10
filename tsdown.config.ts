// Bundles the `counterpoint` CLI (which also re-enters itself as the daemon through the hidden
// `__daemon` command) into one ESM file, dist/cli.mjs. Runtime `dependencies` stay external and
// are installed with the package; nothing from node_modules is bundled, so dev and UI packages
// can never end up in the CLI. The console is built separately by Vite into dist/ui.
import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: { cli: 'src/cli/main.ts' },
  outDir: 'dist',
  format: 'esm',
  platform: 'node',
  target: 'node24',
  fixedExtension: true,
  banner: { js: '#!/usr/bin/env node' },
  // tsdown cleans its output directory by default, which would delete dist/ui; `pnpm clean`
  // empties dist/ once, before both builds.
  clean: false,
  dts: false,
  sourcemap: false,
  deps: {
    // Fail the build if anything from node_modules would be bundled into the CLI.
    onlyBundle: [],
  },
});
