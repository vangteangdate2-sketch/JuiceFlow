import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { RotateCcw, X } from 'lucide-react';
import { useStore } from './StoreContext';

export interface UndoToastOptions {
  message: string;
  detail?: string;
  durationMs?: number;
  onUndo: () => void | Promise<void>;
}

interface ActiveUndoToast {
  id: number;
  message: string;
  detail?: string;
  durationMs: number;
  expiresAt: number;
  onUndo: () => void | Promise<void>;
}

interface UndoToastContextValue {
  showUndoToast: (options: UndoToastOptions) => void;
  dismissUndoToast: () => void;
}

const UndoToastContext = createContext<UndoToastContextValue | null>(null);

export const UndoToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { settings, t } = useStore();
  const isVi = settings?.language === 'vi';

  const [toast, setToast] = useState<ActiveUndoToast | null>(null);
  const [remainingSec, setRemainingSec] = useState(5);
  const [undoing, setUndoing] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const idCounterRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const dismissUndoToast = useCallback(() => {
    clearTimers();
    setToast(null);
    setUndoing(false);
  }, [clearTimers]);

  const showUndoToast = useCallback(
    ({ message, detail, durationMs = 5000, onUndo }: UndoToastOptions) => {
      clearTimers();
      const id = ++idCounterRef.current;
      const expiresAt = Date.now() + durationMs;

      setUndoing(false);
      setRemainingSec(Math.ceil(durationMs / 1000));
      setToast({ id, message, detail, durationMs, expiresAt, onUndo });

      intervalRef.current = window.setInterval(() => {
        const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        setRemainingSec(rem);
      }, 200);

      timeoutRef.current = window.setTimeout(() => {
        clearTimers();
        setToast((prev) => (prev && prev.id === id ? null : prev));
      }, durationMs);
    },
    [clearTimers]
  );

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleUndo = async () => {
    if (!toast || undoing) return;
    const action = toast.onUndo;
    setUndoing(true);
    clearTimers();
    setToast(null);
    try {
      await action();
    } finally {
      setUndoing(false);
    }
  };

  return (
    <UndoToastContext.Provider value={{ showUndoToast, dismissUndoToast }}>
      {children}

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-[84px] lg:bottom-5 right-4 left-4 sm:left-auto sm:min-w-[360px] sm:max-w-md z-50 bg-stone-900 dark:bg-[#18251F] text-white dark:text-[#F1F5F3] border border-stone-700 dark:border-[#344B3F] rounded-xl px-4 py-3 shadow-lg flex items-center justify-between gap-3.5 print:hidden"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{toast.message}</p>
            <p className="text-xs text-stone-400 dark:text-[#94A39B] font-mono-num truncate mt-0.5">
              {toast.detail ? `${toast.detail} · ` : ''}
              {isVi ? `Hoàn tác (${remainingSec}s)` : `Undo (${remainingSec}s)`}
            </p>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => void handleUndo()}
              disabled={undoing}
              className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#042419] text-xs font-bold transition-colors whitespace-nowrap"
            >
              <RotateCcw className="w-3.5 h-3.5 shrink-0" />
              <span>{isVi ? 'Hoàn tác' : 'Undo'}</span>
            </button>
            <button
              type="button"
              onClick={dismissUndoToast}
              aria-label={t.common.close}
              className="w-10 h-10 inline-flex items-center justify-center rounded-lg text-stone-400 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </UndoToastContext.Provider>
  );
};

export function useUndoToast(): UndoToastContextValue {
  const ctx = useContext(UndoToastContext);
  if (!ctx) {
    throw new Error('useUndoToast must be used within UndoToastProvider');
  }
  return ctx;
}
