import React from 'react';
import { ArrowUpRight, Package, Receipt, ShoppingBag } from 'lucide-react';
import type { AppTab } from '../types';
import { formatKhr, formatUsdRef } from '../utils/format';
import { InfoHint } from './InfoHint';

export interface DailySummaryProps {
  dateLabel: string;
  isKm: boolean;
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
  isKm,
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
      <div className="flex items-start justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-1 min-w-0">
          <h2
            id="daily-summary-heading"
            className="font-display text-base font-semibold text-stone-900 dark:text-[#F1F5F3] tracking-tight"
          >
            {isKm ? 'សង្ខេបប្រចាំថ្ងៃ' : 'Daily Summary'}
          </h2>
          <InfoHint
            text={
              isKm
                ? 'ទិដ្ឋភាពផ្ទាល់នៃការលក់សុទ្ធ មុខទំនិញក្នុងស្តុក និងចំណាយសរុបថ្ងៃនេះ (ម៉ោងភ្នំពេញ ICT)។'
                : "Live snapshot of today's net sales, active stock items, and total cash spent (Asia/Phnom_Penh)."
            }
            label={isKm ? 'អំពីសង្ខេបប្រចាំថ្ងៃ' : 'About Daily Summary'}
          />
        </div>
        <span className="text-xs font-mono-num text-stone-500 dark:text-[#94A39B] shrink-0 pt-1">{dateLabel}</span>
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
          className={`bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between transition-all ${
            onNavigate
              ? 'pos-lift cursor-pointer hover:border-emerald-300/70 dark:hover:border-emerald-500/40 dark:hover:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]'
              : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-emerald-50 dark:bg-[#064E3B] text-[#0F5C43] dark:text-[#34D399] flex items-center justify-center shrink-0">
                <ShoppingBag className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 dark:text-[#94A39B]">
                {isKm ? 'ចំណូលលក់ថ្ងៃនេះ' : 'Total Sales (Today)'}
              </span>
              <InfoHint
                compact
                text={
                  isKm
                    ? 'ចំណូលលក់សុទ្ធថ្ងៃនេះ បន្ទាប់ពីដកការបង្វិលសង និងការបោះបង់វិក្កយបត្រ។'
                    : 'Net sales revenue collected today after returns, refunds, and voided orders.'
                }
                label={isKm ? 'អំពីចំណូលលក់ថ្ងៃនេះ' : 'About Total Sales (Today)'}
              />
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0 mt-2" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {formatKhr(todaySalesKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num truncate">
              {todayOrderCount} {isKm ? 'ការកុម្ម៉ង់' : todayOrderCount === 1 ? 'order' : 'orders'} ·{' '}
              {todayUnitsSold} {isKm ? 'មុខ' : 'units'} · {formatUsdRef(todaySalesKhr, usdRate)}
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
          className={`bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between transition-all ${
            onNavigate
              ? 'pos-lift cursor-pointer hover:border-emerald-300/70 dark:hover:border-emerald-500/40 dark:hover:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]'
              : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-stone-100 dark:bg-[#18251F] text-stone-700 dark:text-[#F1F5F3] flex items-center justify-center shrink-0">
                <Package className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 dark:text-[#94A39B]">
                {isKm ? 'មុខទំនិញក្នុងស្តុក' : 'Active Inventory Items'}
              </span>
              <InfoHint
                compact
                text={
                  isKm
                    ? 'ចំនួនសរុបនៃទំនិញវេចខ្ចប់ស្រាប់ និងវត្ថុធាតុដើមដែលកំពុងតាមដានស្តុក និងការជូនដំណឹងស្តុកជិតអស់។'
                    : 'Combined count of tracked Retail Packaged items and Raw Ingredients monitored for low-stock alerts.'
                }
                label={isKm ? 'អំពីស្ថានភាពស្តុក' : 'About Stock Health'}
              />
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0 mt-2" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {activeInventoryCount}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num truncate">
              {activeDirectProductsCount} {isKm ? 'ផលិតផល' : 'products'} ·{' '}
              {activeIngredientsCount} {isKm ? 'វត្ថុធាតុដើម' : 'ingredients'}
              {lowStockCount > 0 && (
                <span className="text-amber-700 dark:text-amber-400 font-semibold">
                  {' '}
                  · {lowStockCount} {isKm ? 'ស្តុកជិតអស់' : 'low'}
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
          className={`bg-white dark:bg-[#131D18] border border-stone-200 dark:border-[#24352C] rounded-xl p-5 flex flex-col justify-between transition-all ${
            onNavigate
              ? 'pos-lift cursor-pointer hover:border-emerald-300/70 dark:hover:border-emerald-500/40 dark:hover:bg-[#18251F] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0F5C43] dark:focus-visible:ring-[#10B981]'
              : ''
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-x-2 min-w-0">
              <span className="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-400 flex items-center justify-center shrink-0">
                <Receipt className="w-4 h-4" />
              </span>
              <span className="text-xs font-medium text-stone-600 dark:text-[#94A39B]">
                {isKm ? 'ចំណាយសរុបថ្ងៃនេះ' : 'Total Expenses (Today)'}
              </span>
              <InfoHint
                compact
                text={
                  isKm
                    ? 'រួមបញ្ចូលចំណាយប្រតិបត្តិការ និងប្រាក់ចំណាយទិញបញ្ចូលស្តុកក្នុងថ្ងៃនេះ។'
                    : 'Includes today’s operating expenses plus cash spent on inventory stock-in purchases.'
                }
                label={isKm ? 'អំពីចំណាយសរុបថ្ងៃនេះ' : 'About Total Expenses (Today)'}
              />
            </div>
            {onNavigate && <ArrowUpRight className="w-4 h-4 text-stone-400 dark:text-[#94A39B] shrink-0 mt-2" />}
          </div>

          <div className="mt-4">
            <p className="font-mono-num text-2xl font-bold text-stone-900 dark:text-[#F1F5F3] tracking-tight">
              {formatKhr(todayExpensesKhr)}
            </p>
            <p className="mt-1.5 text-xs text-stone-500 dark:text-[#94A39B] font-mono-num truncate">
              {todayExpenseEntriesCount}{' '}
              {isKm ? 'កំណត់ត្រា' : todayExpenseEntriesCount === 1 ? 'entry' : 'entries'}
              {todayStockPurchasesKhr > 0 && todayOperatingExpensesKhr > 0
                ? ` · ${isKm ? 'ប្រតិបត្តិការ' : 'OpEx'} ${formatKhr(todayOperatingExpensesKhr)}`
                : ` · ${formatUsdRef(todayExpensesKhr, usdRate)}`}
            </p>
          </div>
        </div>
      </div>
    </section>
  );
};
