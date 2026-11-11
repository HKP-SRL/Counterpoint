// Builds the console once before the e2e project runs, so the daemon serves the current UI.
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execa } from 'execa';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export default async function setup(): Promise<void> {
  await execa('pnpm', ['build:ui'], { cwd: REPO_ROOT, stdio: 'inherit' });
}
