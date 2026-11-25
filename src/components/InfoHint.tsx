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
 * Reusable ? info button matching Business Settings (`w-7 h-7` circular icon inside a `44px x 44px` tap area).
 * - When global Show Hints is OFF: hidden by default; tapping toggles just this single hint.
 * - When global Show Hints is ON: automatically reveals all descriptions across the active page.
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
      className={`w-11 h-11 ${
        compact ? '-my-3 -mx-2' : '-my-2 -mx-1.5'
      } inline-flex items-center justify-center shrink-0 rounded-full group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981]`}
    >
      <span
        className={`w-7 h-7 rounded-full inline-flex items-center justify-center border transition-colors ${
          isOpen
            ? 'bg-[#E6F2ED] border-[#0D5C3E]/40 text-[#0D5C3E] dark:bg-[#064E3B] dark:border-[#10B981]/50 dark:text-[#6EE7B7]'
            : 'bg-stone-100/80 border-stone-200 text-stone-500 group-hover:bg-stone-200/80 group-hover:text-stone-800 dark:bg-[#18251F] dark:border-[#24352C] dark:text-[#94A39B] dark:group-hover:bg-[#1F3028] dark:group-hover:text-[#F1F5F3]'
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
            className={`absolute z-30 top-full mt-1.5 w-60 p-2.5 rounded-lg text-left text-xs font-normal normal-case tracking-normal leading-relaxed whitespace-normal bg-white dark:bg-[#18251F] text-stone-700 dark:text-[#D5DFDA] border border-stone-200 dark:border-[#24352C] shadow-lg ${
              align === 'right' ? 'right-0' : 'left-0'
            }`}
          >
            {text}
          </span>
        )}
        {isOpen && showHints && (
          <span
            className={`basis-full block mt-1 text-[11px] font-normal normal-case tracking-normal whitespace-normal text-stone-500 dark:text-[#94A39B] leading-snug ${textClassName}`}
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
          className={`basis-full block mt-1.5 text-xs font-normal text-stone-500 dark:text-[#94A39B] leading-relaxed whitespace-normal ${textClassName}`}
        >
          {text}
        </span>
      )}
    </>
  );
};
