import React, { useEffect, useRef, useState } from 'react';
import { HelpCircle } from 'lucide-react';
import { useHints } from '../context/HintsContext';

export interface InfoHintProps {
  /** Helper description text revealed inline (or in popover mode) when active */
  text: string;
  /** Accessible label for the ? trigger button */
  label?: string;
  /**
   * 'inline' (default): renders a full-width wrapping description (`basis-full`) inside flex-wrap headers.
   * 'popover': renders a floating popover on individual click (useful inside table <th> cells);
   *   when global Show Hints is ON, renders a compact inline note beneath the header text.
   */
  mode?: 'inline' | 'popover';
  /** Popover horizontal alignment when mode="popover" */
  align?: 'left' | 'right';
  /** Optional extra classes on the revealed description text */
  textClassName?: string;
  /** Compact size reduces negative vertical margin when inside tight table headers */
  compact?: boolean;
}

/**
 * Reusable ? info button with uniform neutral gray styling, subtle text contrast,
 * and consistent 0.5rem (8px) spacing around the icon inside a 44px x 44px touch target.
 */
export const InfoHint: React.FC<InfoHintProps> = ({
  text,
  label,
  mode = 'inline',
  align = 'left',
  textClassName = '',
  compact = false,
}) => {
  const { showHints, resetEpoch } = useHints();
  const [localOverride, setLocalOverride] = useState<boolean | null>(null);
  const popoverRef = useRef<HTMLSpanElement | null>(null);

  // Sync back to global state whenever the global Show Hints toggle changes
  useEffect(() => {
    setLocalOverride(null);
  }, [resetEpoch]);

  const isOpen = localOverride ?? showHints;

  // Close individual popover when clicking outside (only when global Show Hints is OFF)
  useEffect(() => {
    if (mode !== 'popover' || !isOpen || showHints) return;
    const handleOutside = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setLocalOverride(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [mode, isOpen, showHints]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setLocalOverride((prev) => {
      const current = prev ?? showHints;
      return !current;
    });
  };

  const accessibleLabel = label || text;

  const triggerButton = (
    <button
      type="button"
      onClick={handleClick}
      aria-label={accessibleLabel}
      aria-expanded={isOpen}
      title={label || 'Show info'}
      className={`w-11 h-11 p-2 ${
        compact ? '-my-2' : '-my-1.5'
      } mx-0 inline-flex items-center justify-center shrink-0 rounded-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]`}
    >
      <span
        className={`w-7 h-7 rounded-full inline-flex items-center justify-center border transition-colors ${
          isOpen
            ? 'bg-neutral-200 border-neutral-300 text-neutral-800 dark:bg-neutral-700 dark:border-neutral-600 dark:text-neutral-100'
            : 'bg-neutral-100 border-neutral-200/90 text-neutral-500 group-hover:bg-neutral-200/80 group-hover:text-neutral-700 dark:bg-neutral-800/90 dark:border-neutral-700/80 dark:text-neutral-400 dark:group-hover:bg-neutral-700/80 dark:group-hover:text-neutral-200'
        }`}
      >
        <HelpCircle className="w-3.5 h-3.5" />
      </span>
    </button>
  );

  if (mode === 'popover') {
    return (
      <span ref={popoverRef} className="relative inline-flex items-center align-middle">
        {triggerButton}
        {isOpen && !showHints && (
          <span
            role="tooltip"
            onClick={(e) => e.stopPropagation()}
            className={`absolute z-30 top-full mt-1.5 w-60 p-2.5 rounded-lg text-left text-xs font-normal normal-case tracking-normal leading-relaxed whitespace-normal bg-neutral-100 dark:bg-neutral-800 text-neutral-700 dark:text-neutral-200 border border-neutral-200 dark:border-neutral-700 shadow-lg ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {text}
          </span>
        )}
        {isOpen && showHints && (
          <span
            className={`basis-full block mt-1.5 px-2.5 py-1.5 rounded-md text-[11px] font-normal normal-case tracking-normal whitespace-normal bg-neutral-100 dark:bg-neutral-800/85 border border-neutral-200/80 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 leading-snug ${textClassName}`}
          >
            {text}
          </span>
        )}
      </span>
    );
  }

  return (
    <>
      {triggerButton}
      {isOpen && (
        <span
          onClick={(e) => e.stopPropagation()}
          className={`basis-full block mt-2 px-3 py-2 rounded-lg text-xs font-normal leading-relaxed whitespace-normal bg-neutral-100/95 dark:bg-neutral-800/85 border border-neutral-200/80 dark:border-neutral-700/70 text-neutral-600 dark:text-neutral-300 ${textClassName}`}
        >
          {text}
        </span>
      )}
    </>
  );
};
