import { useCallback, useEffect, useState } from 'react';

export const FILTER_VISIBILITY_STORAGE_KEY = 'juiceflow_filters_visible';
const FILTER_VISIBILITY_EVENT = 'juiceflow:filter-visibility-change';

function readStoredFilterVisibility(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    const raw = window.localStorage.getItem(FILTER_VISIBILITY_STORAGE_KEY);
    if (raw === 'false') return false;
    if (raw === 'true') return true;
    return true;
  } catch {
    return true;
  }
}

function writeStoredFilterVisibility(visible: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(FILTER_VISIBILITY_STORAGE_KEY, String(visible));
  } catch {
    // Ignore storage quota / privacy mode errors
  }
  window.dispatchEvent(
    new CustomEvent<boolean>(FILTER_VISIBILITY_EVENT, { detail: visible })
  );
}

/**
 * Shared localStorage-persisted visibility toggle for collapsible filter bars
 * across Sales & POS, Products, Inventory, and Financial Reports.
 */
export function useFilterVisibility() {
  const [filtersOpen, setFiltersOpenState] = useState<boolean>(readStoredFilterVisibility);

  const setFiltersOpen = useCallback((next: boolean | ((prev: boolean) => boolean)) => {
    setFiltersOpenState((prev) => {
      const resolved = typeof next === 'function' ? next(prev) : next;
      if (resolved !== prev) {
        writeStoredFilterVisibility(resolved);
      } else {
        // Ensure localStorage reflects current value even if key was previously unset
        writeStoredFilterVisibility(resolved);
      }
      return resolved;
    });
  }, []);

  const toggleFilters = useCallback(() => {
    setFiltersOpen((prev) => !prev);
  }, [setFiltersOpen]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleCustomSync = (event: Event) => {
      const customEvent = event as CustomEvent<boolean>;
      if (typeof customEvent.detail === 'boolean') {
        setFiltersOpenState(customEvent.detail);
      } else {
        setFiltersOpenState(readStoredFilterVisibility());
      }
    };

    const handleStorageSync = (event: StorageEvent) => {
      if (event.key === FILTER_VISIBILITY_STORAGE_KEY) {
        setFiltersOpenState(readStoredFilterVisibility());
      }
    };

    window.addEventListener(FILTER_VISIBILITY_EVENT, handleCustomSync);
    window.addEventListener('storage', handleStorageSync);
    return () => {
      window.removeEventListener(FILTER_VISIBILITY_EVENT, handleCustomSync);
      window.removeEventListener('storage', handleStorageSync);
    };
  }, []);

  return {
    filtersOpen,
    setFiltersOpen,
    toggleFilters,
  };
}
