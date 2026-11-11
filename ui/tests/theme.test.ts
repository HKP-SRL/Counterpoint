// Pure theme-preference logic (local-console: Light, dark and system themes): parsing the stored
// value, resolving dark mode, and keyboard movement through the Light / Dark / System options.
import { describe, expect, it } from 'vitest';
import {
  isDark,
  parseThemePreference,
  THEME_OPTIONS,
  THEME_STORAGE_KEY,
  themeOptionAfter,
} from '../src/theme';

describe('THEME_STORAGE_KEY', () => {
  it('is counterpoint.theme', () => {
    expect(THEME_STORAGE_KEY).toBe('counterpoint.theme');
  });

  it('lists the options in menu order: light, dark, system', () => {
    expect(THEME_OPTIONS).toEqual(['light', 'dark', 'system']);
  });
});

describe('parseThemePreference', () => {
  it('accepts light, dark and system as they are', () => {
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('system')).toBe('system');
  });

  it('falls back to system for a missing value', () => {
    expect(parseThemePreference(null)).toBe('system');
    expect(parseThemePreference(undefined)).toBe('system');
  });

  it('falls back to system for anything else, including near misses and markup', () => {
    for (const value of ['Dark', 'LIGHT', ' dark', 'dark ', '', '<script>', 'auto', '1']) {
      expect(parseThemePreference(value)).toBe('system');
    }
  });
});

describe('isDark', () => {
  it('follows the system setting in system mode', () => {
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });

  it('ignores the system setting for an explicit choice', () => {
    expect(isDark('light', true)).toBe(false);
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', false)).toBe(false);
    expect(isDark('dark', true)).toBe(true);
  });
});

describe('themeOptionAfter', () => {
  it('moves to the next option with ArrowDown and ArrowRight, wrapping at the end', () => {
    expect(themeOptionAfter('light', 'ArrowDown')).toBe('dark');
    expect(themeOptionAfter('dark', 'ArrowRight')).toBe('system');
    expect(themeOptionAfter('system', 'ArrowDown')).toBe('light');
  });

  it('moves back with ArrowUp and ArrowLeft, wrapping at the start', () => {
    expect(themeOptionAfter('system', 'ArrowUp')).toBe('dark');
    expect(themeOptionAfter('dark', 'ArrowLeft')).toBe('light');
    expect(themeOptionAfter('light', 'ArrowUp')).toBe('system');
  });

  it('jumps to the first and last option with Home and End', () => {
    expect(themeOptionAfter('dark', 'Home')).toBe('light');
    expect(themeOptionAfter('light', 'End')).toBe('system');
  });

  it('keeps the current option for any other key', () => {
    expect(themeOptionAfter('dark', 'Enter')).toBe('dark');
    expect(themeOptionAfter('system', 'a')).toBe('system');
  });
});
