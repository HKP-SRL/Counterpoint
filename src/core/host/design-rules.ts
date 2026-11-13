// The host's design rules (design-drafts D-11): `.counterpoint/design-rules.md`, layout and density
// rules every draft session and every builder session follows. Read at a commit through the git
// reader, like the host config, never from a working tree. At most 8 KB is given: a longer file is
// cut at the last whole line before the cap, and the prompt says so.
import type { GitFileReader } from '../framework/port.ts';

export const DESIGN_RULES_PATH = '.counterpoint/design-rules.md';
export const DESIGN_RULES_MAX_BYTES = 8 * 1024;

export interface DesignRules {
  text: string;
  /** True when the file was longer than the cap and cut. */
  clipped: boolean;
}

/** The rules at `commit`, or null when there is no file (or it is empty or not text). */
export async function readDesignRules(
  reader: GitFileReader,
  commit: string,
): Promise<DesignRules | null> {
  const bytes = await reader.read(commit, DESIGN_RULES_PATH);
  if (bytes === null) return null;
  return designRulesFrom(bytes);
}

export function designRulesFrom(bytes: Uint8Array): DesignRules | null {
  const clipped = bytes.byteLength > DESIGN_RULES_MAX_BYTES;
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: !clipped }).decode(
      clipped ? bytes.subarray(0, DESIGN_RULES_MAX_BYTES) : bytes,
    );
  } catch {
    return null;
  }
  if (clipped) {
    const lastLine = text.lastIndexOf('\n');
    text = (lastLine > 0 ? text.slice(0, lastLine) : text).replace(/�+$/, '');
  }
  return text.trim() === '' ? null : { text: text.trimEnd(), clipped };
}
