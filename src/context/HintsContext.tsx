import React, { createContext, useCallback, useContext, useState } from 'react';
import type { AppTab } from '../types';

const STORAGE_KEY = 'juiceflow_show_hints';
const LEGACY_STORAGE_KEY = 'juiceflow_settings_show_hints';
const HIDE_OUTSIDE_SETTINGS_KEY = 'juiceflow_hide_hints_outside_settings';

export interface HintsContextValue {
  showHints: boolean;
  setShowHints: (next: boolean) => void;
  toggleShowHints: () => void;
  /** Increments every time the global showHints switch is toggled so individual overrides resync */
  resetEpoch: number;
  /** Current active top-level view/route */
  activeView: AppTab;
  /** When true, ? hint icons are hidden on all views except 'settings' */
  hideHintsOutsideSettings: boolean;
  setHideHintsOutsideSettings: (hide: boolean) => void;
  toggleHideHintsOutsideSettings: () => void;
  /** True when ? hint buttons should be rendered on the current activeView */
  areQuestionHintsVisible: boolean;
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

function readInitialHideOutsideSettings(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const saved = window.localStorage.getItem(HIDE_OUTSIDE_SETTINGS_KEY);
    if (saved !== null) return saved === '1' || saved === 'true';
    return false;
  } catch {
    return false;
  }
}

export interface HintsProviderProps {
  activeView?: AppTab;
  children: React.ReactNode;
}

export const HintsProvider: React.FC<HintsProviderProps> = ({
  activeView = 'dashboard',
  children,
}) => {
  const [showHints, setShowHintsState] = useState<boolean>(readInitialShowHints);
  const [hideHintsOutsideSettings, setHideHintsOutsideSettingsState] = useState<boolean>(
    readInitialHideOutsideSettings
  );
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

  const setHideHintsOutsideSettings = useCallback((hide: boolean) => {
    setHideHintsOutsideSettingsState(hide);
    try {
      window.localStorage.setItem(HIDE_OUTSIDE_SETTINGS_KEY, hide ? '1' : '0');
    } catch {
      // Ignore storage write errors
    }
  }, []);

  const toggleHideHintsOutsideSettings = useCallback(() => {
    setHideHintsOutsideSettingsState((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(HIDE_OUTSIDE_SETTINGS_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  }, []);

  // Route-aware exception: always show ? hints on the Settings view
  const areQuestionHintsVisible = activeView === 'settings' || !hideHintsOutsideSettings;

  return (
    <HintsContext.Provider
      value={{
        showHints,
        setShowHints,
        toggleShowHints,
        resetEpoch,
        activeView,
        hideHintsOutsideSettings,
        setHideHintsOutsideSettings,
        toggleHideHintsOutsideSettings,
        areQuestionHintsVisible,
      }}
    >
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
      activeView: 'dashboard',
      hideHintsOutsideSettings: false,
      setHideHintsOutsideSettings: () => {},
      toggleHideHintsOutsideSettings: () => {},
      areQuestionHintsVisible: true,
    };
  }
  return ctx;
}
