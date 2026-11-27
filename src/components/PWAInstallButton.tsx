import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useStore } from '../context/StoreContext';
import { ModalPortal } from './ModalPortal';

export const PWAInstallButton: React.FC<{ variant?: 'compact' | 'full' }> = ({
  variant = 'compact',
}) => {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const { t } = useStore();
  const [showIOSGuide, setShowIOSGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  if (isInstallable) {
    return (
      <button
        type="button"
        onClick={install}
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-800 dark:text-[#F1F5F3] hover:bg-stone-50 dark:hover:bg-[#1F3028] transition-colors whitespace-nowrap shrink-0 font-medium ${
          variant === 'full' ? 'h-11 px-4 text-sm' : 'h-11 px-3.5 text-xs'
        }`}
      >
        <Download className="w-4 h-4 shrink-0" />
        {t.common.installApp}
      </button>
    );
  }

  if (isIOS) {
    return (
      <>
        <button
          type="button"
          onClick={() => setShowIOSGuide(true)}
          className={`inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 dark:border-[#24352C] bg-white dark:bg-[#18251F] text-stone-800 dark:text-[#F1F5F3] hover:bg-stone-50 dark:hover:bg-[#1F3028] transition-colors whitespace-nowrap shrink-0 font-medium ${
            variant === 'full' ? 'h-11 px-4 text-sm' : 'h-11 px-3.5 text-xs'
          }`}
        >
          <Download className="w-4 h-4 shrink-0" />
          {t.common.installOnIOS}
        </button>

        {showIOSGuide && (
          <ModalPortal>
            <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/35 dark:bg-black/60 backdrop-blur-sm transition-opacity duration-200 animate-backdrop">
              <div className="w-full max-w-sm rounded-2xl bg-white dark:bg-[#111916] border border-slate-200/80 dark:border-emerald-950/60 shadow-2xl p-6 animate-modal">
              <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3]">
                  {t.common.iosInstallTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="w-11 h-11 inline-flex items-center justify-center text-stone-500 dark:text-[#94A39B] hover:text-stone-900 dark:hover:text-[#F1F5F3] rounded-lg"
                  aria-label={t.common.close}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-stone-600 dark:text-[#94A39B] list-decimal list-inside mb-5">
                <li>{t.common.iosInstallStep1}</li>
                <li>{t.common.iosInstallStep2}</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full h-11 rounded-lg bg-[#0F5C43] hover:bg-[#0B4734] dark:bg-[#10B981] dark:hover:bg-[#34D399] text-sm font-semibold text-white dark:text-[#042419] transition-colors"
              >
                {t.common.close}
              </button>
              </div>
            </div>
          </ModalPortal>
        )}
      </>
    );
  }

  return null;
};
