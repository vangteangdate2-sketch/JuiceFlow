import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { AppLanguage } from '../types';
import { getTranslations, type TranslationSet } from '../i18n/translations';

const STORAGE_KEY = 'juiceflow_lang';

function readStoredLanguage(): AppLanguage {
  if (typeof window === 'undefined') return 'en';
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === 'km') return 'km';
  } catch {
    // Ignore storage read errors in restricted iframe/private modes
  }
  return 'en';
}

export interface LanguageContextValue {
  lang: AppLanguage;
  isKm: boolean;
  setLang: (next: AppLanguage) => void;
  toggleLang: () => void;
  t: TranslationSet;
}

const LanguageContext = createContext<LanguageContextValue | null>(null);

export const LanguageProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [lang, setLangState] = useState<AppLanguage>(() => readStoredLanguage());

  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.documentElement.lang = lang;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Ignore storage write errors
    }
  }, [lang]);

  const setLang = useCallback((next: AppLanguage) => {
    const normalized: AppLanguage = next === 'km' ? 'km' : 'en';
    setLangState(normalized);
    if (typeof document !== 'undefined') {
      document.documentElement.lang = normalized;
    }
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const toggleLang = useCallback(() => {
    setLangState((prev) => {
      const next: AppLanguage = prev === 'km' ? 'en' : 'km';
      if (typeof document !== 'undefined') {
        document.documentElement.lang = next;
      }
      try {
        window.localStorage.setItem(STORAGE_KEY, next);
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  }, []);

  const t = useMemo(() => getTranslations(lang), [lang]);

  const value = useMemo<LanguageContextValue>(
    () => ({
      lang,
      isKm: lang === 'km',
      setLang,
      toggleLang,
      t,
    }),
    [lang, setLang, toggleLang, t]
  );

  return <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>;
};

export function useLanguage(): LanguageContextValue {
  const ctx = useContext(LanguageContext);
  if (!ctx) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return ctx;
}
