// Element maps (design-drafts 2.3, D-6): boxes and text per data-cp-id at 390 and 1440 px, the
// page height, a display:contents part measured by its children, and no scripts run. Skipped on a
// machine with no browser; the no-browser card is tested with the drafts service.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { DraftBrowser, findBrowser, NoBrowserError } from '../../src/drafts/browser.ts';
import { makeScratchDir, removeScratchDirs } from '../helpers/scratch.ts';

const browser = new DraftBrowser();
afterAll(async () => {
  await browser.close();
  removeScratchDirs();
});

const PAGE = `<!doctype html><html><head><style>
body { margin: 0 } .bar { height: 50px } .tall { height: 2000px }
@media (min-width: 1000px) { .bar { height: 80px } }
</style></head><body>
<div class="bar" data-cp-id="header">Today's orders</div>
<div style="display:contents" data-cp-id="wrap"><p style="margin:0;height:30px">One</p></div>
<div class="tall" data-cp-id="list">List</div>
<script>document.body.innerHTML = '<p data-cp-id="evil">ran</p>'</script>
</body></html>`;

describe('DraftBrowser', () => {
  it.skipIf(findBrowser() === null)(
    'maps every part at both widths without running scripts',
    async () => {
      const dir = makeScratchDir('cp-map-');
      const page = join(dir, 'page.html');
      writeFileSync(page, PAGE);
      const maps = await browser.maps(page);
      expect(maps.phone?.width).toBe(390);
      expect(maps.desktop?.width).toBe(1440);
      expect(maps.phone?.parts.map((p) => p.id)).toEqual(['header', 'wrap', 'list']);
      expect(maps.phone?.parts[0]).toMatchObject({
        x: 0,
        y: 0,
        w: 390,
        h: 50,
        text: "Today's orders",
      });
      expect(maps.desktop?.parts[0]).toMatchObject({ w: 1440, h: 80 });
      expect(maps.phone?.parts[1]).toMatchObject({ y: 50, h: 30, text: 'One' });
      expect(maps.phone?.height).toBe(2080);
    },
  );

  it('says so when no browser is installed', async () => {
    const none = new DraftBrowser({ find: () => null });
    await expect(none.map('/nowhere.html', 'phone')).rejects.toBeInstanceOf(NoBrowserError);
  });
});
