import { useEffect, useState } from 'react';
import { applyTheme, readThemePreference, systemTheme, THEME_STORAGE_KEY, type Theme } from '../lib/theme';

export function ThemeToggle() {
  const [preference, setPreference] = useState<Theme | null>(readThemePreference);
  const [deviceTheme, setDeviceTheme] = useState<Theme>(systemTheme);
  const theme = preference ?? deviceTheme;
  const nextTheme = theme === 'dark' ? 'light' : 'dark';

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-color-scheme: dark)');
    const update = () => setDeviceTheme(query.matches ? 'dark' : 'light');
    query.addEventListener('change', update);
    update();
    return () => query.removeEventListener('change', update);
  }, []);

  function toggleTheme() {
    setPreference(nextTheme);
    applyTheme(nextTheme);
    try {
      // Only this display preference is persisted. Notes and keys stay in memory.
      localStorage.setItem(THEME_STORAGE_KEY, nextTheme);
    } catch {
      // The toggle still works when browser storage is unavailable.
    }
  }

  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={toggleTheme}
      aria-label={`Switch to ${nextTheme} mode`}
      title={`Switch to ${nextTheme} mode`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
        {theme === 'dark' ? (
          <>
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42" />
          </>
        ) : (
          <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />
        )}
      </svg>
    </button>
  );
}
