// The wire stylesheet (design-drafts D-2): a small, neutral set of classes every low-fi draft is
// drawn with. Grey boxes, real text, real layout; no colour beyond greys, no host code. Each low-fi
// session gets the vocabulary in its prompt and the file in its folder; the packer inlines it.
// Its exact vocabulary is tuned in the spike (design: Open Questions).

export const WIRE_FILE = 'wire.css';

export const WIRE_CSS = `/* Counterpoint wire stylesheet: low-fi drafts only. */
*, *::before, *::after { box-sizing: border-box; }
html { font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: #222; background: #fff; }
body { margin: 0; }
h1, h2, h3, p { margin: 0; }
.wf-page { display: flex; flex-direction: column; gap: 16px; padding: 16px; min-height: 100vh; }
.wf-split { display: flex; gap: 16px; align-items: flex-start; }
.wf-sidebar { flex: 0 0 220px; display: flex; flex-direction: column; gap: 8px; }
.wf-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 16px; }
@media (max-width: 700px) { .wf-split { flex-direction: column; } .wf-sidebar { flex-basis: auto; width: 100%; } }
.wf-bar { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border: 1px solid #bbb; background: #f2f2f2; }
.wf-stack { display: flex; flex-direction: column; gap: 12px; }
.wf-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
.wf-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; }
.wf-tight { gap: 4px; }
.wf-loose { gap: 24px; }
.wf-grow { flex: 1 1 auto; min-width: 0; }
.wf-end { margin-left: auto; }
.wf-box { border: 1px solid #bbb; background: #f2f2f2; padding: 12px; }
.wf-card { border: 1px solid #bbb; background: #fff; padding: 12px; display: flex; flex-direction: column; gap: 8px; }
.wf-image { background: #ddd; border: 1px solid #bbb; min-height: 80px; display: flex; align-items: center; justify-content: center; color: #888; font-size: 12px; }
.wf-title { font-size: 22px; font-weight: 700; }
.wf-heading { font-size: 17px; font-weight: 600; }
.wf-text { font-size: 15px; }
.wf-muted { color: #777; font-size: 13px; }
.wf-label { font-size: 13px; font-weight: 600; }
.wf-field { display: flex; flex-direction: column; gap: 4px; }
.wf-input { border: 1px solid #999; background: #fff; padding: 8px 10px; min-height: 36px; color: #888; }
.wf-check { display: flex; align-items: center; gap: 8px; }
.wf-check::before { content: ""; width: 16px; height: 16px; border: 1px solid #999; background: #fff; }
.wf-button { display: inline-flex; align-items: center; justify-content: center; border: 1px solid #666; background: #fff; padding: 8px 14px; min-height: 36px; font-weight: 600; }
.wf-button.wf-primary { background: #444; color: #fff; border-color: #444; }
.wf-tabs { display: flex; gap: 4px; border-bottom: 1px solid #bbb; }
.wf-tab { padding: 8px 12px; color: #666; }
.wf-tab.wf-current { color: #222; border-bottom: 2px solid #222; font-weight: 600; }
.wf-list { display: flex; flex-direction: column; border: 1px solid #bbb; }
.wf-item { display: flex; align-items: center; gap: 12px; padding: 10px 12px; border-bottom: 1px solid #ddd; }
.wf-item:last-child { border-bottom: 0; }
.wf-table { width: 100%; border-collapse: collapse; }
.wf-table th, .wf-table td { border: 1px solid #ccc; padding: 8px; text-align: left; }
.wf-table th { background: #f2f2f2; font-size: 13px; }
.wf-badge { display: inline-block; border: 1px solid #999; padding: 1px 8px; border-radius: 999px; font-size: 12px; }
.wf-divider { border: 0; border-top: 1px solid #ccc; margin: 0; width: 100%; }
`;

/** What a low-fi session is told about the stylesheet. */
export const WIRE_VOCABULARY = [
  'Layout: wf-page (the whole page), wf-split with wf-sidebar and wf-main (side navigation; stacks on a phone), wf-bar (a top or bottom bar), wf-stack (vertical), wf-row (horizontal, wraps), wf-grid (cards in columns). Modifiers: wf-tight, wf-loose (gap), wf-grow (takes the space), wf-end (pushed to the end).',
  'Blocks: wf-box (a grey placeholder area), wf-card, wf-image (a grey image placeholder; write what it shows inside), wf-divider (<hr>).',
  'Text: wf-title, wf-heading, wf-text, wf-muted, wf-label.',
  'Controls (drawn, never working): wf-field (a wf-label above a wf-input), wf-input (write its placeholder or value inside), wf-check, wf-button, wf-button wf-primary, wf-tabs with wf-tab and wf-tab wf-current, wf-badge.',
  'Lists and tables: wf-list with wf-item rows, wf-table (a plain <table> with <th> and <td>).',
].join('\n');
