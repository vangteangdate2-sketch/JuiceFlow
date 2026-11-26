import React from 'react';
import type { CategoryItem } from '../types';
import { getCategoryDisplayName } from '../utils/categories';

interface CategoryFilterPillsProps {
  categories: CategoryItem[];
  selectedCategoryId: string; // 'all' or a CategoryItem.id
  onSelect: (categoryId: string) => void;
  isVi: boolean;
  allLabel?: string;
  rowLabel?: string;
  labelWidthClass?: string;
}

export const CategoryFilterPills: React.FC<CategoryFilterPillsProps> = ({
  categories,
  selectedCategoryId,
  onSelect,
  isVi,
  allLabel,
  rowLabel,
  labelWidthClass = 'w-16',
}) => {
  const resolvedAllLabel = allLabel || (isVi ? 'Tất cả' : 'All');
  const resolvedRowLabel = rowLabel || (isVi ? 'Danh mục' : 'Category');

  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <span
        className={`text-[11px] font-semibold text-stone-500 dark:text-[#94A39B] ${labelWidthClass} shrink-0`}
      >
        {resolvedRowLabel}
      </span>
      <div className="flex flex-nowrap items-center gap-2 overflow-x-auto min-w-0 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <button
          type="button"
          onClick={() => onSelect('all')}
          aria-pressed={selectedCategoryId === 'all'}
          className={`h-11 px-4 text-xs font-medium rounded-full transition-colors whitespace-nowrap shrink-0 border ${
            selectedCategoryId === 'all'
              ? 'bg-[#0D5C3E] text-white border-[#0D5C3E] dark:bg-[#10B981] dark:text-[#042419] dark:border-[#10B981] font-semibold'
              : 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
          }`}
        >
          {resolvedAllLabel}
        </button>
        {categories.map((cat) => {
          const active = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.id)}
              aria-pressed={active}
              className={`h-11 px-4 text-xs font-medium rounded-full transition-colors whitespace-nowrap shrink-0 border ${
                active
                  ? 'bg-[#0D5C3E] text-white border-[#0D5C3E] dark:bg-[#10B981] dark:text-[#042419] dark:border-[#10B981] font-semibold'
                  : 'bg-stone-100 text-stone-700 border-transparent hover:bg-stone-200 dark:bg-[#18251F] dark:text-[#94A39B] dark:border-[#24352C] dark:hover:bg-[#1F3028] dark:hover:text-[#F1F5F3]'
              }`}
            >
              {getCategoryDisplayName(cat, isVi)}
            </button>
          );
        })}
      </div>
    </div>
  );
};
