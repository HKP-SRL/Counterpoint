// First-paint theme (FOUND-06). Loaded synchronously from <head> as a same-origin file, because
// the console's CSP (`script-src 'self'`) forbids inline script. It applies the owner's stored
// choice before the page paints, so a dark console never flashes light. It reads only
// localStorage, accepts only the three known values, takes no server data and never throws.
// Keep the key and values in step with ui/src/theme.ts.
(() => {
  try {
    let stored = null;
    try {
      stored = window.localStorage.getItem('counterpoint.theme');
    } catch (_storageError) {
      stored = null;
    }
    const preference =
      stored === 'light' || stored === 'dark' || stored === 'system' ? stored : 'system';
    const systemDark =
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches;
    const mode =
      preference === 'dark' || (preference === 'system' && systemDark) ? 'dark' : 'light';
    const root = document.documentElement;
    // The same attribute Astryx's root <Theme> sets; reset.css maps it to color-scheme.
    root.setAttribute('data-theme', mode);
    root.style.colorScheme = mode;
  } catch (_error) {
    // Never block the page: without this script the console still renders in System mode.
  }
})();
