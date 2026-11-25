import React, { createContext, useCallback, useContext, useState } from 'react';

const STORAGE_KEY = 'juiceflow_show_hints';
const LEGACY_STORAGE_KEY = 'juiceflow_settings_show_hints';

export interface HintsContextValue {
  showHints: boolean;
  setShowHints: (next: boolean) => void;
  toggleShowHints: () => void;
  /** Increments every time the global showHints switch is toggled so individual overrides resync */
  resetEpoch: number;
}

const HintsContext = createContext<HintsContextValue | null>(null);

function readInitialShowHints(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved !== null) return saved === '1' || saved === 'true';
    const legacy = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy !== null) {
      const val = legacy === '1' || legacy === 'true';
      window.localStorage.setItem(STORAGE_KEY, val ? '1' : '0');
      return val;
    }
    return false;
  } catch {
    return false;
  }
}

export const HintsProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [showHints, setShowHintsState] = useState<boolean>(readInitialShowHints);
  const [resetEpoch, setResetEpoch] = useState(0);

  const setShowHints = useCallback((next: boolean) => {
    setShowHintsState(next);
    setResetEpoch((e) => e + 1);
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const toggleShowHints = useCallback(() => {
    setShowHintsState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
    setResetEpoch((e) => e + 1);
  }, []);

  return (
    <HintsContext.Provider value={{ showHints, setShowHints, toggleShowHints, resetEpoch }}>
      {children}
    </HintsContext.Provider>
  );
};

export function useHints(): HintsContextValue {
  const ctx = useContext(HintsContext);
  if (!ctx) {
    return {
      showHints: false,
      setShowHints: () => {},
      toggleShowHints: () => {},
      resetEpoch: 0,
    };
  }
  return ctx;
}
