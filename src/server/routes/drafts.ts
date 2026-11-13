// The console's design-drafts API (design-drafts D-13). Everything is scoped to one host and
// change; a screen, draft or mark of another change is not found.
//
//   GET  /api/hosts/:hostId/drafts/:changeId                      the Drafts page's view
//   POST /api/hosts/:hostId/drafts/:changeId/start                start drafts (the screen list)
//   POST /api/hosts/:hostId/drafts/:changeId/retry-list           Try again on the screen list
//   POST /api/hosts/:hostId/drafts/:changeId/drop                 Drop drafts (ends the hold)
//   POST /api/hosts/:hostId/drafts/:changeId/screens              add a screen { name }
//   POST .../screens/:screenId/rename { name } | /drop | /round | /unlock | /send | /retry | /sign-off
//   POST .../drafts/:draftId/lock | /retry | /marks { part, kind, note, width }
//   POST .../marks/:markId/delete
//
// Writes are guarded POSTs like every /api write. Refusals come back as 409 with the reason.
import type { Context, Hono } from 'hono';
import { z } from 'zod';
import { HOST_ID_RE, isChangeId } from '../../core/ids.ts';
import { draftScreen, getMark, getScreen } from '../../core/store/drafts.ts';
import { type Drafts, DraftsRefused } from '../../drafts/service.ts';

export interface DraftRoutesOptions {
  drafts: Drafts;
  /** The draft server's origin (`http://127.0.0.1:<port>`), or null when it is not running. */
  draftOrigin: () => string | null;
}

const Name = z.strictObject({ name: z.string().trim().min(1).max(60) });
const Mark = z.strictObject({
  part: z.string().min(1).max(100),
  kind: z.enum(['select', 'comment']),
  note: z.string().max(2000).nullable().default(null),
  width: z.enum(['phone', 'desktop']),
});

export function mountDraftRoutes(app: Hono, options: DraftRoutesOptions): void {
  const { drafts } = options;
  const base = '/api/hosts/:hostId/drafts/:changeId';

  const scope = (c: Context) => {
    const hostId = c.req.param('hostId') ?? '';
    const changeId = c.req.param('changeId') ?? '';
    if (!HOST_ID_RE.test(hostId) || !isChangeId(changeId)) return null;
    return { hostId, changeId };
  };

  const id = (c: Context, name: string): number | null => {
    const raw = c.req.param(name) ?? '';
    return /^\d{1,12}$/.test(raw) ? Number(raw) : null;
  };

  /** A screen of the scoped change, or null. */
  const screenIn = (c: Context) => {
    const s = scope(c);
    const screenId = id(c, 'screenId');
    if (s === null || screenId === null) return null;
    const screen = getScreen(drafts.store, screenId);
    return screen?.hostId === s.hostId && screen.change === s.changeId ? screen : null;
  };

  const draftIn = (c: Context) => {
    const s = scope(c);
    const draftId = id(c, 'draftId');
    if (s === null || draftId === null) return null;
    const screen = draftScreen(drafts.store, draftId);
    return screen?.hostId === s.hostId && screen.change === s.changeId ? draftId : null;
  };

  /** Runs an action; a refusal is a 409 with its reason. */
  const act = async (c: Context, fn: () => unknown | Promise<unknown>) => {
    try {
      const result = await fn();
      return c.json({ ok: true, ...(typeof result === 'string' ? { outcome: result } : {}) });
    } catch (error) {
      if (error instanceof DraftsRefused) return c.json({ error: error.message }, 409);
      throw error;
    }
  };

  const body = async <T>(c: Context, schema: z.ZodType<T>): Promise<T | null> => {
    const parsed = schema.safeParse(await c.req.json().catch(() => null));
    return parsed.success ? parsed.data : null;
  };

  app.get(base, async (c) => {
    const s = scope(c);
    if (s === null) return c.json({ error: 'not found' }, 404);
    try {
      return c.json({
        ...(await drafts.view(s.hostId, s.changeId)),
        origin: options.draftOrigin(),
      });
    } catch (error) {
      if (error instanceof DraftsRefused) return c.json({ error: error.message }, 404);
      throw error;
    }
  });

  app.post(`${base}/start`, async (c) => {
    const s = scope(c);
    if (s === null) return c.json({ error: 'not found' }, 404);
    return act(c, () => drafts.start(s.hostId, s.changeId));
  });

  app.post(`${base}/retry-list`, async (c) => {
    const s = scope(c);
    if (s === null) return c.json({ error: 'not found' }, 404);
    return act(c, () => drafts.retryList(s.hostId, s.changeId));
  });

  app.post(`${base}/drop`, async (c) => {
    const s = scope(c);
    if (s === null) return c.json({ error: 'not found' }, 404);
    return act(c, async () => {
      await drafts.drop(s.hostId, s.changeId);
    });
  });

  app.post(`${base}/screens`, async (c) => {
    const s = scope(c);
    if (s === null) return c.json({ error: 'not found' }, 404);
    const input = await body(c, Name);
    if (input === null) return c.json({ error: 'A screen needs a name.' }, 400);
    return act(c, () => {
      drafts.addScreen(s.hostId, s.changeId, { name: input.name });
    });
  });

  app.post(`${base}/screens/:screenId/:action`, async (c) => {
    const screen = screenIn(c);
    if (screen === null) return c.json({ error: 'not found' }, 404);
    switch (c.req.param('action')) {
      case 'rename': {
        const input = await body(c, Name);
        if (input === null) return c.json({ error: 'A screen needs a name.' }, 400);
        return act(c, () => {
          drafts.renameScreen(screen.id, input.name);
        });
      }
      case 'drop':
        return act(c, () => drafts.dropScreen(screen.id));
      case 'round':
        return act(c, () => {
          drafts.startRound(screen.id);
        });
      case 'unlock':
        return act(c, async () => {
          await drafts.unlock(screen.id);
        });
      case 'send':
        return act(c, () => {
          drafts.send(screen.id);
        });
      case 'retry':
        return act(c, () => drafts.retryHiFi(screen.id));
      case 'sign-off':
        return act(c, () => drafts.signOff(screen.id));
      default:
        return c.json({ error: 'not found' }, 404);
    }
  });

  app.post(`${base}/drafts/:draftId/:action`, async (c) => {
    const draftId = draftIn(c);
    if (draftId === null) return c.json({ error: 'not found' }, 404);
    switch (c.req.param('action')) {
      case 'lock':
        return act(c, () => drafts.lock(draftId));
      case 'retry':
        return act(c, () => drafts.retryDraft(draftId));
      case 'marks': {
        const input = await body(c, Mark);
        if (input === null) return c.json({ error: 'Not a mark.' }, 400);
        return act(c, () => {
          drafts.mark(draftId, input);
        });
      }
      default:
        return c.json({ error: 'not found' }, 404);
    }
  });

  app.post(`${base}/marks/:markId/delete`, async (c) => {
    const s = scope(c);
    const markId = id(c, 'markId');
    const mark = markId === null ? undefined : getMark(drafts.store, markId);
    const screen = mark === undefined ? undefined : getScreen(drafts.store, mark.screenId);
    if (s === null || screen?.hostId !== s.hostId || screen.change !== s.changeId) {
      return c.json({ error: 'not found' }, 404);
    }
    return act(c, () => drafts.unmark(mark?.id as number));
  });
}
