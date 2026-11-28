import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { CheckCircle2, RotateCcw, X } from 'lucide-react';
import { useLanguage } from './LanguageContext';

export interface UndoToastOptions {
  message: string;
  detail?: string;
  durationMs?: number;
  onUndo: () => void | Promise<void>;
}

export interface NoticeToastOptions {
  message: string;
  detail?: string;
  durationMs?: number;
}

interface ActiveToast {
  id: number;
  message: string;
  detail?: string;
  durationMs: number;
  expiresAt: number;
  onUndo?: () => void | Promise<void>;
}

interface UndoToastContextValue {
  showUndoToast: (options: UndoToastOptions) => void;
  showNoticeToast: (options: NoticeToastOptions) => void;
  dismissUndoToast: () => void;
}

const UndoToastContext = createContext<UndoToastContextValue | null>(null);

const EXIT_ANIMATION_MS = 170;

export const UndoToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { isKm, t } = useLanguage();

  const [toast, setToast] = useState<ActiveToast | null>(null);
  const [exiting, setExiting] = useState(false);
  const [remainingSec, setRemainingSec] = useState(5);
  const [undoing, setUndoing] = useState(false);

  const timeoutRef = useRef<number | null>(null);
  const exitTimerRef = useRef<number | null>(null);
  const intervalRef = useRef<number | null>(null);
  const idCounterRef = useRef(0);

  const clearTimers = useCallback(() => {
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (exitTimerRef.current !== null) {
      window.clearTimeout(exitTimerRef.current);
      exitTimerRef.current = null;
    }
    if (intervalRef.current !== null) {
      window.clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  const triggerSmoothClose = useCallback(
    (expectedId?: number) => {
      if (intervalRef.current !== null) {
        window.clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setExiting(true);
      if (exitTimerRef.current !== null) {
        window.clearTimeout(exitTimerRef.current);
      }
      exitTimerRef.current = window.setTimeout(() => {
        exitTimerRef.current = null;
        setToast((prev) => {
          if (expectedId !== undefined && prev && prev.id !== expectedId) return prev;
          return null;
        });
        setExiting(false);
        setUndoing(false);
      }, EXIT_ANIMATION_MS);
    },
    []
  );

  const dismissUndoToast = useCallback(() => {
    triggerSmoothClose();
  }, [triggerSmoothClose]);

  const showUndoToast = useCallback(
    ({ message, detail, durationMs = 5000, onUndo }: UndoToastOptions) => {
      clearTimers();
      const id = ++idCounterRef.current;
      const expiresAt = Date.now() + durationMs;

      setUndoing(false);
      setExiting(false);
      setRemainingSec(Math.ceil(durationMs / 1000));
      setToast({ id, message, detail, durationMs, expiresAt, onUndo });

      intervalRef.current = window.setInterval(() => {
        const rem = Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
        setRemainingSec(rem);
      }, 200);

      timeoutRef.current = window.setTimeout(() => {
        triggerSmoothClose(id);
      }, durationMs);
    },
    [clearTimers, triggerSmoothClose]
  );

  const showNoticeToast = useCallback(
    ({ message, detail, durationMs = 2800 }: NoticeToastOptions) => {
      clearTimers();
      const id = ++idCounterRef.current;
      const expiresAt = Date.now() + durationMs;

      setUndoing(false);
      setExiting(false);
      setToast({ id, message, detail, durationMs, expiresAt });

      timeoutRef.current = window.setTimeout(() => {
        triggerSmoothClose(id);
      }, durationMs);
    },
    [clearTimers, triggerSmoothClose]
  );

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const handleUndo = async () => {
    if (!toast || !toast.onUndo || undoing) return;
    const action = toast.onUndo;
    setUndoing(true);
    clearTimers();
    setToast(null);
    setExiting(false);
    try {
      await action();
    } finally {
      setUndoing(false);
    }
  };

  return (
    <UndoToastContext.Provider value={{ showUndoToast, showNoticeToast, dismissUndoToast }}>
      {children}

      {toast && (
        <div
          key={toast.id}
          role="status"
          aria-live="polite"
          className={`fixed bottom-[84px] lg:bottom-5 right-4 left-4 sm:left-auto sm:min-w-[320px] sm:max-w-md z-[60] bg-stone-900 dark:bg-[#18251F] text-white dark:text-[#F1F5F3] border border-stone-700 dark:border-[#344B3F] rounded-xl px-4 py-3 shadow-xl flex items-center justify-between gap-3.5 print:hidden ${
            exiting ? 'animate-toast-exit' : 'animate-toast'
          }`}
        >
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            {!toast.onUndo && (
              <CheckCircle2 className="w-4 h-4 text-[#34D399] shrink-0" aria-hidden="true" />
            )}
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{toast.message}</p>
              {toast.onUndo ? (
                <p className="text-xs text-stone-400 dark:text-[#94A39B] font-mono-num truncate mt-0.5">
                  {toast.detail ? `${toast.detail} · ` : ''}
                  {isKm ? `ត្រឡប់ក្រោយ (${remainingSec}វិ)` : `Undo (${remainingSec}s)`}
                </p>
              ) : (
                toast.detail && (
                  <p className="text-xs text-stone-400 dark:text-[#94A39B] truncate mt-0.5">
                    {toast.detail}
                  </p>
                )
              )}
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {toast.onUndo && (
              <button
                type="button"
                onClick={() => void handleUndo()}
                disabled={undoing}
                className="h-11 px-3.5 inline-flex items-center gap-1.5 rounded-lg bg-[#10B981] hover:bg-[#34D399] text-[#042419] text-xs font-bold transition-colors whitespace-nowrap"
              >
                <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                <span>{t.common.undo}</span>
              </button>
            )}
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
