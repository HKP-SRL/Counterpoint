// Reading context fill and the model's window from a claude stream-json event stream.
//
// Spikes 3.1 and 5.1 of first-unattended-run (claude 2.1.322):
// - Context fill per request is the latest assistant message's
//   `input_tokens + cache_read_input_tokens + cache_creation_input_tokens`. One message id
//   repeats once per content block (thinking, text, tool use), so a message counts once.
// - The model's window is only in a `result` event: `modelUsage[model].contextWindow`. There is
//   one `result` per turn. No window size is ever assumed here.
// - A subagent's messages (the Task tool, forks) arrive in the same stream with
//   `parent_tool_use_id` set to the tool call that started it; the main thread's have it null.
//   A subagent has its own context, so only the main thread's messages measure the session's fill
//   (seen live 2026-11-13: a fork peaked at 459k while the main thread peaked at 410k, and the
//   wrap-up fired on the fork's value). Subagent usage still counts as cost, in the result.
import type { StreamEvent } from './runner.ts';

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

/** True for an event a subagent printed (it names the tool call that started the subagent). */
export function fromSubagent(event: StreamEvent): boolean {
  const parent = (event as Record<string, unknown>).parent_tool_use_id;
  return typeof parent === 'string' && parent !== '';
}

/**
 * The context fill a main-thread assistant event reports, with its message id; null for other
 * events, a subagent's included.
 */
export function assistantFill(event: StreamEvent): { id: string; tokens: number } | null {
  if (event.type !== 'assistant' || fromSubagent(event)) return null;
  const message = record((event as Record<string, unknown>).message);
  if (message === null || typeof message.id !== 'string') return null;
  const usage = record(message.usage);
  if (usage === null) return null;
  return {
    id: message.id,
    tokens:
      count(usage.input_tokens) +
      count(usage.cache_read_input_tokens) +
      count(usage.cache_creation_input_tokens),
  };
}

/**
 * The context windows a `result` event reports, per model id (`modelUsage[model].contextWindow`).
 * Empty for any other event or when the result names none.
 */
export function resultWindows(event: StreamEvent): Map<string, number> {
  const windows = new Map<string, number>();
  if (event.type !== 'result') return windows;
  const usage = record((event as Record<string, unknown>).modelUsage);
  if (usage === null) return windows;
  for (const [model, value] of Object.entries(usage)) {
    const window = record(value)?.contextWindow;
    if (typeof window === 'number' && Number.isInteger(window) && window > 0) {
      windows.set(model, window);
    }
  }
  return windows;
}

/** The model a `system/init` event names, or null. */
export function initModel(event: StreamEvent): string | null {
  if (event.type !== 'system' || (event as { subtype?: unknown }).subtype !== 'init') return null;
  const model = (event as Record<string, unknown>).model;
  return typeof model === 'string' && model !== '' ? model : null;
}

/** Follows a session's context fill (its main thread's) as events arrive. */
export class ContextMeter {
  #seen = new Set<string>();
  #latest = 0;
  #peak = 0;

  /** Feeds one event. Returns the new fill when this event is a new assistant message. */
  observe(event: StreamEvent): number | null {
    const fill = assistantFill(event);
    if (fill === null || this.#seen.has(fill.id)) return null;
    this.#seen.add(fill.id);
    this.#latest = fill.tokens;
    if (fill.tokens > this.#peak) this.#peak = fill.tokens;
    return fill.tokens;
  }

  /** The fill of the latest assistant message (0 before the first). */
  get latest(): number {
    return this.#latest;
  }

  /** The highest fill seen. */
  get peak(): number {
    return this.#peak;
  }
}
