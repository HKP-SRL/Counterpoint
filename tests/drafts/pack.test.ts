// The packer (design-drafts 2.2, D-4): a page with every kind of script comes out inert, linked
// styles and a relatively linked font are inlined into styles.css, nothing outside the page's
// folder or remote is kept, and a duplicate data-cp-id refuses the page.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { PackError, packPage } from '../../src/drafts/pack.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

afterAll(() => removeScratchDirs());

const SCRIPTED = `<!doctype html><html><head>
<base href="https://evil.example/">
<meta http-equiv="refresh" content="0;url=https://evil.example">
<script>alert(1)</script>
<script src="app.js"></script>
<link rel="stylesheet" href="css/site.css">
<link rel="stylesheet" href="https://cdn.example/x.css">
<link rel="preload" href="font.woff2">
<style>.b { background: url(https://evil.example/t.png) }</style>
</head><body onload="alert(2)">
<header data-cp-id="header"><h1 data-cp-id="title" onclick="alert(3)">Today</h1></header>
<a href="javascript:alert(4)" data-cp-id="link">Go</a>
<a href="https://example.com">Out</a>
<form action="https://evil.example/post"><button formaction="/x">Send</button></form>
<iframe src="https://evil.example"></iframe><object data="x.swf"></object><embed src="x.swf">
<img src="logo.png" alt=""><img src="https://evil.example/pixel.gif" alt="">
<img src="../outside.png" alt="">
<svg><script>alert(5)</script><a xlink:href="javascript:alert(6)"><text>t</text></a>
<animate attributeName="href" to="javascript:alert(7)"/></svg>
<div style="background:url('javascript:alert(8)')">s</div>
</body></html>`;

function fixture(page: string): string {
  const root = makeScratchDir('cp-pack-');
  mkdirSync(join(root, 'css', 'fonts'), { recursive: true });
  writeFileSync(join(root, 'page.html'), page);
  writeFileSync(
    join(root, 'css', 'site.css'),
    '@import "base.css";\n@font-face { font-family: F; src: url(fonts/f.woff2) format("woff2"); }\n',
  );
  writeFileSync(join(root, 'css', 'base.css'), 'body { color: red }\n');
  writeFileSync(join(root, 'css', 'fonts', 'f.woff2'), Buffer.from([1, 2, 3, 4]));
  writeFileSync(join(root, 'logo.png'), Buffer.from([137, 80, 78, 71]));
  writeFileSync(join(root, '..', 'outside.png'), Buffer.from([0]));
  return root;
}

describe('packPage', () => {
  it('removes every kind of script and remote reference', () => {
    const root = fixture(SCRIPTED);
    const out = join(root, 'out');
    const result = packPage({ root, outDir: out });
    const html = readFileSync(join(out, 'page.html'), 'utf8');
    for (const banned of [
      '<script',
      '<base',
      'http-equiv',
      'onload',
      'onclick',
      'javascript:',
      'evil.example',
      'cdn.example',
      'example.com',
      '<iframe',
      '<object',
      '<embed',
      '<animate',
      'formaction',
      'action=',
      'outside.png',
      'app.js',
    ]) {
      expect(html).not.toContain(banned);
    }
    expect(html).toContain('<link rel="stylesheet" href="styles.css">');
    expect(html).toContain('src="data:image/png;base64,');
    expect(result.ids).toEqual(['header', 'title', 'link']);
    expect(result.parts.title).toMatchObject({ text: 'Today', ancestors: ['header'] });
    expect(result.parts.header?.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('inlines linked styles, imports and a relatively linked font into styles.css', () => {
    const root = fixture(SCRIPTED);
    packPage({ root, outDir: root });
    const css = readFileSync(join(root, 'styles.css'), 'utf8');
    expect(css).toContain('body { color: red }');
    expect(css).toContain(
      `url("data:font/woff2;base64,${Buffer.from([1, 2, 3, 4]).toString('base64')}")`,
    );
    expect(css).not.toContain('evil.example');
    expect(css).not.toContain('@import');
  });

  it('refuses a duplicate data-cp-id and a missing page', () => {
    const root = fixture('<div data-cp-id="a"></div><p data-cp-id="a"></p>');
    expect(() => packPage({ root, outDir: root })).toThrow(PackError);
    expect(() => packPage({ root, page: 'none.html', outDir: root })).toThrow(/No none.html/);
  });
});
