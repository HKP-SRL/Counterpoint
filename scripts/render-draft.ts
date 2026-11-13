// Counterpoint's hi-fi draft renderer (design-drafts D-3; docs/drafts.md): the `drafts.render`
// command of Counterpoint's own `.counterpoint/config.yaml`.
//
//   node scripts/render-draft.ts <entry.tsx> <out-dir>
//
// The entry is a TSX module whose default export is a React component: one state of one screen,
// drawn with the console's own Astryx components and sample data. It is loaded through Vite (JSX,
// TypeScript, the console's React plugin), rendered once to static markup inside the console's
// Astryx theme, and written to `<out>/page.html`, linking `css/console.css`: the console's own
// stylesheet stack (reset, Astryx, the neutral theme, self-hosted Figtree), copied into `<out>/css`.
// Counterpoint's packer then inlines the styles and fonts and strips anything that could run.
//
// Nothing here runs in the browser: the page is static, the way the console looks at first paint.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const [entryArg, outArg] = process.argv.slice(2);
if (entryArg === undefined || outArg === undefined) {
  console.error('Usage: node scripts/render-draft.ts <entry.tsx> <out-dir>');
  process.exit(2);
}
const started = Date.now();
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const entry = resolve(entryArg);
const out = resolve(outArg);
const require = createRequire(join(root, 'package.json'));

/** The console's stylesheet stack, in cascade order (ui/src/styles.css). */
const STYLES: [string, string][] = [
  ['reset.css', '@astryxdesign/core/reset.css'],
  ['astryx.css', '@astryxdesign/core/astryx.css'],
  ['theme.css', '@astryxdesign/theme-neutral/theme.css'],
];
const WEIGHTS = [400, 500, 600, 700];

function copyStyles(): void {
  const css = join(out, 'css');
  mkdirSync(join(css, 'files'), { recursive: true });
  for (const [name, specifier] of STYLES) copyFileSync(require.resolve(specifier), join(css, name));
  for (const weight of WEIGHTS) {
    const file = require.resolve(`@fontsource/figtree/latin-${weight}.css`);
    // woff2 only: every browser that renders drafts reads it, and the page stays half the size.
    const text = readFileSync(file, 'utf8').replace(
      /,\s*url\([^)]*\.woff\)\s*format\('woff'\)/g,
      '',
    );
    writeFileSync(join(css, `figtree-${weight}.css`), text);
    const font = `figtree-latin-${weight}-normal.woff2`;
    copyFileSync(join(dirname(file), 'files', font), join(css, 'files', font));
  }
  writeFileSync(
    join(css, 'console.css'),
    [...STYLES.map(([name]) => name), ...WEIGHTS.map((w) => `figtree-${w}.css`)]
      .map((name) => `@import "${name}";`)
      .join('\n'),
  );
}

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"]/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch] ?? ch,
  );

const { createServer } = await import('vite');
const react = (await import('@vitejs/plugin-react')).default;
const server = await createServer({
  configFile: false,
  root,
  logLevel: 'error',
  appType: 'custom',
  server: { middlewareMode: true, hmr: false, ws: false },
  plugins: [react()],
  optimizeDeps: { noDiscovery: true, include: [] },
});
try {
  const module = (await server.ssrLoadModule(entry)) as {
    default?: unknown;
    title?: unknown;
  };
  if (typeof module.default !== 'function') {
    throw new Error(`${basename(entry)} has no default export of a React component.`);
  }
  const { createElement } = await import('react');
  const { renderToStaticMarkup } = await import('react-dom/server');
  const { Theme } = (await server.ssrLoadModule(
    '@astryxdesign/core/theme',
  )) as typeof import('@astryxdesign/core/theme');
  const { neutralTheme } = (await server.ssrLoadModule(
    '@astryxdesign/theme-neutral/built',
  )) as typeof import('@astryxdesign/theme-neutral/built');
  const markup = renderToStaticMarkup(
    createElement(Theme, {
      theme: neutralTheme,
      mode: 'light',
      children: createElement(module.default as () => null),
    }),
  );
  const title = typeof module.title === 'string' ? module.title : basename(entry);
  mkdirSync(out, { recursive: true });
  copyStyles();
  writeFileSync(
    join(out, 'page.html'),
    `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="stylesheet" href="css/console.css">
</head>
<body>
${markup}
</body>
</html>
`,
  );
  console.log(
    `Rendered ${basename(entry)} to ${join(out, 'page.html')} in ${Date.now() - started} ms.`,
  );
} finally {
  await server.close();
}
