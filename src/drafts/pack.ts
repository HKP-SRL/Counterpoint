// The packer (design-drafts D-4): turns every draft page, low-fi or hi-fi, into a page that cannot
// run anything, and that renders alone next to one `styles.css`.
//
// - Removed: `<script>`, `<base>`, frames, `<object>`, `<embed>`, `<meta http-equiv>`, SVG
//   animation, every `on*` attribute, forms' `action`, link targets, `javascript:` and remote URLs.
// - Linked stylesheets and `<style>` blocks are inlined, in document order, into `styles.css`; their
//   `@import`s are followed and fonts and images they name become `data:` URLs. A file outside the
//   page's folder, or anything remote, is dropped.
// - Every `data-cp-id` is recorded with a fingerprint of its markup, its text and the ids of the
//   parts around it (`parts.json`); a duplicate id refuses the page.
//
// The page is parsed with parse5 (the HTML standard's parser), so what is removed is what a browser
// would have seen, not what a pattern guessed.
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import {
  type DefaultTreeAdapterMap,
  defaultTreeAdapter,
  parse,
  serialize,
  serializeOuter,
} from 'parse5';

type Node = DefaultTreeAdapterMap['node'];
type Element = DefaultTreeAdapterMap['element'];
type ParentNode = DefaultTreeAdapterMap['parentNode'];
type ChildNode = DefaultTreeAdapterMap['childNode'];

export const PACKED_PAGE = 'page.html';
export const PACKED_STYLES = 'styles.css';
export const PACKED_PARTS = 'parts.json';
/** The exact tag the packer links its styles with (sign-off rewrites its href). */
export const STYLES_LINK = `<link rel="stylesheet" href="${PACKED_STYLES}">`;

/** The page cannot be packed (no page, duplicate ids). The message is one line. */
export class PackError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PackError';
  }
}

/** One part of a packed page (D-7: compared across revisions). */
export interface PartPrint {
  /** SHA-256 of the part's packed markup. */
  hash: string;
  /** The part's text, collapsed and clipped. */
  text: string;
  /** The ids of the parts it sits in, outermost first. */
  ancestors: string[];
  /** The part's markup, clipped (what a session is shown of a selection). */
  excerpt: string;
}

export interface PackResult {
  /** Every `data-cp-id`, in document order. */
  ids: string[];
  parts: Record<string, PartPrint>;
  /** What was removed, one short line each (deduplicated). */
  removed: string[];
}

const DROP_ELEMENTS = new Set([
  'script',
  'base',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'animate',
  'animatemotion',
  'animatetransform',
  'set',
  'discard',
]);
const URL_ATTRS = new Set([
  'src',
  'href',
  'xlink:href',
  'poster',
  'data',
  'background',
  'action',
  'formaction',
  'ping',
  'cite',
  'srcset',
  'imagesrcset',
  'manifest',
  'codebase',
  'longdesc',
  'lowsrc',
  'dynsrc',
]);
const IMAGE_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};
const FONT_TYPES: Record<string, string> = {
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
};
const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const MAX_EXCERPT = 4000;
const MAX_TEXT = 160;
const ID_MAX = 100;

/** The URL without spaces and control characters (browsers skip them in a scheme). */
const squash = (url: string): string => [...url].filter((ch) => ch.charCodeAt(0) > 0x20).join('');

/** True for a URL that leaves the page's folder: any scheme other than `data:`, or `//host`. */
function isRemote(url: string): boolean {
  const trimmed = url.trim();
  if (trimmed.startsWith('//') || trimmed.startsWith('\\\\')) return true;
  const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(squash(trimmed));
  if (scheme === null) return false;
  return (scheme[1] ?? '').toLowerCase() !== 'data';
}

/** A `data:` URL that could hold a document (never kept). */
function isDataDocument(url: string): boolean {
  return /^\s*data:\s*(text\/html|application\/xhtml|text\/xml|application\/xml)/i.test(url);
}

const collapse = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
};

