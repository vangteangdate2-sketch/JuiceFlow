import { useCallback, useEffect, useState } from 'react';

export type ThemeMode = 'light' | 'dark';

const STORAGE_KEY = 'juiceflow_theme';
const THEME_EVENT = 'juiceflow-theme-change';

function getStoredTheme(): ThemeMode | null {
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === 'light' || saved === 'dark') {
      return saved;
    }
  } catch {
    // Ignore storage errors (e.g. private browsing)
  }
  return null;
}

function getSystemTheme(): ThemeMode {
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function resolveInitialTheme(): ThemeMode {
  if (typeof window === 'undefined') return 'light';
  return getStoredTheme() ?? getSystemTheme();
}

function applyThemeToDocument(mode: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', mode === 'dark');
  root.style.colorScheme = mode;

  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) {
    metaTheme.setAttribute('content', mode === 'dark' ? '#0b110e' : '#0f5c43');
  }
}

export function useTheme() {
  const [theme, setThemeState] = useState<ThemeMode>(resolveInitialTheme);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Sync across components calling useTheme() and across tabs
  useEffect(() => {
    const handleCustom = (e: Event) => {
      const next = (e as CustomEvent<ThemeMode>).detail;
      if (next === 'light' || next === 'dark') {
        setThemeState(next);
      }
    };

    const handleStorage = (e: StorageEvent) => {
      if (e.key === STORAGE_KEY) {
        setThemeState(getStoredTheme() ?? getSystemTheme());
      }
    };

    const mediaQuery =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-color-scheme: dark)')
        : null;

    const handleMedia = (e: MediaQueryListEvent) => {
      // Only follow OS preference if user has not saved an explicit choice
      if (!getStoredTheme()) {
        const next: ThemeMode = e.matches ? 'dark' : 'light';
        applyThemeToDocument(next);
        setThemeState(next);
      }
    };

    window.addEventListener(THEME_EVENT, handleCustom);
    window.addEventListener('storage', handleStorage);
    if (mediaQuery?.addEventListener) {
      mediaQuery.addEventListener('change', handleMedia);
    }

    return () => {
      window.removeEventListener(THEME_EVENT, handleCustom);
      window.removeEventListener('storage', handleStorage);
      if (mediaQuery?.removeEventListener) {
        mediaQuery.removeEventListener('change', handleMedia);
      }
    };
  }, []);

  const setTheme = useCallback((next: ThemeMode) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
    applyThemeToDocument(next);
    setThemeState(next);
    window.dispatchEvent(new CustomEvent<ThemeMode>(THEME_EVENT, { detail: next }));
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(theme === 'dark' ? 'light' : 'dark');
  }, [theme, setTheme]);

  return {
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggleTheme,
  };
}
