import React from 'react';
import { ArrowUpRight, Package, Receipt, ShoppingBag } from 'lucide-react';
import type { AppTab } from '../types';
import { formatKhr, formatUsdRef } from '../utils/format';

export interface DailySummaryProps {
  dateLabel: string;
  isVi: boolean;
  usdRate: number;
  todaySalesKhr: number;
  todayOrderCount: number;
  todayUnitsSold: number;
  activeInventoryCount: number;
  activeDirectProductsCount: number;
  activeIngredientsCount: number;
  lowStockCount: number;
  todayExpensesKhr: number;
  todayOperatingExpensesKhr: number;
  todayStockPurchasesKhr: number;
  todayExpenseEntriesCount: number;
  onNavigate?: (tab: AppTab) => void;
}

export const DailySummary: React.FC<DailySummaryProps> = ({
  dateLabel,
  isVi,
  usdRate,
  todaySalesKhr,
  todayOrderCount,
  todayUnitsSold,
  activeInventoryCount,
  activeDirectProductsCount,
  activeIngredientsCount,
  lowStockCount,
  todayExpensesKhr,
  todayOperatingExpensesKhr,
  todayStockPurchasesKhr,
  todayExpenseEntriesCount,
  onNavigate,
}) => {
  return (
    <section aria-labelledby="daily-summary-heading" className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h2
          id="daily-summary-heading"
          className="font-display text-base font-semibold text-stone-900 tracking-tight"
        >
          {isVi ? 'Tổng kết hôm nay' : 'Daily Summary'}
        </h2>
        <span className="text-xs font-mono-num text-stone-500">{dateLabel}</span>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Card 1: Total Sales Today */}
        <div
          onClick={() => onNavigate?.('sales')}
          role={onNavigate ? 'button' : undefined}
          tabIndex={onNavigate ? 0 : undefined}
          onKeyDown={(e) => {
            if (onNavigate && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onNavigate('sales');
            }
          }}
          className={`bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between transition-colors ${
            onNavigate
              ? 'cursor-pointer hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]'
              : ''
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 text-[#0F5C43] flex items-center justify-center shrink-0">
                <ShoppingBag className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 truncate">
                {isVi ? 'Doanh thu hôm nay' : 'Total Sales (Today)'}
              </span>
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 shrink-0" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 tracking-tight">
              {formatKhr(todaySalesKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 font-mono-num truncate">
              {todayOrderCount} {isVi ? 'đơn' : todayOrderCount === 1 ? 'order' : 'orders'} ·{' '}
              {todayUnitsSold} {isVi ? 'món' : 'units'} · {formatUsdRef(todaySalesKhr, usdRate)}
            </p>
          </div>
        </div>

        {/* Card 2: Active Inventory Items */}
        <div
          onClick={() => onNavigate?.('inventory')}
          role={onNavigate ? 'button' : undefined}
          tabIndex={onNavigate ? 0 : undefined}
          onKeyDown={(e) => {
            if (onNavigate && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onNavigate('inventory');
            }
          }}
          className={`bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between transition-colors ${
            onNavigate
              ? 'cursor-pointer hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]'
              : ''
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-stone-100 text-stone-700 flex items-center justify-center shrink-0">
                <Package className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 truncate">
                {isVi ? 'Mặt hàng tồn kho hoạt động' : 'Active Inventory Items'}
              </span>
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 shrink-0" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 tracking-tight">
              {activeInventoryCount}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 font-mono-num truncate">
              {activeDirectProductsCount} {isVi ? 'sản phẩm' : 'products'} ·{' '}
              {activeIngredientsCount} {isVi ? 'nguyên liệu' : 'ingredients'}
              {lowStockCount > 0 && (
                <span className="text-amber-700 font-semibold">
                  {' '}
                  · {lowStockCount} {isVi ? 'sắp hết' : 'low'}
                </span>
              )}
            </p>
          </div>
        </div>

        {/* Card 3: Total Expenses Today */}
        <div
          onClick={() => onNavigate?.('expenses')}
          role={onNavigate ? 'button' : undefined}
          tabIndex={onNavigate ? 0 : undefined}
          onKeyDown={(e) => {
            if (onNavigate && (e.key === 'Enter' || e.key === ' ')) {
              e.preventDefault();
              onNavigate('expenses');
            }
          }}
          className={`bg-white border border-stone-200 rounded-xl p-5 flex flex-col justify-between transition-colors ${
            onNavigate
              ? 'cursor-pointer hover:border-stone-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43]'
              : ''
          }`}
        >
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2.5 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-amber-50 text-amber-700 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 truncate">
                {isVi ? 'Tổng chi phí hôm nay' : 'Total Expenses (Today)'}
              </span>
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 shrink-0" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 tracking-tight">
              {formatKhr(todayExpensesKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 font-mono-num truncate">
              {todayExpenseEntriesCount}{' '}
              {isVi ? 'khoản chi' : todayExpenseEntriesCount === 1 ? 'entry' : 'entries'}
              {todayStockPurchasesKhr > 0 && todayOperatingExpensesKhr > 0
                ? ` · ${isVi ? 'Vận hành' : 'OpEx'} ${formatKhr(todayOperatingExpensesKhr)}`
                : ` · ${formatUsdRef(todayExpensesKhr, usdRate)}`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
