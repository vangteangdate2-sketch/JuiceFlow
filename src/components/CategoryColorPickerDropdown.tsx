import React, { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import type { CategoryColorKey } from '../types';
import {
  CATEGORY_COLOR_OPTIONS,
  getCategoryBadgeClass,
  getCategoryDotClass,
} from '../utils/categories';

interface CategoryColorPickerDropdownProps {
  id?: string;
  value: CategoryColorKey;
  onChange: (color: CategoryColorKey) => void;
  isVi: boolean;
  disabled?: boolean;
  align?: 'left' | 'right';
}

export const CategoryColorPickerDropdown: React.FC<CategoryColorPickerDropdownProps> = ({
  id,
  value,
  onChange,
  isVi,
  disabled = false,
  align = 'left',
}) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const selectedOption =
    CATEGORY_COLOR_OPTIONS.find((opt) => opt.key === value) || CATEGORY_COLOR_OPTIONS[0];

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative w-full">
      <button
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((prev) => !prev)}
        className="w-full h-11 px-3 inline-flex items-center justify-between gap-2 text-sm border border-stone-200 dark:border-[#24352C] rounded-lg bg-white dark:bg-[#18251F] text-stone-900 dark:text-[#F1F5F3] hover:border-stone-300 dark:hover:border-[#344E41] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0D5C3E] dark:focus-visible:ring-[#10B981] disabled:opacity-50 transition-colors"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <span
            className={`w-3 h-3 rounded-full shrink-0 ${getCategoryDotClass(selectedOption.key)}`}
            aria-hidden="true"
          />
          <span className="truncate font-medium text-xs sm:text-sm">
            {isVi ? selectedOption.labelVi : selectedOption.label}
          </span>
        </span>
        <ChevronDown
          className={`w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0 transition-transform duration-150 ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={isVi ? 'Chọn màu danh mục' : 'Select category color'}
          className={`absolute z-30 mt-1.5 w-60 max-w-[calc(100vw-2rem)] max-h-72 overflow-y-auto rounded-xl border border-stone-200 dark:border-[#24352C] bg-white dark:bg-[#131D18] shadow-lg p-1.5 space-y-1 ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {CATEGORY_COLOR_OPTIONS.map((opt) => {
            const isSelected = opt.key === value;
            const optLabel = isVi ? opt.labelVi : opt.label;
            return (
              <button
                key={opt.key}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChange(opt.key);
                  setOpen(false);
                }}
                className={`w-full min-h-[40px] px-2.5 py-1.5 rounded-lg flex items-center justify-between gap-2 text-left transition-colors ${
                  isSelected
                    ? 'bg-stone-100 dark:bg-[#1F3028]'
                    : 'hover:bg-stone-50 dark:hover:bg-[#18251F]'
                }`}
              >
                <span
                  className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold border whitespace-nowrap ${getCategoryBadgeClass(
                    opt.key
                  )}`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${getCategoryDotClass(opt.key)}`}
                    aria-hidden="true"
                  />
                  {optLabel}
                </span>
                {isSelected && (
                  <Check className="w-4 h-4 text-[#0D5C3E] dark:text-[#34D399] shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