/** A file inside `root`, or null: no `..` escape, no link out of it. */
function insideRoot(root: string, from: string, url: string): string | null {
  let path: string;
  try {
    path = decodeURIComponent(url.split(/[?#]/)[0] ?? '');
  } catch {
    return null;
  }
  if (path === '' || path.startsWith('/')) return null;
  const target = resolve(from, path);
  if (!existsSync(target)) return null;
  const real = realpathSync(target);
  const realRoot = realpathSync(root);
  if (real !== realRoot && !real.startsWith(realRoot + sep)) return null;
  if (!statSync(real).isFile()) return null;
  return real;
}

/** A file in `root` as a `data:` URL when it is an image or font under the size cap. */
function dataUrl(root: string, from: string, url: string, fonts: boolean): string | null {
  const file = insideRoot(root, from, url);
  if (file === null) return null;
  const ext = extname(file).toLowerCase();
  const type = IMAGE_TYPES[ext] ?? (fonts ? FONT_TYPES[ext] : undefined);
  if (type === undefined || statSync(file).size > MAX_INLINE_BYTES) return null;
  return `data:${type};base64,${readFileSync(file).toString('base64')}`;
}

interface CssContext {
  root: string;
  removed: Set<string>;
  /** Stylesheets already inlined (an `@import` cycle stops). */
  seen: Set<string>;
}

const IMPORT_RE = /@import\s+(?:url\(\s*(['"]?)([^'")]*)\1\s*\)|(['"])([^'"]*)\3)[^;]*;?/gi;
const URL_RE = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^'")\s]*))\s*\)/gi;

/** CSS with its `@import`s inlined and every `url()` made a `data:` URL or dropped. */
function packCss(css: string, from: string, ctx: CssContext): string {
  const imported = css.replace(IMPORT_RE, (_all, _q1, url1, _q2, url2) => {
    const url = String(url1 ?? url2 ?? '');
    if (isRemote(url)) {
      ctx.removed.add('a remote @import');
      return '';
    }
    const file = insideRoot(ctx.root, from, url);
    if (file === null || extname(file).toLowerCase() !== '.css' || ctx.seen.has(file)) {
      ctx.removed.add('an @import outside the page folder');
      return '';
    }
    ctx.seen.add(file);
    return packCss(readFileSync(file, 'utf8'), dirname(file), ctx);
  });
  return imported.replace(URL_RE, (all, single, double, bare) => {
    const url = String(single ?? double ?? bare ?? '').trim();
    if (url === '' || url.startsWith('#')) return all;
    if (/^data:/i.test(url)) {
      if (isDataDocument(url)) {
        ctx.removed.add('a data: document URL');
        return 'url("")';
      }
      return all;
    }
    if (isRemote(url)) {
      ctx.removed.add('a remote URL in CSS');
      return 'url("")';
    }
    const data = dataUrl(ctx.root, from, url, true);
    if (data === null) {
      ctx.removed.add('a file URL in CSS outside the page folder');
      return 'url("")';
    }
    return `url("${data}")`;
  });
}

const isElement = (node: Node): node is Element => 'tagName' in node;
const attr = (element: Element, name: string): string | undefined =>
  element.attrs.find((a) => a.name === name)?.value;

function textOf(node: Node): string {
  if (node.nodeName === '#text') return (node as DefaultTreeAdapterMap['textNode']).value;
  if (!('childNodes' in node)) return '';
  if (isElement(node) && (node.tagName === 'style' || node.tagName === 'template')) return '';
  return node.childNodes.map(textOf).join(' ');
}

function findElement(node: Node, tag: string): Element | null {
  if (isElement(node) && node.tagName === tag) return node;
  if (!('childNodes' in node)) return null;
  for (const child of node.childNodes) {
    const found = findElement(child, tag);
    if (found !== null) return found;
  }
  return null;
}

export interface PackInput {
  /** The folder the page and its files are in; nothing outside it is read. */
  root: string;
  /** The page, relative to `root`. */
  page?: string;
  /** Where `page.html`, `styles.css` and `parts.json` are written (may be `root`). */
  outDir: string;
}

/** Packs one page (D-4). Throws PackError when it cannot. */
export function packPage(input: PackInput): PackResult {
  const pagePath = join(input.root, input.page ?? PACKED_PAGE);
  if (!existsSync(pagePath)) {
    throw new PackError(`No ${relative(input.root, pagePath) || PACKED_PAGE} was written.`);
  }
  const html = readFileSync(pagePath, 'utf8');
  const document = parse(html);
  const removed = new Set<string>();
  const ctx: CssContext = { root: input.root, removed, seen: new Set() };
  const pageDir = dirname(pagePath);
  const styles: string[] = [];

  const visit = (parent: ParentNode): void => {
    const keep: ChildNode[] = [];
    for (const node of parent.childNodes) {
      if (node.nodeName === '#comment') continue;
      if (!isElement(node)) {
        keep.push(node);
        continue;
      }
      const tag = node.tagName.toLowerCase();
      if (DROP_ELEMENTS.has(tag)) {
        removed.add(`<${tag}>`);
        continue;
      }
      if (tag === 'meta' && attr(node, 'http-equiv') !== undefined) {
        removed.add('<meta http-equiv>');
        continue;
      }
      if (tag === 'link') {
        const rel = (attr(node, 'rel') ?? '').toLowerCase().split(/\s+/);
        const href = attr(node, 'href') ?? '';
        if (rel.includes('stylesheet') && href !== '' && !isRemote(href)) {
          const file = insideRoot(input.root, pageDir, href);
          if (file !== null && !ctx.seen.has(file)) {
            ctx.seen.add(file);
            styles.push(packCss(readFileSync(file, 'utf8'), dirname(file), ctx));
          } else if (file === null) {
            removed.add('a stylesheet outside the page folder');
          }
        } else {
          removed.add(rel.includes('stylesheet') ? 'a remote stylesheet' : '<link>');
        }
        continue;
      }
      if (tag === 'style') {
        styles.push(packCss(textOf(node), pageDir, ctx));
        continue;
      }
      cleanAttributes(node, tag, input.root, pageDir, ctx);
      if ('content' in node) visit((node as DefaultTreeAdapterMap['template']).content);
      visit(node);
      keep.push(node);
    }
    parent.childNodes = keep;
  };
  visit(document);

  // The one stylesheet, linked at the end of <head>.
  const head = findElement(document, 'head');
  if (head !== null) {
    defaultTreeAdapter.appendChild(
      head,
      defaultTreeAdapter.createElement(
        'link',
        'http://www.w3.org/1999/xhtml' as DefaultTreeAdapterMap['element']['namespaceURI'],
        [
          { name: 'rel', value: 'stylesheet' },
          { name: 'href', value: PACKED_STYLES },
        ],
      ),
    );
  }

  // The parts.
  const ids: string[] = [];
  const parts: Record<string, PartPrint> = {};
  const walk = (node: Node, ancestors: string[]): void => {
    let inner = ancestors;
    if (isElement(node)) {
      const id = attr(node, 'data-cp-id');
      if (id !== undefined && id.trim() !== '') {
        if (id.length > ID_MAX) throw new PackError(`A data-cp-id is longer than ${ID_MAX}.`);
        if (parts[id] !== undefined) throw new PackError(`The data-cp-id "${id}" is used twice.`);
        const outer = serializeOuter(node);
        parts[id] = {
          hash: createHash('sha256').update(outer).digest('hex'),
          text: collapse(textOf(node), MAX_TEXT),
          ancestors,
          excerpt: outer.length <= MAX_EXCERPT ? outer : `${outer.slice(0, MAX_EXCERPT)}…`,
        };
        ids.push(id);
        inner = [...ancestors, id];
      }
    }
    if ('childNodes' in node) for (const child of node.childNodes) walk(child, inner);
    if (isElement(node) && 'content' in node) {
      walk((node as DefaultTreeAdapterMap['template']).content, inner);
    }
  };
  walk(document, []);

  mkdirSync(input.outDir, { recursive: true });
  writeFileSync(join(input.outDir, PACKED_PAGE), serialize(document));
  writeFileSync(join(input.outDir, PACKED_STYLES), styles.join('\n'));
  const result: PackResult = { ids, parts, removed: [...removed].sort() };
  writeFileSync(join(input.outDir, PACKED_PARTS), JSON.stringify(result));
  return result;
}

function cleanAttributes(
  element: Element,
  tag: string,
  root: string,
  pageDir: string,
  ctx: CssContext,
): void {
  const kept: Element['attrs'] = [];
  for (const a of element.attrs) {
    const name = (a.prefix === undefined ? a.name : `${a.prefix}:${a.name}`).toLowerCase();
    if (name.startsWith('on')) {
      ctx.removed.add('on* attributes');
      continue;
    }
    if (name === 'autofocus' || name === 'target' || name === 'http-equiv') continue;
    if (name === 'style') {
      kept.push({ ...a, value: packCss(a.value, pageDir, ctx) });
      continue;
    }
    if (URL_ATTRS.has(name)) {
      const value = a.value.trim();
      if (/^(javascript|vbscript):/i.test(squash(value))) {
        ctx.removed.add('javascript: URLs');
        continue;
      }
      // Only what a page shows keeps a URL: an image's or video poster's source, an SVG
      // reference. Links, form targets, image sets and the rest go: nothing navigates or submits.
      const shows =
        name === 'src' ||
        name === 'poster' ||
        (name.endsWith('href') && (tag === 'use' || tag === 'image'));
      if (!shows) {
        if (name === 'action' || name === 'formaction') ctx.removed.add("forms' action");
        else if (name === 'href') ctx.removed.add('links');
        continue;
      }
      if (value.startsWith('#')) {
        kept.push(a);
        continue;
      }
      if (/^data:/i.test(value)) {
        if (isDataDocument(value)) ctx.removed.add('a data: document URL');
        else kept.push(a);
        continue;
      }
      if (isRemote(value)) {
        ctx.removed.add('remote URLs');
        continue;
      }
      const data = dataUrl(root, pageDir, value, false);
      if (data === null) ctx.removed.add('a file outside the page folder');
      else kept.push({ ...a, value: data });
      continue;
    }
    kept.push(a);
  }
  element.attrs = kept;
}
