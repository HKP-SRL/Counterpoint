// The shared atomic writer (IN-01): remove-then-exclusive-create of the temporary file, so a file
// or symlink planted at the predictable temporary name is never followed or reused.
import { lstatSync, readFileSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeFileAtomic0600 } from '../../../src/core/fs/atomic.ts';
import { makeScratchDir, removeScratchDirs } from '../../helpers/scratch.ts';

afterAll(removeScratchDirs);

describe('writeFileAtomic0600', () => {
  it('writes the content with mode 0600 and leaves no temporary file', () => {
    const dir = makeScratchDir('atomic');
    const file = join(dir, 'state.json');
    writeFileAtomic0600(file, '{"a":1}\n');
    expect(readFileSync(file, 'utf8')).toBe('{"a":1}\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(() => lstatSync(`${file}.${process.pid}.tmp`)).toThrow();
  });

  it('never writes through a symlink planted at the temporary name', () => {
    const dir = makeScratchDir('atomic');
    const victim = join(makeScratchDir('victim'), 'settings.json');
    writeFileSync(victim, 'untouched\n');
    const file = join(dir, 'state.json');
    symlinkSync(victim, `${file}.${process.pid}.tmp`);
    writeFileAtomic0600(file, 'new\n');
    expect(readFileSync(victim, 'utf8')).toBe('untouched\n');
    expect(lstatSync(file).isSymbolicLink()).toBe(false);
    expect(readFileSync(file, 'utf8')).toBe('new\n');
  });

  it('replaces a planted regular file at the temporary name instead of reusing its mode', () => {
    const dir = makeScratchDir('atomic');
    const file = join(dir, 'state.json');
    writeFileSync(`${file}.${process.pid}.tmp`, 'planted', { mode: 0o666 });
    writeFileAtomic0600(file, 'new\n');
    expect(statSync(file).mode & 0o777).toBe(0o600);
  });
});
