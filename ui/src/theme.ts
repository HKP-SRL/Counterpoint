// Theme preference (local-console: Light, dark and system themes): Light, Dark or System, persisted
// in localStorage and applied through Astryx's `<Theme mode>`. `/theme-init.js` applies the same
// choice before first paint, so the two must agree on the storage key and the accepted values.
//
// Logic ported from the Cena mission console (mission-theme.ts / use-mission-theme.ts), without
// its class toggling, cookie persistence or inline boot script: Astryx owns the attribute on
// <html>, and the CSP forbids inline script.
import type { ThemeMode } from '@astryxdesign/core/theme';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from 'react';

export const THEME_STORAGE_KEY = 'counterpoint.theme';

export type ThemePreference = 'light' | 'dark' | 'system';

/** Menu order: Light, Dark, System. */
export const THEME_OPTIONS: readonly ThemePreference[] = ['light', 'dark', 'system'];

const DARK_QUERY = '(prefers-color-scheme: dark)';

/** Only the three exact values are accepted; anything else (missing, cased, markup) is System. */
export function parseThemePreference(value: string | null | undefined): ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

export function isDark(preference: ThemePreference, systemPrefersDark: boolean): boolean {
  return preference === 'dark' || (preference === 'system' && systemPrefersDark);
}

/** Keyboard movement through the options: arrows wrap, Home and End jump. */
export function themeOptionAfter(current: ThemePreference, key: string): ThemePreference {
  const index = THEME_OPTIONS.indexOf(current);
  const count = THEME_OPTIONS.length;
  let next = index;
  switch (key) {
    case 'ArrowDown':
    case 'ArrowRight':
      next = (index + 1) % count;
      break;
    case 'ArrowUp':
    case 'ArrowLeft':
      next = (index - 1 + count) % count;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = count - 1;
      break;
    default:
      return current;
  }
  return THEME_OPTIONS[next] ?? current;
}

function readStoredPreference(): ThemePreference {
  try {
    return parseThemePreference(window.localStorage.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia(DARK_QUERY).matches;
}

export interface ThemePreferenceState {
  preference: ThemePreference;
  /** The resolved mode handed to Astryx's `<Theme mode>`. */
  mode: Exclude<ThemeMode, 'system'>;
  /** Persists the choice and returns the mode it resolves to. */
  choose: (preference: ThemePreference) => Exclude<ThemeMode, 'system'>;
}

/**
 * The owner's theme choice. Reconciles from localStorage on mount and when the page is restored
 * from the back/forward cache, follows the OS setting live only in System mode, and keeps other
 * tabs in step through the `storage` event.
 */
export function useThemePreference(): ThemePreferenceState {
  const [preference, setPreference] = useState<ThemePreference>(readStoredPreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useLayoutEffect(() => {
    // /theme-init.js set an inline color-scheme for the first paint; from here on Astryx's
    // data-theme rules own it, so a later choice is never overridden by the stale inline value.
    document.documentElement.style.removeProperty('color-scheme');
    const reconcile = () => setPreference(readStoredPreference());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) reconcile();
    };
    reconcile();
    window.addEventListener('pageshow', reconcile);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener('pageshow', reconcile);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  useEffect(() => {
    if (preference !== 'system' || typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(DARK_QUERY);
    const onChange = () => setPrefersDark(query.matches);
    onChange();
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [preference]);

  const choose = useCallback((next: ThemePreference) => {
    try {
      window.localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      // Storage unavailable (private mode, quota): the choice still applies to this page.
    }
    setPreference(next);
    return isDark(next, systemPrefersDark()) ? 'dark' : 'light';
  }, []);

  const mode = isDark(preference, prefersDark) ? 'dark' : 'light';
  return useMemo(() => ({ preference, mode, choose }), [preference, mode, choose]);
}

/** Shares the root's theme state with the theme menu in the TopNav. */
export const ThemePreferenceContext = createContext<ThemePreferenceState | null>(null);

export function useThemeChoice(): ThemePreferenceState {
  const value = useContext(ThemePreferenceContext);
  if (value === null) throw new Error('useThemeChoice must be used inside the theme provider.');
  return value;
}
