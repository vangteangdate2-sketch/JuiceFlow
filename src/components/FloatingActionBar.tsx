import React, { useEffect, useState } from 'react';
import { ArrowUp, Plus } from 'lucide-react';

interface FloatingActionBarProps {
  label: string;
  onAction: () => void;
  topLabel?: string;
  hidden?: boolean;
  ariaLabel?: string;
}

export const FloatingActionBar: React.FC<FloatingActionBarProps> = ({
  label,
  onAction,
  topLabel = 'Top',
  hidden = false,
  ariaLabel,
}) => {
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const handleScroll = () => {
      setShowTop(window.scrollY > 400);
    };
    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  if (hidden) return null;

  return (
    <div className="fixed bottom-20 lg:bottom-6 right-4 sm:right-6 z-30 flex items-center gap-2.5 print:hidden pointer-events-none">
      {showTop && (
        <button
          type="button"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
          aria-label={topLabel}
          className="pointer-events-auto h-11 px-3.5 inline-flex items-center gap-1.5 rounded-full bg-white/95 dark:bg-[#131D18]/95 backdrop-blur-md border border-stone-200 dark:border-[#24352C] text-stone-700 dark:text-[#D5DFDA] hover:text-stone-900 dark:hover:text-[#F1F5F3] hover:border-stone-300 dark:hover:border-[#344B3F] shadow-md text-xs font-semibold transition-all active:scale-95 whitespace-nowrap"
        >
          <ArrowUp className="w-3.5 h-3.5 shrink-0" />
          <span>{topLabel}</span>
        </button>
      )}

      <button
        type="button"
        onClick={onAction}
        aria-label={ariaLabel || label}
        className="pointer-events-auto h-14 px-5 inline-flex items-center gap-2 rounded-full bg-[#0F5C43] hover:bg-[#0B4734] text-white dark:bg-[#10B981] dark:hover:bg-[#34D399] dark:text-[#042419] shadow-lg shadow-emerald-950/20 dark:shadow-black/40 text-sm font-semibold transition-all active:scale-[0.98] whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2 dark:focus-visible:ring-offset-[#0B120E]"
      >
        <Plus className="w-5 h-5 shrink-0 stroke-[2.5]" />
        <span>{label}</span>
      </button>
    </div>
  );
};
