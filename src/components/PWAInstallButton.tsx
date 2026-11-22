import React, { useState } from 'react';
import { Download, X } from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useStore } from '../context/StoreContext';

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
        className={`inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 font-medium ${
          variant === 'full' ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'
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
          className={`inline-flex items-center justify-center gap-2 rounded-lg border border-stone-300 bg-white text-stone-800 hover:bg-stone-50 transition-colors whitespace-nowrap shrink-0 font-medium ${
            variant === 'full' ? 'px-4 py-2.5 text-sm' : 'px-3 py-2 text-xs'
          }`}
        >
          <Download className="w-4 h-4 shrink-0" />
          {t.common.installOnIOS}
        </button>

        {showIOSGuide && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
            <div className="w-full max-w-sm rounded-xl bg-white border border-stone-200 p-6">
              <div className="flex items-center justify-between gap-4 mb-3">
                <h3 className="font-display text-base font-semibold text-stone-900">
                  {t.common.iosInstallTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setShowIOSGuide(false)}
                  className="p-1.5 text-stone-500 hover:text-stone-900 rounded-md"
                  aria-label={t.common.close}
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
              <ol className="space-y-2 text-sm text-stone-600 list-decimal list-inside mb-5">
                <li>{t.common.iosInstallStep1}</li>
                <li>{t.common.iosInstallStep2}</li>
              </ol>
              <button
                type="button"
                onClick={() => setShowIOSGuide(false)}
                className="w-full rounded-lg bg-[#0F5C43] hover:bg-[#0B4734] py-2.5 text-sm font-medium text-white transition-colors"
              >
                {t.common.close}
              </button>
            </div>
          </div>
        )}
      </>
    );
  }

  return null;
};
