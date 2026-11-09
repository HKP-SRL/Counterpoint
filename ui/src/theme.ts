// Theme preference (FOUND-06). RED stub: the behaviour is specified by ui/tests/theme.test.ts.
export const THEME_STORAGE_KEY = 'counterpoint.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

export const THEME_OPTIONS: readonly ThemePreference[] = ['light', 'dark', 'system'];

export function parseThemePreference(_value: string | null | undefined): ThemePreference {
  throw new Error('not implemented');
}

export function isDark(_preference: ThemePreference, _systemPrefersDark: boolean): boolean {
  throw new Error('not implemented');
}

export function themeOptionAfter(_current: ThemePreference, _key: string): ThemePreference {
  throw new Error('not implemented');
}
