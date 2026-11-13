# Design drafts

How a project sets up hi-fi design drafts, and how to write a draft entry for Counterpoint's own console.

Low-fi drafts need nothing from the project: they are drawn with Counterpoint's wire stylesheet and never touch the project's code. Hi-fi drafts are drawn with the project's own components, so the project tells Counterpoint how to render one.

## 1. The `drafts` section

Add it to `.counterpoint/config.yaml` and land it on the base branch. Counterpoint reads it at the base tip, like gates.

```yaml
drafts:
  render: [node, scripts/render-draft.ts, '{entry}', '{out}']
  entry: draft.tsx        # the file name a hi-fi session writes, one per state
  guide: docs/drafts.md   # this file: how to write an entry in this project
  timeout: 2m             # optional; default 2m per render
```

- `render` is a command as an argument array (no shell). `{entry}` and `{out}` must each be an argument of their own.
- `entry` is a file name, without a folder.
- `guide` is a path in the repository. Sessions get its first 32 KB.

Without the section, the Drafts page says hi-fi is unavailable, and low-fi still works.

## 2. The render contract

For each state of a screen, a hi-fi session writes `.cp-draft/<state>/<entry>` in a worktree of the base branch. Counterpoint then runs `render` once per entry, from the worktree root, as you, in its own process group, with the timeout and a log:

- `{entry}` is the absolute path of the entry file.
- `{out}` is an empty folder. The command writes `{out}/page.html` and every stylesheet, font and image the page links, inside `{out}`.
- Exit code 0 means rendered. Anything else goes back to the session with the last lines of output, at most twice.

Counterpoint then packs the page: it removes scripts, event handlers, frames, links and anything remote, and inlines the linked styles and fonts into one `styles.css`. A file outside `{out}`, or a remote URL, is dropped. So render static markup, the way the screen looks at first paint, with relative links to files you copy into `{out}`.

Parts the owner can select and comment on are the elements with a `data-cp-id`. Each id must be unique in the page.

## 3. Writing a draft entry for Counterpoint's console

Counterpoint's renderer is `scripts/render-draft.ts`. It loads the entry through Vite (TSX, the console's React plugin), renders it inside the console's Astryx theme (neutral, light) with `react-dom/server`, and copies the console's stylesheet stack (reset, Astryx, the neutral theme, self-hosted Figtree) next to the page.

An entry is a TSX module:

- Its default export is a React component with no props: one state of one screen.
- `export const title = '…'` sets the page title (optional).
- Import Astryx components from `@astryxdesign/core/<Component>`, as `ui/src/pages` does. Use the same layout the page uses: `Layout` with `LayoutHeader` and `LayoutContent`, `VStack` / `HStack` with `gap`, `Card padding={4} elevation="none"`, `Text type="supporting" color="secondary"` for secondary lines, `Badge` for status, `Button` for decisions only.
- Use sample data written in the entry: the locked low-fi draft's text, never lorem ipsum. Do not fetch, and do not use React Query, the router or anything that needs the running console. Components render once, statically: hooks that run effects do nothing.
- Put `data-cp-id="…"` on every meaningful part. Astryx components do not pass unknown props to the DOM, so wrap the part: `<div data-cp-id="header" style={{ display: 'contents' }}>…</div>`. A `display: contents` wrapper has no box of its own; Counterpoint measures its children.
- Each state (empty, error, long text) is its own entry. Phone and desktop are frame widths, not separate entries: lay out with Astryx's stacks so both work.

The example is `ui/drafts/needs-you.tsx`, the Needs You card list. Render it yourself:

```sh
node scripts/render-draft.ts ui/drafts/needs-you.tsx /tmp/needs-you
open /tmp/needs-you/page.html
```

It takes about half a second.

## 4. Design rules

`.counterpoint/design-rules.md` holds the project's layout and density rules: for example, "forms group related fields". Every draft session and every builder session gets it verbatim. Counterpoint reads it at the base tip, at most 8 KB.

## 5. After sign-off

Sign off lands the hi-fi pages in the change's folder on the base branch, through one small PR:

- `drafts/styles.css`: the packed styles, fonts inlined;
- `drafts/<screen>/<state>.html`: the packed pages;
- `drafts/<screen>/source.md`: the entries, for the components and props they use.

A change with drafts builds only after every screen is signed off and its pages are on the base branch. At build start, Counterpoint renders each page to PNG at phone and desktop width in the worktree's `.cp-drafts/` (never committed), and the builder's prompt lists them under "Reference screens".
