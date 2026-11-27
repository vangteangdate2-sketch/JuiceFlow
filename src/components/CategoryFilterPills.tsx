import React from 'react';
import type { CategoryItem } from '../types';
import {
  getCategoryDisplayName,
  getCategoryDotClass,
  getCategoryFilterPillClass,
} from '../utils/categories';

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
          className={`inline-flex items-center gap-1.5 h-11 px-4 text-xs font-medium rounded-full transition-colors duration-200 ease-out whitespace-nowrap shrink-0 border ${getCategoryFilterPillClass(
            'ALL',
            selectedCategoryId === 'all'
          )}`}
        >
          <span>{resolvedAllLabel}</span>
        </button>
        {categories.map((cat) => {
          const active = selectedCategoryId === cat.id;
          return (
            <button
              key={cat.id}
              type="button"
              onClick={() => onSelect(cat.id)}
              aria-pressed={active}
              className={`inline-flex items-center gap-1.5 h-11 px-4 text-xs font-medium rounded-full transition-colors duration-200 ease-out whitespace-nowrap shrink-0 border ${getCategoryFilterPillClass(
                cat,
                active
              )}`}
            >
              <span
                className={`w-2 h-2 rounded-full shrink-0 ${getCategoryDotClass(cat)}`}
                aria-hidden="true"
              />
              <span>{getCategoryDisplayName(cat, isVi)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
